import OpenAI from 'openai';
import type {BriefContext, ChatMessage, ChatResponse, Locale, ServiceFamily} from '@/types/lead';
import {aiReplySchema} from './schemas';
import {
  extractLeadSignals,
  getContactOnlyPrompt,
  getIdentityRequestPrompt,
  getNameOnlyPrompt,
  getQualificationPrompt,
  getReferralSourcePrompt,
  wasReferralQuestionAsked,
  mapServiceTypeToFamily
} from '@/lib/lead-signals';
import {computeLeadBriefState, isHighIntentMessage} from '@/lib/lead-brief';

const FAST_MODEL = process.env.OPENAI_FAST_MODEL ?? 'gpt-5-mini';
const QUALITY_MODEL = process.env.OPENAI_QUALITY_MODEL ?? 'gpt-5-mini';
const REPLY_MAX_OUTPUT_TOKENS = Math.max(80, Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? '220', 10) || 220);
const HISTORY_WINDOW = Math.max(2, Number.parseInt(process.env.OPENAI_HISTORY_WINDOW ?? '6', 10) || 6);

const scopeKeywords = [
  'website', 'web', 'web app', 'app', 'mobile', 'ios', 'android', 'landing',
  'automation', 'workflow', 'crm', 'integration', 'api', 'ai', 'assistant',
  'chatbot', 'smm', 'marketing', 'seo', 'lead', 'sales', 'telegram', 'whatsapp',
  'ui', 'ux', 'design', 'figma', 'prototype', 'dashboard', 'marketplace',
  'product', 'development', 'monte.guide',
  'сайт', 'лендинг', 'приложен', 'мобайл', 'разработ', 'автоматизац', 'интеграц',
  'ии', 'бот', 'чат-бот', 'дизайн', 'маркет', 'продвижен', 'смм',
  'сайта', 'лендінг', 'додаток', 'розробк', 'автоматизац', 'інтеграц', 'дизайн',
  'sajt', 'aplikac', 'automatiz', 'integrac', 'razvoj', 'dizajn'
];

const outOfScopeKeywords = [
  'weather', 'forecast', 'sports score', 'football score', 'recipe', 'horoscope', 'lottery', 'crypto signal',
  'погода', 'прогноз', 'гороскоп', 'рецепт', 'лотерея', 'спорт счет',
  'погода', 'гороскоп', 'рецепт', 'лотерея',
  'vrijeme', 'horoskop', 'recept'
];

const qualificationQuestionHints = [
  'срок', 'budget', 'бюджет', 'timeline', 'когда', 'критичн', 'goal', 'цель', 'контакт', 'email', 'phone', 'telegram',
  'рок', 'термін', 'kontakt', 'kontakt', 'ime', 'name'
];

const hotLeadHints = [
  'budget', 'timeline', 'deadline', 'start', 'kickoff', 'proposal', 'estimate',
  'price', 'cost', 'contract', 'team', 'call', 'meeting', 'ready', 'need now',
  'asap', 'urgent', 'launch',
  'бюджет', 'срок', 'дедлайн', 'кп', 'оценк', 'стоимост', 'цена', 'договор', 'созвон', 'встреч',
  'бюджет', 'термін', 'дедлайн', 'оцінк', 'вартіст', 'договір', 'дзвінок', 'зустріч',
  'budzet', 'rok', 'procena', 'cena', 'ugovor', 'poziv', 'sastanak'
];

const disallowedFallback: Record<Locale, string> = {
  en: 'I can help with agency services only: web/mobile products, automation, AI, UI/UX execution, and SMM growth. Tell me your task in this scope.',
  'sr-ME': 'Mogu pomoći samo u okviru agencijskih usluga: web/mobile proizvodi, automatizacija, AI, UI/UX realizacija i SMM rast. Opišite zadatak u tom okviru.',
  ru: 'Я помогаю только в рамках услуг агентства: веб/мобайл продукты, автоматизация, ИИ, UI/UX-реализация и SMM. Опишите задачу в этих рамках.',
  uk: 'Я допомагаю лише в межах послуг агенції: веб/мобайл продукти, автоматизація, ШІ, UI/UX-реалізація та SMM. Опишіть задачу в цих межах.'
};

const scopeClarifyPrompt: Record<Locale, string> = {
  en: 'Could you clarify your request in one sentence: what product or service do you want us to build first?',
  'sr-ME': 'Možete li pojasniti zahtjev u jednoj rečenici: koji proizvod ili uslugu želite prvo da izgradimo?',
  ru: 'Уточните, пожалуйста, задачу одной фразой: какой продукт или услугу нужно сделать в первую очередь?',
  uk: 'Уточніть, будь ласка, запит однією фразою: який продукт або послугу потрібно зробити в першу чергу?'
};

const serviceTypePrompt: Record<Locale, string> = {
  en: 'Which service is the first priority: website/app, automation, AI assistant, UI/UX, or SMM growth?',
  'sr-ME': 'Koja je usluga prvi prioritet: sajt/aplikacija, automatizacija, AI asistent, UI/UX ili SMM rast?',
  ru: 'Какая услуга нужна в первую очередь: сайт/приложение, автоматизация, AI-ассистент, UI/UX или SMM-рост?',
  uk: 'Яка послуга потрібна в першу чергу: сайт/застосунок, автоматизація, AI-асистент, UI/UX чи SMM-зростання?'
};

const primaryGoalPrompt: Record<Locale, string> = {
  en: 'What business result do you want first from this project?',
  'sr-ME': 'Koji poslovni rezultat želite prvo da dobijete iz ovog projekta?',
  ru: 'Какой бизнес-результат вы хотите получить в первую очередь?',
  uk: 'Який бізнес-результат ви хочете отримати в першу чергу?'
};

const SERVICE_CLARIFY_HISTORY_WINDOW = 12;
const SERVICE_CLARIFY_MAX_STEPS = 2;
const SERVICE_DETAIL_TOKENS: Record<Exclude<ServiceFamily, 'unknown'>, string[]> = {
  website_app: [
    'lead', 'заяв', 'sale', 'продаж', 'book', 'брон', 'каталог', 'catalog',
    'checkout', 'конверс', 'quote', 'pricing', 'форма'
  ],
  branding_logo: [
    'brandbook', 'guideline', 'style', 'tone', 'reference', 'референс',
    'цвет', 'типограф', 'usage', 'носител'
  ],
  automation: [
    'crm', 'amo', 'hubspot', 'bitrix', 'notion', 'airtable', 'excel', 'таблиц',
    'api', 'webhook', 'zapier', 'make', 'интеграц', 'workflow', 'ручн', 'pipeline'
  ],
  ai_assistant: [
    'telegram', 'whatsapp', 'instagram', 'facebook', 'crm',
    'faq', 'knowledge', 'база', 'docs', 'api', 'каталог', 'прайс', 'support', 'sales'
  ],
  ui_ux: [
    'screen', 'экран', 'flow', 'флоу', 'onboarding', 'checkout', 'кабинет', 'dashboard',
    'prototype', 'wireframe', 'редизайн', 'redesign', 'ux audit', 'usability'
  ],
  smm_growth: [
    'instagram', 'facebook', 'tiktok', 'youtube', 'telegram', 'vk', 'meta ads',
    'google ads', 'cpl', 'roi', 'ctr', 'reach', 'охват', 'kpi', 'лид', 'lead'
  ]
};
const SERVICE_CLARIFY_PLAYBOOK: Record<Exclude<ServiceFamily, 'unknown'>, Record<Locale, {step1: string; step2: string}>> = {
  website_app: {
    en: {
      step1: 'What business is this for, and what is the main result you expect from the site/app?',
      step2: 'Which first conversion scenario is priority now: lead form, sale, booking, catalog, or something else?'
    },
    ru: {
      step1: 'Для какого бизнеса нужен сайт/приложение и какой главный результат вы хотите получить?',
      step2: 'Какой первый сценарий конверсии приоритетен сейчас: заявка, продажа, бронь, каталог или другое?'
    },
    uk: {
      step1: 'Для якого бізнесу потрібен сайт/застосунок і який головний результат ви очікуєте?',
      step2: 'Який перший сценарій конверсії пріоритетний зараз: заявка, продаж, бронювання, каталог чи інше?'
    },
    'sr-ME': {
      step1: 'Za koji biznis je sajt/aplikacija i koji je glavni rezultat koji očekujete?',
      step2: 'Koji prvi scenario konverzije je prioritet sada: upit, prodaja, rezervacija, katalog ili nešto drugo?'
    }
  },
  branding_logo: {
    en: {
      step1: 'What is your business niche, and what key task should branding/logo solve?',
      step2: 'Where will this branding/logo be used first, and do you have style references?'
    },
    ru: {
      step1: 'Какая у вас ниша бизнеса и какую ключевую задачу должен решить логотип/брендинг?',
      step2: 'Где логотип/брендинг будет использоваться в первую очередь и есть ли стилистические референсы?'
    },
    uk: {
      step1: 'Яка у вас ніша бізнесу і яку ключову задачу має вирішити логотип/брендинг?',
      step2: 'Де логотип/брендинг буде використовуватись у першу чергу і чи є стилістичні референси?'
    },
    'sr-ME': {
      step1: 'Koja je niša vašeg biznisa i koji ključni zadatak treba da riješi logo/brending?',
      step2: 'Gdje će se logo/brending prvo koristiti i imate li stilske reference?'
    }
  },
  automation: {
    en: {
      step1: 'Which process is manual now, and what outcome do you want from automation first?',
      step2: 'Which systems must be connected: CRM, spreadsheets, messengers, website, ERP, or other?'
    },
    ru: {
      step1: 'Какой процесс сейчас ручной и какой результат от автоматизации нужен в первую очередь?',
      step2: 'Какие системы нужно связать: CRM, таблицы, мессенджеры, сайт, ERP или другое?'
    },
    uk: {
      step1: 'Який процес зараз ручний і який результат від автоматизації потрібен у першу чергу?',
      step2: 'Які системи потрібно зв’язати: CRM, таблиці, месенджери, сайт, ERP чи інше?'
    },
    'sr-ME': {
      step1: 'Koji proces je sada ručni i koji rezultat želite prvo od automatizacije?',
      step2: 'Koje sisteme treba povezati: CRM, tabele, messengere, sajt, ERP ili drugo?'
    }
  },
  ai_assistant: {
    en: {
      step1: 'Where should the AI assistant work first: website, messengers, CRM, or support flow?',
      step2: 'Which data sources or integrations should it use first?'
    },
    ru: {
      step1: 'Где AI-ассистент должен работать в первую очередь: сайт, мессенджеры, CRM или support-поток?',
      step2: 'Какие источники данных или интеграции ему нужны в первую очередь?'
    },
    uk: {
      step1: 'Де AI-асистент має працювати в першу чергу: сайт, месенджери, CRM чи support-потік?',
      step2: 'Які джерела даних або інтеграції йому потрібні в першу чергу?'
    },
    'sr-ME': {
      step1: 'Gdje AI asistent treba prvo da radi: sajt, messengeri, CRM ili support tok?',
      step2: 'Koje izvore podataka ili integracije treba prvo da koristi?'
    }
  },
  ui_ux: {
    en: {
      step1: 'What exactly are we designing first (product/flows/screens), and for which audience?',
      step2: 'Is this a new interface or redesign, and which UX result is most important?'
    },
    ru: {
      step1: 'Что проектируем в первую очередь (продукт/флоу/экраны) и для какой аудитории?',
      step2: 'Это новый интерфейс или редизайн, и какое UX-улучшение ключевое?'
    },
    uk: {
      step1: 'Що проектуємо в першу чергу (продукт/флоу/екрани) і для якої аудиторії?',
      step2: 'Це новий інтерфейс чи редизайн, і яке UX-покращення ключове?'
    },
    'sr-ME': {
      step1: 'Šta prvo dizajniramo (proizvod/flow/ekrani) i za koju publiku?',
      step2: 'Da li je novi interfejs ili redizajn, i koje UX poboljšanje je ključno?'
    }
  },
  smm_growth: {
    en: {
      step1: 'What is your niche/geo and primary SMM outcome: leads, sales, or reach?',
      step2: 'Which channels are already active, and which KPI is priority now?'
    },
    ru: {
      step1: 'Какая у вас ниша/гео и какой целевой результат SMM в приоритете: лиды, продажи или охват?',
      step2: 'Какие каналы уже активны и какой KPI приоритетен сейчас?'
    },
    uk: {
      step1: 'Яка у вас ніша/гео і який цільовий результат SMM у пріоритеті: ліди, продажі чи охоплення?',
      step2: 'Які канали вже активні і який KPI пріоритетний зараз?'
    },
    'sr-ME': {
      step1: 'Koja je niša/geo i koji je glavni SMM cilj: leadovi, prodaja ili reach?',
      step2: 'Koji kanali su već aktivni i koji KPI je sada prioritet?'
    }
  }
};

const client = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
      project: process.env.OPENAI_PROJECT_ID || undefined,
      organization: process.env.OPENAI_ORG_ID || undefined
    })
  : null;

function isLikelyAllowed(message: string): boolean {
  const lower = message.toLowerCase();
  return scopeKeywords.some((keyword) => lower.includes(keyword));
}

function isClearlyOutOfScope(message: string): boolean {
  const lower = message.toLowerCase();
  return outOfScopeKeywords.some((keyword) => lower.includes(keyword));
}

function hasHotLeadSignals(message: string): boolean {
  const lower = message.toLowerCase();
  return hotLeadHints.some((hint) => lower.includes(hint));
}

function chooseModel(message: string, highIntent = false): string {
  const lower = message.toLowerCase();
  const complex = highIntent || lower.length > 320 || ['architecture', 'integration', 'pipeline', 'roadmap', 'migration', 'security'].some((k) => lower.includes(k));
  return complex ? QUALITY_MODEL : FAST_MODEL;
}

function safeJsonParse(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    return null;
  }
}

function isRecoverableOpenAiError(error: unknown): boolean {
  if (error instanceof OpenAI.RateLimitError || error instanceof OpenAI.APIConnectionError || error instanceof OpenAI.InternalServerError) {
    return true;
  }
  if (error instanceof OpenAI.APIError) {
    const code = typeof error.code === 'string' ? error.code : '';
    return error.status === 429 || code === 'insufficient_quota' || code === 'rate_limit_exceeded';
  }
  return false;
}

function normalizeForSimilarity(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-zа-яёіїє0-9\s]/gi, ' ')
    .split(/\s+/)
    .filter((item) => item.length > 1);
}

function similarity(a: string, b: string): number {
  const left = normalizeForSimilarity(a);
  const right = normalizeForSimilarity(b);
  if (!left.length || !right.length) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let intersection = 0;
  for (const word of leftSet) {
    if (rightSet.has(word)) {
      intersection += 1;
    }
  }
  const union = leftSet.size + rightSet.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function templateLikeAnswer(answer: string, lastAssistantAnswers: string[] = []): boolean {
  const lower = answer.toLowerCase();
  const hasKnownTemplate = [
    'я могу помочь по веб/мобайл-разработке',
    'thanks. we can handle this request',
    'we deliver web/mobile products',
    'i can help with web/mobile development'
  ].some((part) => lower.includes(part));

  if (hasKnownTemplate) {
    return true;
  }

  for (const previousAnswer of lastAssistantAnswers) {
    if (similarity(answer, previousAnswer) >= 0.72) {
      return true;
    }
  }

  return false;
}

function trimForAnswer(input: string): string {
  const clean = input.trim().replace(/\s+/g, ' ');
  if (clean.length <= 420) {
    return clean;
  }
  return `${clean.slice(0, 417)}...`;
}

function hasQuestion(text: string): boolean {
  return text.includes('?');
}

function shouldRetryTemplateAnswer(params: {
  answer: string;
  lastAssistantAnswers: string[];
  highIntent: boolean;
  handoffReady: boolean;
  message: string;
}): boolean {
  if (!templateLikeAnswer(params.answer, params.lastAssistantAnswers)) {
    return false;
  }
  if (params.handoffReady || params.highIntent) {
    return true;
  }
  return params.message.length > 240;
}

const LANGUAGE_HINTS: Record<Locale, string[]> = {
  ru: ['что', 'как', 'срок', 'бюджет', 'задач', 'нужен', 'нужно', 'проект', 'сделать'],
  uk: ['що', 'як', 'строк', 'бюджет', 'потріб', 'проєкт', 'зробити', 'запуск'],
  en: ['what', 'how', 'timeline', 'budget', 'need', 'project', 'build', 'launch'],
  'sr-ME': ['šta', 'sto', 'kako', 'rok', 'budžet', 'budzet', 'treba', 'projekat', 'aplikacija']
};

function detectReplyLanguage(message: string, history: ChatMessage[], fallback: Locale): Locale {
  const recentUserContext = history
    .filter((item) => item.role === 'user')
    .slice(-3)
    .map((item) => item.content)
    .join(' ');
  const sample = `${recentUserContext} ${message}`.toLowerCase();
  if (!sample.trim()) {
    return fallback;
  }

  const scores: Record<Locale, number> = {en: 0, ru: 0, uk: 0, 'sr-ME': 0};
  if (/[іїєґ]/i.test(sample)) {
    scores.uk += 3;
  }
  if (/[ыэъ]/i.test(sample)) {
    scores.ru += 2;
  }
  if (/[čćžšđ]/i.test(sample)) {
    scores['sr-ME'] += 3;
  }
  if (/[a-z]/i.test(sample)) {
    scores.en += 0.5;
    scores['sr-ME'] += 0.5;
  }
  for (const locale of Object.keys(LANGUAGE_HINTS) as Locale[]) {
    for (const token of LANGUAGE_HINTS[locale]) {
      if (sample.includes(token)) {
        scores[locale] += 1;
      }
    }
  }

  const ranking = (Object.entries(scores) as Array<[Locale, number]>).sort((left, right) => right[1] - left[1]);
  const [winner, winnerScore] = ranking[0];
  const runnerUpScore = ranking[1]?.[1] ?? 0;
  const confidence = winnerScore <= 0 ? 0 : (winnerScore - runnerUpScore) / winnerScore;
  if (winnerScore < 1.2 || confidence < 0.2) {
    return fallback;
  }
  return winner;
}

function extractPreferredFirstName(fullName?: string | null): string | null {
  const normalized = cleanText(fullName);
  if (!normalized) {
    return null;
  }
  const token = normalized.replace(/[.,!?;:]+$/g, '').split(/\s+/)[0] ?? '';
  if (token.length < 2 || token.length > 32) {
    return null;
  }
  if (!/[A-Za-zА-Яа-яЁёІЇЄієї]/.test(token)) {
    return null;
  }
  return token;
}

function shouldAddressByName(history: ChatMessage[]): boolean {
  const assistantTurns = history.filter((item) => item.role === 'assistant').length;
  return assistantTurns % 3 === 0;
}

function maybeAddressByName(params: {
  answer: string;
  preferredName?: string | null;
  history: ChatMessage[];
}): string {
  const name = params.preferredName ?? null;
  if (!name) {
    return params.answer;
  }
  if (!shouldAddressByName(params.history)) {
    return params.answer;
  }
  const lowerAnswer = params.answer.toLowerCase();
  if (lowerAnswer.includes(name.toLowerCase())) {
    return params.answer;
  }
  return trimForAnswer(`${name}, ${params.answer}`);
}

function cleanText(value?: string | null): string | null {
  if (!value) {
    return null;
  }
  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function preferLongerText(existing?: string | null, candidate?: string | null, minLength = 18): string | null {
  const current = cleanText(existing);
  const incoming = cleanText(candidate);
  if (!incoming) {
    return current;
  }
  if (!current) {
    return incoming;
  }
  if (incoming === current) {
    return current;
  }
  if (incoming.length < minLength && current.length >= minLength) {
    return current;
  }
  return incoming.length >= current.length ? incoming : current;
}

function isShortFactReply(message: string): boolean {
  const normalized = message.trim();
  if (!normalized || normalized.includes('?')) {
    return false;
  }
  const words = normalized.split(/\s+/).filter(Boolean);
  if (words.length > 10) {
    return false;
  }
  return normalized.length <= 80;
}

function getLastAssistantQuestion(history: ChatMessage[]): string | null {
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const item = history[index];
    if (item.role === 'assistant' && item.content.includes('?')) {
      return item.content;
    }
  }
  return null;
}

function isQualificationQuestion(text: string | null): boolean {
  if (!text) {
    return false;
  }
  const lower = text.toLowerCase();
  return qualificationQuestionHints.some((hint) => lower.includes(hint));
}

function handoffNotice(locale: Locale): string {
  if (locale === 'ru') {
    return 'Отлично, передаю лид менеджеру.';
  }
  if (locale === 'uk') {
    return 'Чудово, передаю лід менеджеру.';
  }
  if (locale === 'sr-ME') {
    return 'Odlično, prosleđujem lead menadžeru.';
  }
  return 'Great, I am handing this lead to a manager.';
}

type AckSignalType = 'contact' | 'timeline' | 'budget' | 'handoff' | 'progress';

const ACK_VARIANTS: Record<Locale, Record<AckSignalType, string[]>> = {
  ru: {
    contact: [
      'Спасибо, контакт зафиксировал.',
      'Принял, контакт добавил в заявку.',
      'Контакт сохранил, продолжаем.'
    ],
    timeline: [
      'Принял, сроки запуска зафиксировал.',
      'По срокам записал, это учтём в оценке.',
      'Сроки отметил, двигаемся дальше.'
    ],
    budget: [
      'Принял, ориентир по бюджету зафиксировал.',
      'Бюджетный ориентир записал для точной оценки.',
      'Бюджет отметил, это поможет с приоритизацией.'
    ],
    handoff: [
      'Отлично, данных достаточно, передаю запрос менеджеру на оценку и следующий шаг.',
      'Хорошо, информации хватает, передаю лид менеджеру.',
      'Принято, передаю заявку менеджеру для следующего шага.'
    ],
    progress: [
      'Понял задачу, двигаемся дальше по брифу.',
      'Принял контекст, продолжим уточнения.',
      'Отлично, иду дальше по деталям.'
    ]
  },
  uk: {
    contact: [
      'Дякую, контакт зафіксував.',
      'Прийняв, контакт додав до заявки.',
      'Контакт зберіг, рухаємось далі.'
    ],
    timeline: [
      'Прийняв, строки запуску зафіксував.',
      'Строки записав, врахуємо це в оцінці.',
      'По термінах зафіксував, продовжуємо.'
    ],
    budget: [
      'Прийняв, орієнтир бюджету зафіксував.',
      'Бюджетний орієнтир зберіг для точної оцінки.',
      'Бюджет зафіксував, це допоможе з пріоритетами.'
    ],
    handoff: [
      'Чудово, даних достатньо, передаю запит менеджеру на оцінку та наступний крок.',
      'Добре, інформації вистачає, передаю лід менеджеру.',
      'Прийняв, передаю заявку менеджеру для наступного кроку.'
    ],
    progress: [
      'Зрозумів запит, продовжуємо бриф.',
      'Прийняв контекст, рухаємось далі з уточненнями.',
      'Добре, переходжу до наступного уточнення.'
    ]
  },
  'sr-ME': {
    contact: [
      'Hvala, kontakt je zabilježen.',
      'Kontakt je dodat u prijavu, nastavljamo.',
      'Kontakt je sačuvan, idemo dalje.'
    ],
    timeline: [
      'Rok lansiranja je zabilježen.',
      'Rok je evidentiran i biće uzet u procjenu.',
      'Rok sam upisao, nastavimo dalje.'
    ],
    budget: [
      'Budžetski okvir je zabilježen.',
      'Budžetski okvir je upisan za precizniju procjenu.',
      'Budžet je evidentiran, to pomaže prioritizaciji.'
    ],
    handoff: [
      'Odlično, imamo dovoljno podataka i predajem zahtjev menadžeru.',
      'Informacije su dovoljne, prosleđujem lead menadžeru.',
      'U redu, predajem prijavu menadžeru za sledeći korak.'
    ],
    progress: [
      'Razumijem zahtjev, nastavimo sa brief-om.',
      'Kontekst je jasan, idemo na sledeće pojašnjenje.',
      'Odlično, nastavljamo sa detaljima.'
    ]
  },
  en: {
    contact: [
      'Thanks, I have your contact.',
      'Got it, I added your contact to the brief.',
      'Contact saved, let us continue.'
    ],
    timeline: [
      'Got it, I noted the launch timeline.',
      'Timeline captured and added for estimation.',
      'Timeline is noted, moving to the next detail.'
    ],
    budget: [
      'Got it, I noted the budget range.',
      'Budget range captured for a more precise estimate.',
      'Budget is recorded, that helps with prioritization.'
    ],
    handoff: [
      'Great, I have enough details and will hand this to a manager.',
      'Thanks, this is enough context, handing off to a manager.',
      'Understood, I am passing this to a manager for the next step.'
    ],
    progress: [
      'Understood, let us continue the brief.',
      'Got it, we can move to the next clarification.',
      'Thanks, context is clear, continuing with details.'
    ]
  }
};

function isAcknowledgementTooSimilar(candidate: string, recentAssistantAnswers: string[]): boolean {
  const candidateLower = candidate.toLowerCase();
  return recentAssistantAnswers.some((previous) => {
    const previousLower = previous.toLowerCase();
    return previousLower.includes(candidateLower) || similarity(candidate, previous) >= 0.62;
  });
}

function buildAlternativeAcknowledgement(params: {
  locale: Locale;
  signalType: AckSignalType;
  recentAssistantAnswers?: string[];
  preferred?: string;
}): string {
  const variants = ACK_VARIANTS[params.locale][params.signalType];
  const recentAssistantAnswers = params.recentAssistantAnswers ?? [];
  const candidates = params.preferred
    ? [params.preferred, ...variants.filter((variant) => variant !== params.preferred)]
    : variants;

  for (const candidate of candidates) {
    if (!isAcknowledgementTooSimilar(candidate, recentAssistantAnswers)) {
      return candidate;
    }
  }

  if (!candidates.length) {
    return '';
  }

  const deterministicIndex = recentAssistantAnswers.join('|').length % candidates.length;
  return candidates[deterministicIndex];
}

function chooseNextQuestion(params: {
  locale: Locale;
  missingFields: string[];
  hasBudget: boolean;
  hasTimeline: boolean;
  askReferralSource?: boolean;
}): string {
  if (params.askReferralSource) {
    return getReferralSourcePrompt(params.locale);
  }
  const missing = new Set(params.missingFields);
  const needsFullName = missing.has('full_name');
  const needsContact = missing.has('contact');
  if (needsFullName && needsContact) {
    return getIdentityRequestPrompt(params.locale);
  }
  if (needsFullName) {
    return getNameOnlyPrompt(params.locale);
  }
  if (needsContact) {
    return getContactOnlyPrompt(params.locale);
  }
  if (missing.has('service_type')) {
    return serviceTypePrompt[params.locale];
  }
  if (missing.has('primary_goal')) {
    return primaryGoalPrompt[params.locale];
  }
  if (missing.has('timeline_or_budget')) {
    return getQualificationPrompt({
      locale: params.locale,
      hasScope: true,
      hasBudget: params.hasBudget,
      hasTimeline: params.hasTimeline
    });
  }
  return getQualificationPrompt({
    locale: params.locale,
    hasScope: true,
    hasBudget: true,
    hasTimeline: true
  });
}

function hasRecentIdentityCapturePrompt(history: ChatMessage[]): boolean {
  const recentAssistantMessages = history
    .filter((item) => item.role === 'assistant')
    .slice(-2)
    .map((item) => item.content.toLowerCase());
  if (!recentAssistantMessages.length) {
    return false;
  }
  const hints = [
    'контакт', 'телефон', 'email', 'telegram', 'ваше имя', 'как к вам обращаться',
    'contact', 'phone', 'what is your name', 'share your name',
    'kontakt', 'telefon', 'ime', 'kako da vam se obra',
    "ім'я", 'контакт', 'пошта'
  ];
  return recentAssistantMessages.some((message) => hints.some((hint) => message.includes(hint)));
}

function hasMeaningfulPrimaryGoal(goal?: string | null): boolean {
  const value = cleanText(goal);
  if (!value || value.length < 22) {
    return false;
  }
  const lower = value.toLowerCase();
  const generic = [
    /нужен\s+(сайт|лендинг|логотип|брендинг|автоматизац|бот)/i,
    /хочу\s+(сайт|лендинг|логотип|брендинг|автоматизац|бот)/i,
    /need\s+(a\s+)?(website|landing|logo|branding|automation|bot|assistant)/i,
    /treba\s+(sajt|landing|logo|brending|automatizac)/i,
    /потріб(ен|на)\s+(сайт|лендінг|логотип|брендинг|автоматизац|бот)/i
  ].some((pattern) => pattern.test(lower));
  return !generic || value.length >= 42;
}

function hasFamilySpecificDetails(params: {
  serviceFamily: ServiceFamily;
  primaryGoal?: string | null;
  firstDeliverable?: string | null;
  constraints?: string | null;
  message?: string;
}): boolean {
  if (params.serviceFamily === 'unknown') {
    return false;
  }
  const text = [
    cleanText(params.primaryGoal),
    cleanText(params.firstDeliverable),
    cleanText(params.constraints),
    cleanText(params.message)
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  if (!text) {
    return false;
  }
  const tokens = SERVICE_DETAIL_TOKENS[params.serviceFamily];
  return tokens.some((token) => text.includes(token));
}

function computeServiceDetailScore(params: {
  serviceFamily: ServiceFamily;
  primaryGoal?: string | null;
  firstDeliverable?: string | null;
  constraints?: string | null;
  message: string;
}): number {
  if (params.serviceFamily === 'unknown') {
    return 0;
  }
  let score = 0;
  if (hasMeaningfulPrimaryGoal(params.primaryGoal)) {
    score += 1;
  }
  if (hasFamilySpecificDetails({
    serviceFamily: params.serviceFamily,
    primaryGoal: params.primaryGoal,
    firstDeliverable: params.firstDeliverable,
    constraints: params.constraints,
    message: params.message
  })) {
    score += 1;
  }
  return Math.max(0, Math.min(2, score));
}

function getAskedServiceClarifyStepFlags(params: {
  serviceFamily: ServiceFamily;
  history: ChatMessage[];
}): {step1: boolean; step2: boolean} {
  if (params.serviceFamily === 'unknown') {
    return {step1: false, step2: false};
  }
  const asked = {step1: false, step2: false};
  const recentAssistantMessages = params.history
    .filter((item) => item.role === 'assistant')
    .slice(-SERVICE_CLARIFY_HISTORY_WINDOW);
  for (const item of recentAssistantMessages) {
    const content = cleanText(item.content);
    if (!content) {
      continue;
    }
    for (const locale of ['en', 'ru', 'uk', 'sr-ME'] as Locale[]) {
      const playbook = SERVICE_CLARIFY_PLAYBOOK[params.serviceFamily][locale];
      if (!asked.step1 && similarity(content, playbook.step1) >= 0.58) {
        asked.step1 = true;
      }
      if (!asked.step2 && similarity(content, playbook.step2) >= 0.58) {
        asked.step2 = true;
      }
    }
    if (asked.step1 && asked.step2) {
      break;
    }
  }
  return asked;
}

function getServiceClarifyDecision(params: {
  locale: Locale;
  topic: 'allowed' | 'disallowed' | 'unclear';
  serviceFamily: ServiceFamily;
  serviceDetailScore: number;
  history: ChatMessage[];
  conversationInScope: boolean;
  highIntent: boolean;
  hasContact: boolean;
  handoffReady: boolean;
}): {
  nextQuestion: string | null;
  askedStepsForFamily: number;
  active: boolean;
} {
  if (params.topic !== 'allowed' || !params.conversationInScope || params.serviceFamily === 'unknown' || params.handoffReady) {
    return {nextQuestion: null, askedStepsForFamily: 0, active: false};
  }
  if (params.highIntent && !params.hasContact) {
    return {nextQuestion: null, askedStepsForFamily: 0, active: false};
  }
  if (hasRecentIdentityCapturePrompt(params.history)) {
    return {nextQuestion: null, askedStepsForFamily: 0, active: false};
  }

  const askedFlags = getAskedServiceClarifyStepFlags({
    serviceFamily: params.serviceFamily,
    history: params.history
  });
  const askedStepsForFamily = Number(askedFlags.step1) + Number(askedFlags.step2);
  if (askedStepsForFamily >= SERVICE_CLARIFY_MAX_STEPS || params.serviceDetailScore >= 2) {
    return {nextQuestion: null, askedStepsForFamily, active: false};
  }

  let stepToAsk: 1 | 2 | null = null;
  if (params.serviceDetailScore <= 0) {
    if (!askedFlags.step1) {
      stepToAsk = 1;
    } else if (!askedFlags.step2) {
      stepToAsk = 2;
    }
  } else if (params.serviceDetailScore === 1 && !askedFlags.step2) {
    stepToAsk = 2;
  }

  if (!stepToAsk) {
    return {nextQuestion: null, askedStepsForFamily, active: false};
  }

  const playbook = SERVICE_CLARIFY_PLAYBOOK[params.serviceFamily][params.locale];
  return {
    nextQuestion: stepToAsk === 1 ? playbook.step1 : playbook.step2,
    askedStepsForFamily,
    active: true
  };
}

function getConversationMeta(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
  briefContext?: BriefContext;
  identityState: 'unverified' | 'pending_match' | 'verified';
  channel: 'web' | 'telegram' | 'instagram' | 'facebook' | 'whatsapp';
}) {
  const signals = extractLeadSignals({history: params.history, message: params.message});
  const highIntent = isHighIntentMessage(params.message) || hasHotLeadSignals(params.message);
  const mergedDraft = {
    fullName: signals.name ?? params.briefContext?.fullName ?? null,
    email: signals.normalizedEmail ?? params.briefContext?.email ?? null,
    phone: signals.normalizedPhone ?? params.briefContext?.phone ?? null,
    telegramHandle: signals.telegramHandle ?? params.briefContext?.telegramHandle ?? null,
    serviceType: signals.serviceType ?? params.briefContext?.serviceType ?? null,
    primaryGoal: preferLongerText(params.briefContext?.primaryGoal ?? null, signals.primaryGoal),
    firstDeliverable: preferLongerText(params.briefContext?.firstDeliverable ?? null, signals.firstDeliverable, 14),
    timelineHint: signals.timelineHint ?? params.briefContext?.timelineHint ?? null,
    budgetHint: signals.budgetHint ?? params.briefContext?.budgetHint ?? null,
    referralSource: preferLongerText(params.briefContext?.referralSource ?? null, signals.referralSource, 6),
    constraints: preferLongerText(params.briefContext?.constraints ?? null, signals.constraints, 12)
  };

  let brief = computeLeadBriefState(mergedDraft, {highIntent});
  const requireConversationContact = params.channel === 'web' && params.identityState !== 'verified';
  const hasConversationContact = Boolean(
    params.briefContext?.email ||
    params.briefContext?.phone ||
    params.briefContext?.telegramHandle ||
    params.briefContext?.hasConversationContact
  );
  if (requireConversationContact && !hasConversationContact) {
    const missingFields = brief.missingFields.includes('contact')
      ? brief.missingFields
      : (['contact', ...brief.missingFields] as typeof brief.missingFields);
    const completenessScore = Math.max(0, Math.min(100, Math.round(((5 - missingFields.length) / 5) * 100)));
    brief = {
      ...brief,
      missingFields,
      completenessScore,
      handoffReady: false,
      expediteEligible: false,
      status: 'collecting',
      conversationStage: 'contact_capture'
    };
  }
  const coreHandoffReady = brief.handoffReady;
  const shouldAskReferralOnce = coreHandoffReady
    && !cleanText(mergedDraft.referralSource)
    && !wasReferralQuestionAsked(params.history);
  if (shouldAskReferralOnce) {
    brief = {
      ...brief,
      handoffReady: false,
      expediteEligible: false,
      status: 'collecting',
      conversationStage: 'briefing'
    };
  }

  const messageInScope = isLikelyAllowed(params.message);
  const contextHasScope = Boolean(mergedDraft.serviceType) || signals.hasScope;
  const shortReplyContinuation =
    isShortFactReply(params.message) &&
    isQualificationQuestion(getLastAssistantQuestion(params.history));
  const conversationInScope = messageInScope || contextHasScope || shortReplyContinuation;
  const serviceFamily = signals.serviceFamily !== 'unknown'
    ? signals.serviceFamily
    : mapServiceTypeToFamily(mergedDraft.serviceType);
  const hasContact = Boolean(
    mergedDraft.email ||
    mergedDraft.phone ||
    mergedDraft.telegramHandle ||
    params.briefContext?.hasConversationContact
  );
  const serviceDetailScore = computeServiceDetailScore({
    serviceFamily,
    primaryGoal: mergedDraft.primaryGoal,
    firstDeliverable: mergedDraft.firstDeliverable,
    constraints: mergedDraft.constraints,
    message: params.message
  });

  const defaultNextQuestion = chooseNextQuestion({
    locale: params.locale,
    missingFields: brief.missingFields,
    hasBudget: Boolean(mergedDraft.budgetHint) || signals.hasBudget,
    hasTimeline: Boolean(mergedDraft.timelineHint) || signals.hasTimeline,
    askReferralSource: shouldAskReferralOnce
  });
  const serviceClarify = getServiceClarifyDecision({
    locale: params.locale,
    topic: 'allowed',
    serviceFamily,
    serviceDetailScore,
    history: params.history,
    conversationInScope,
    highIntent,
    hasContact,
    handoffReady: coreHandoffReady || shouldAskReferralOnce
  });
  const nextQuestion = shouldAskReferralOnce
    ? defaultNextQuestion
    : (serviceClarify.nextQuestion ?? defaultNextQuestion);

  return {
    signals,
    brief,
    mergedDraft,
    preferredName: extractPreferredFirstName(mergedDraft.fullName),
    highIntent,
    nextQuestion,
    conversationInScope,
    serviceFamily,
    serviceDetailScore,
    serviceClarifyNextQuestion: serviceClarify.nextQuestion,
    askedServiceClarifySteps: serviceClarify.askedStepsForFamily,
    serviceClarifyActive: serviceClarify.active,
    referralPromptRequired: shouldAskReferralOnce
  };
}

function ensureTargetQuestion(answer: string, targetQuestion: string): string {
  const normalizedTarget = trimForAnswer(targetQuestion);
  const normalizedAnswer = trimForAnswer(answer);
  if (!normalizedAnswer.includes('?')) {
    return trimForAnswer(`${normalizedAnswer} ${normalizedTarget}`);
  }
  const statementPart = normalizedAnswer.split('?')[0]?.trim().replace(/[.!]+$/g, '') ?? '';
  if (!statementPart) {
    return normalizedTarget;
  }
  return trimForAnswer(`${statementPart}. ${normalizedTarget}`);
}

function fallbackAllowedReply(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
  identityState: 'unverified' | 'pending_match' | 'verified';
  memoryLoaded?: boolean;
  verificationHint?: string;
  briefContext?: BriefContext;
  channel: 'web' | 'telegram' | 'instagram' | 'facebook' | 'whatsapp';
}): ChatResponse {
  const meta = getConversationMeta({
    locale: params.locale,
    message: params.message,
    history: params.history,
    briefContext: params.briefContext,
    identityState: params.identityState,
    channel: params.channel
  });
  const leadScoreBase = meta.highIntent ? 78 : 58;
  const memoryLoaded = params.memoryLoaded ?? false;
  const currentTurnSignals = extractLeadSignals({history: [], message: params.message});
  const lastAssistantAnswers = [...params.history]
    .filter((item) => item.role === 'assistant')
    .slice(-3)
    .map((item) => item.content);

  const hasContact = Boolean(currentTurnSignals.normalizedEmail || currentTurnSignals.normalizedPhone || currentTurnSignals.telegramHandle);
  const hasTimeline = Boolean(currentTurnSignals.timelineHint);
  const hasBudget = Boolean(currentTurnSignals.budgetHint);

  let answer = '';
  let signalType: 'contact' | 'timeline' | 'budget' | 'handoff' | 'progress' = 'progress';
  if (params.locale === 'ru') {
    if (hasContact) {
      answer = meta.signals.name
        ? `Спасибо, ${meta.signals.name}, контакт зафиксировал.`
        : buildAlternativeAcknowledgement({
            locale: 'ru',
            signalType: 'contact',
            recentAssistantAnswers: lastAssistantAnswers,
            preferred: 'Спасибо, контакт зафиксировал.'
          });
      signalType = 'contact';
    } else if (hasTimeline) {
      answer = buildAlternativeAcknowledgement({
        locale: 'ru',
        signalType: 'timeline',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Принял, сроки запуска зафиксировал.'
      });
      signalType = 'timeline';
    } else if (hasBudget) {
      answer = buildAlternativeAcknowledgement({
        locale: 'ru',
        signalType: 'budget',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Принял, ориентир по бюджету зафиксировал.'
      });
      signalType = 'budget';
    } else if (meta.brief.handoffReady) {
      answer = buildAlternativeAcknowledgement({
        locale: 'ru',
        signalType: 'handoff',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Отлично, данных достаточно, передаю запрос менеджеру на оценку и следующий шаг.'
      });
      signalType = 'handoff';
    } else {
      answer = buildAlternativeAcknowledgement({
        locale: 'ru',
        signalType: 'progress',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Понял задачу, двигаемся дальше по брифу.'
      });
      signalType = 'progress';
    }
  } else if (params.locale === 'uk') {
    if (hasContact) {
      answer = meta.signals.name
        ? `Дякую, ${meta.signals.name}, контакт зафіксував.`
        : buildAlternativeAcknowledgement({
            locale: 'uk',
            signalType: 'contact',
            recentAssistantAnswers: lastAssistantAnswers,
            preferred: 'Дякую, контакт зафіксував.'
          });
      signalType = 'contact';
    } else if (hasTimeline) {
      answer = buildAlternativeAcknowledgement({
        locale: 'uk',
        signalType: 'timeline',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Прийняв, строки запуску зафіксував.'
      });
      signalType = 'timeline';
    } else if (hasBudget) {
      answer = buildAlternativeAcknowledgement({
        locale: 'uk',
        signalType: 'budget',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Прийняв, орієнтир бюджету зафіксував.'
      });
      signalType = 'budget';
    } else if (meta.brief.handoffReady) {
      answer = buildAlternativeAcknowledgement({
        locale: 'uk',
        signalType: 'handoff',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Чудово, даних достатньо, передаю запит менеджеру на оцінку та наступний крок.'
      });
      signalType = 'handoff';
    } else {
      answer = buildAlternativeAcknowledgement({
        locale: 'uk',
        signalType: 'progress',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Зрозумів запит, продовжуємо бриф.'
      });
      signalType = 'progress';
    }
  } else if (params.locale === 'sr-ME') {
    if (hasContact) {
      answer = meta.signals.name
        ? `Hvala, ${meta.signals.name}, kontakt je zabilježen.`
        : buildAlternativeAcknowledgement({
            locale: 'sr-ME',
            signalType: 'contact',
            recentAssistantAnswers: lastAssistantAnswers,
            preferred: 'Hvala, kontakt je zabilježen.'
          });
      signalType = 'contact';
    } else if (hasTimeline) {
      answer = buildAlternativeAcknowledgement({
        locale: 'sr-ME',
        signalType: 'timeline',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Rok lansiranja je zabilježen.'
      });
      signalType = 'timeline';
    } else if (hasBudget) {
      answer = buildAlternativeAcknowledgement({
        locale: 'sr-ME',
        signalType: 'budget',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Budžetski okvir je zabilježen.'
      });
      signalType = 'budget';
    } else if (meta.brief.handoffReady) {
      answer = buildAlternativeAcknowledgement({
        locale: 'sr-ME',
        signalType: 'handoff',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Odlično, imamo dovoljno podataka i predajem zahtjev menadžeru.'
      });
      signalType = 'handoff';
    } else {
      answer = buildAlternativeAcknowledgement({
        locale: 'sr-ME',
        signalType: 'progress',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Razumijem zahtjev, nastavimo sa brief-om.'
      });
      signalType = 'progress';
    }
  } else {
    if (hasContact) {
      answer = meta.signals.name
        ? `Thanks, ${meta.signals.name}, I have your contact.`
        : buildAlternativeAcknowledgement({
            locale: 'en',
            signalType: 'contact',
            recentAssistantAnswers: lastAssistantAnswers,
            preferred: 'Thanks, I have your contact.'
          });
      signalType = 'contact';
    } else if (hasTimeline) {
      answer = buildAlternativeAcknowledgement({
        locale: 'en',
        signalType: 'timeline',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Got it, I noted the launch timeline.'
      });
      signalType = 'timeline';
    } else if (hasBudget) {
      answer = buildAlternativeAcknowledgement({
        locale: 'en',
        signalType: 'budget',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Got it, I noted the budget range.'
      });
      signalType = 'budget';
    } else if (meta.brief.handoffReady) {
      answer = buildAlternativeAcknowledgement({
        locale: 'en',
        signalType: 'handoff',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Great, I have enough details and will hand this to a manager.'
      });
      signalType = 'handoff';
    } else {
      answer = buildAlternativeAcknowledgement({
        locale: 'en',
        signalType: 'progress',
        recentAssistantAnswers: lastAssistantAnswers,
        preferred: 'Understood, let us continue the brief.'
      });
      signalType = 'progress';
    }
  }

  const verificationPart = params.verificationHint ? ` ${params.verificationHint}` : '';
  let composed = trimForAnswer(`${answer}${verificationPart} ${meta.nextQuestion}`);
  if (templateLikeAnswer(composed, lastAssistantAnswers)) {
    composed = trimForAnswer(`${buildAlternativeAcknowledgement({
      locale: params.locale,
      signalType,
      recentAssistantAnswers: lastAssistantAnswers,
      preferred: answer
    })}${verificationPart} ${meta.nextQuestion}`);
  }
  const personalizedAnswer = maybeAddressByName({
    answer: composed,
    preferredName: meta.preferredName,
    history: params.history
  });
  return {
    answer: personalizedAnswer,
    topic: 'allowed',
    leadIntentScore: meta.brief.handoffReady || meta.highIntent
      ? Math.max(leadScoreBase, meta.brief.completenessScore)
      : Math.min(72, Math.max(leadScoreBase, Math.min(meta.brief.completenessScore, 72))),
    nextQuestion: meta.nextQuestion,
    requiresLeadCapture: false,
    conversationStage: meta.brief.conversationStage,
    missingFields: meta.brief.missingFields,
    handoffReady: meta.brief.handoffReady,
    identityState: params.identityState,
    memoryLoaded,
    verificationHint: params.verificationHint,
    dialogMode: 'context_continuation'
  };
}

function unclearScopeReply(params: {
  locale: Locale;
  identityState: 'unverified' | 'pending_match' | 'verified';
  memoryLoaded: boolean;
  verificationHint?: string;
}): ChatResponse {
  const verificationPart = params.verificationHint ? ` ${params.verificationHint}` : '';
  const nextQuestion = scopeClarifyPrompt[params.locale];
  return {
    answer: trimForAnswer(`${nextQuestion}${verificationPart}`),
    topic: 'unclear',
    leadIntentScore: 20,
    nextQuestion,
    requiresLeadCapture: false,
    conversationStage: 'discovery',
    missingFields: ['service_type', 'primary_goal'],
    handoffReady: false,
    identityState: params.identityState,
    memoryLoaded: params.memoryLoaded,
    verificationHint: params.verificationHint,
    dialogMode: 'scope_clarify'
  };
}

function disallowedReply(locale: Locale, identityState: 'unverified' | 'pending_match' | 'verified', memoryLoaded: boolean): ChatResponse {
  return {
    answer: disallowedFallback[locale],
    topic: 'disallowed',
    leadIntentScore: 0,
    nextQuestion: disallowedFallback[locale],
    requiresLeadCapture: false,
    conversationStage: 'discovery',
    missingFields: ['service_type'],
    handoffReady: false,
    identityState,
    memoryLoaded,
    dialogMode: 'disallowed'
  };
}

export async function generateAgencyReply(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
  conversationId?: string;
  identityState?: 'unverified' | 'pending_match' | 'verified';
  memoryLoaded?: boolean;
  verificationHint?: string;
  briefContext?: BriefContext;
  channel: 'web' | 'telegram' | 'instagram' | 'facebook' | 'whatsapp';
}): Promise<ChatResponse> {
  const {locale, message, history} = params;
  const replyLocale = detectReplyLanguage(message, history, locale);
  const identityState = params.identityState ?? 'unverified';
  const memoryLoaded = params.memoryLoaded ?? false;
  const meta = getConversationMeta({
    locale: replyLocale,
    message,
    history,
    briefContext: params.briefContext,
    identityState,
    channel: params.channel
  });

  if (!meta.conversationInScope) {
    if (isClearlyOutOfScope(message)) {
      return disallowedReply(replyLocale, identityState, memoryLoaded);
    }
    return unclearScopeReply({
      locale: replyLocale,
      identityState,
      memoryLoaded,
      verificationHint: params.verificationHint
    });
  }

  if (!client) {
    return fallbackAllowedReply({
      ...params,
      locale: replyLocale,
      identityState
    });
  }

  const model = chooseModel(message, meta.highIntent);
  const systemPrompt = [
    'You are SYSTEMA.WORKS sales manager AI for a digital agency.',
    'Speak like a human consultant, not like a canned template.',
    'Keep each answer concise: 2-4 short sentences and max one question.',
    'When customer name is known, occasionally address by first name (about every 2-4 turns), not every message.',
    'Acknowledge the exact user request before asking the next question.',
    'Avoid repeating the same opening clause used in the last 1-2 assistant replies.',
    'Do not repeat generic service lists every turn.',
    'Collect a minimal brief for manager handoff: full_name, one contact (email/phone/telegram), service_type, primary_goal, and at least timeline or budget.',
    'After core brief is complete, ask once where the customer heard about us.',
    'Do not block handoff if referral source is still unknown after that one question.',
    'Question priority: contact first, then service and primary goal, then timeline/budget.',
    'If serviceClarifyActive=true, ask only the provided serviceClarifyQuestion and do not jump to other discovery questions.',
    'If user gives a short factual answer to your previous qualifying question, continue the thread without scope reset.',
    'If user asks for call/estimate urgently and contact is present, treat as expedite handoff candidate.',
    'Do not expose previous customer memory or personal data when identityState is unverified or pending_match.',
    'Only discuss agency services (web/mobile, UI/UX implementation, automation, AI, SMM).',
    'Reply in user current language when it is clear; fallback to session locale if uncertain.',
    'Return JSON only with keys: answer, topic, leadIntentScore, nextQuestion, requiresLeadCapture.'
  ].join(' ');

  const developerPrompt = [
    'Use provided context fields as source of truth.',
    'Return strict JSON only; never include markdown.',
    'Do not include additional keys.'
  ].join(' ');
  const inputHistory = history.slice(-HISTORY_WINDOW).map((item) => `${item.role}: ${item.content}`).join('\n');
  const currentSignals = extractLeadSignals({history: [], message});
  const shouldBypassModel =
    params.channel === 'web' &&
    isShortFactReply(message) &&
    isQualificationQuestion(getLastAssistantQuestion(history)) &&
    (Boolean(currentSignals.normalizedEmail) ||
      Boolean(currentSignals.normalizedPhone) ||
      Boolean(currentSignals.telegramHandle) ||
      Boolean(currentSignals.timelineHint) ||
      Boolean(currentSignals.budgetHint) ||
      meta.brief.handoffReady);
  if (shouldBypassModel) {
    return fallbackAllowedReply({
      ...params,
      locale: replyLocale,
      identityState
    });
  }

  const requestModelReply = async (retryInstruction?: string) => {
    const startedAt = Date.now();
    const userPrompt = [
      `Session locale=${locale}. Preferred reply locale=${replyLocale}.`,
      `Current missing brief fields: ${meta.brief.missingFields.join(', ') || 'none'}.`,
      `serviceClarifyActive=${meta.serviceClarifyActive}. serviceFamily=${meta.serviceFamily}. serviceDetailScore=${meta.serviceDetailScore}.`,
      `serviceClarifyQuestion=${meta.serviceClarifyNextQuestion ?? 'none'}.`,
      `identityState=${identityState}. memoryLoaded=${memoryLoaded}.`,
      `verificationHint=${params.verificationHint ?? 'none'}.`,
      `briefContext=${JSON.stringify({
        serviceType: meta.mergedDraft.serviceType,
        primaryGoal: meta.mergedDraft.primaryGoal,
        timelineHint: meta.mergedDraft.timelineHint,
        budgetHint: meta.mergedDraft.budgetHint,
        referralSource: meta.mergedDraft.referralSource,
        hasConversationContact: params.briefContext?.hasConversationContact ?? false
      })}`,
      `Conversation context:\n${inputHistory}`,
      `Current user message:\n${message}`,
      retryInstruction ? `Retry instruction:\n${retryInstruction}` : '',
      'Return JSON only.'
    ].filter(Boolean).join('\n\n');

    const completion = await client.chat.completions.create({
      model,
      messages: [
        {role: 'system', content: systemPrompt},
        {role: 'developer', content: developerPrompt},
        {
          role: 'user',
          content: userPrompt
        }
      ],
      max_completion_tokens: REPLY_MAX_OUTPUT_TOKENS
    });
    const usage = completion.usage;
    console.info('[ai] OpenAI usage', {
      path: 'chat/message',
      conversationId: params.conversationId ?? 'unknown',
      model,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      requestId: (completion as {_request_id?: string})._request_id ?? null,
      latencyMs: Date.now() - startedAt,
      retried: Boolean(retryInstruction)
    });
    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = safeJsonParse(content);
    return aiReplySchema.safeParse(parsed);
  };

  let validated: ReturnType<typeof aiReplySchema.safeParse>;
  try {
    validated = await requestModelReply();
  } catch (error) {
    if (isRecoverableOpenAiError(error)) {
      if (error instanceof OpenAI.APIError) {
        console.warn('[ai] OpenAI recoverable error, using fallback', {
          status: error.status,
          code: error.code,
          requestId: error.requestID
        });
      } else {
        console.warn('[ai] OpenAI connection/server error, using fallback');
      }
      return fallbackAllowedReply({
        ...params,
        locale: replyLocale,
        identityState
      });
    }
    throw error;
  }

  if (!validated.success) {
    return fallbackAllowedReply({
      ...params,
      locale: replyLocale,
      identityState
    });
  }

  const lastAssistantAnswers = [...history]
    .filter((item) => item.role === 'assistant')
    .slice(-2)
    .map((item) => item.content);

  let modelReply = validated.data;
  let answer = trimForAnswer(modelReply.answer);
  if (shouldRetryTemplateAnswer({
    answer,
    lastAssistantAnswers,
    highIntent: meta.highIntent,
    handoffReady: meta.brief.handoffReady,
    message
  })) {
    try {
      const retried = await requestModelReply(
        'Your previous answer looked generic or repetitive. Continue exact thread context, avoid generic service list, and ask one targeted next question.'
      );
      if (!retried.success) {
        return fallbackAllowedReply({
          ...params,
          locale: replyLocale,
          identityState
        });
      }
      const retryAnswer = trimForAnswer(retried.data.answer);
      if (templateLikeAnswer(retryAnswer, lastAssistantAnswers)) {
        return fallbackAllowedReply({
          ...params,
          locale: replyLocale,
          identityState
        });
      }
      modelReply = retried.data;
      answer = retryAnswer;
    } catch (error) {
      if (isRecoverableOpenAiError(error)) {
        return fallbackAllowedReply({
          ...params,
          locale: replyLocale,
          identityState
        });
      }
      throw error;
    }
  }

  const normalizedScore = Math.max(0, Math.min(100, Math.round(modelReply.leadIntentScore)));
  let leadIntentScore = Math.max(normalizedScore, meta.highIntent ? 72 : 0, meta.brief.completenessScore >= 80 ? 65 : 0);
  if (!meta.brief.handoffReady && !meta.highIntent) {
    leadIntentScore = Math.min(72, leadIntentScore);
  }

  let composedAnswer = trimForAnswer(answer);
  if (params.verificationHint) {
    composedAnswer = trimForAnswer(`${composedAnswer} ${params.verificationHint}`);
  }
  if (meta.referralPromptRequired) {
    composedAnswer = ensureTargetQuestion(composedAnswer, meta.nextQuestion);
  } else if (meta.serviceClarifyNextQuestion) {
    composedAnswer = ensureTargetQuestion(composedAnswer, meta.serviceClarifyNextQuestion);
  } else if (!meta.brief.handoffReady && !hasQuestion(composedAnswer)) {
    composedAnswer = trimForAnswer(`${composedAnswer} ${meta.nextQuestion}`);
  }
  if (meta.brief.handoffReady) {
    const low = composedAnswer.toLowerCase();
    const mentionsHandoff = low.includes('manager') || low.includes('менеджер') || low.includes('менеджеру');
    if (!mentionsHandoff) {
      composedAnswer = trimForAnswer(`${composedAnswer} ${handoffNotice(replyLocale)}`);
    }
  }
  if (templateLikeAnswer(composedAnswer, lastAssistantAnswers)) {
    composedAnswer = trimForAnswer(`${buildAlternativeAcknowledgement({
      locale: replyLocale,
      signalType: 'progress',
      recentAssistantAnswers: lastAssistantAnswers
    })} ${meta.nextQuestion}`);
  }
  composedAnswer = maybeAddressByName({
    answer: composedAnswer,
    preferredName: meta.preferredName,
    history
  });

  return {
    answer: composedAnswer,
    topic: modelReply.topic === 'disallowed' ? 'allowed' : modelReply.topic,
    leadIntentScore,
    nextQuestion: meta.nextQuestion,
    requiresLeadCapture: false,
    conversationStage: meta.brief.conversationStage,
    missingFields: meta.brief.missingFields,
    handoffReady: meta.brief.handoffReady,
    identityState,
    memoryLoaded,
    verificationHint: params.verificationHint,
    dialogMode: 'context_continuation'
  };
}
