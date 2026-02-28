import OpenAI from 'openai';
import {zodResponseFormat} from 'openai/helpers/zod';
import type {BriefContext, ChatMessage, ChatResponse, Locale, ServiceFamily} from '@/types/lead';
import {aiReplySchema} from './schemas';
import {
  extractLeadSignals,
  getContactOnlyPrompt,
  getIdentityRequestPrompt,
  getNameOnlyPrompt,
  getQualificationPrompt,
  getReferralSourcePrompt,
  hasAreaSignal,
  hasExplicitBudgetSignal,
  wasReferralQuestionAsked,
  mapServiceTypeToFamily
} from '@/lib/lead-signals';
import {computeLeadBriefState, isHighIntentMessage} from '@/lib/lead-brief';

const FAST_MODEL = process.env.OPENAI_FAST_MODEL ?? 'gpt-5-mini';
const QUALITY_MODEL = process.env.OPENAI_QUALITY_MODEL ?? 'gpt-5-mini';
const FALLBACK_MODEL = process.env.OPENAI_FALLBACK_MODEL ?? 'gpt-5-mini';
const OPENAI_MAX_RETRIES = Math.max(0, Number.parseInt(process.env.OPENAI_MAX_RETRIES ?? '0', 10) || 0);
const OPENAI_REPLY_TIMEOUT_MS = Math.max(2500, Number.parseInt(process.env.OPENAI_REPLY_TIMEOUT_MS ?? '8000', 10) || 8000);
const OPENAI_REPLY_FALLBACK_TIMEOUT_MS = Math.max(
  2000,
  Number.parseInt(process.env.OPENAI_REPLY_FALLBACK_TIMEOUT_MS ?? '5000', 10) || 5000
);
const REPLY_MAX_OUTPUT_TOKENS = Math.max(120, Number.parseInt(process.env.OPENAI_MAX_OUTPUT_TOKENS ?? '360', 10) || 360);
const FALLBACK_MAX_OUTPUT_TOKENS = Math.max(100, Number.parseInt(process.env.OPENAI_FALLBACK_MAX_OUTPUT_TOKENS ?? '280', 10) || 280);
const REPHRASE_MAX_OUTPUT_TOKENS = Math.max(80, Number.parseInt(process.env.OPENAI_REPHRASE_MAX_OUTPUT_TOKENS ?? '220', 10) || 220);
const REPLY_REPETITION_THRESHOLD = Math.max(0.55, Math.min(0.95, Number.parseFloat(process.env.OPENAI_REPLY_REPETITION_THRESHOLD ?? '0.74') || 0.74));
const HISTORY_WINDOW = Math.max(2, Number.parseInt(process.env.OPENAI_HISTORY_WINDOW ?? '10', 10) || 10);
const BYPASS_HISTORY_WINDOW = Math.max(2, Math.min(6, Number.parseInt(process.env.OPENAI_BYPASS_HISTORY_WINDOW ?? '4', 10) || 4));

export type LlmDeferReason = 'quota' | 'rate_limit' | 'connection' | 'parse_error';
export type ParseFailReason = 'length_limit' | 'invalid_json' | 'timeout' | null;
type StructuredAiReply = ReturnType<typeof aiReplySchema.parse>;

const BANNED_REPLY_PHRASES: Record<Locale, string[]> = {
  ru: [
    'контекст зафиксировал',
    'контакт увидел, добавил в заявку',
    'понял задачу, двигаемся дальше по брифу',
    'принял контекст, продолжим уточнения'
  ],
  uk: [
    'контекст зафіксував',
    'контакт бачу, додав до заявки',
    'зрозумів запит, продовжуємо бриф'
  ],
  'sr-ME': [
    'kontekst je zabilježen',
    'kontakt sam vidio i dodao u prijavu',
    'razumijem zahtjev, nastavimo sa brief-om'
  ],
  en: [
    'i captured the context',
    'i captured your contact and added it to the brief',
    'understood, let us continue the brief'
  ]
};

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

const PROJECT_DISCUSS_FIRST_HINTS = [
  'давай обсуд', 'сначала обсуд', 'обсудим проект', 'обсудим лендинг', 'задавай вопросы',
  'сперва обсуд', 'без контакта пока',
  'давай обговор', 'спочатку обговор', 'обговоримо проєкт', 'став питання по проєкту',
  'let us discuss', "let's discuss", 'discuss project first', 'talk about the project first', 'ask project questions first',
  'hajde da razgovaramo', 'prvo da razmotrimo projekat', 'pričajmo prvo o projektu'
];

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
      organization: process.env.OPENAI_ORG_ID || undefined,
      maxRetries: OPENAI_MAX_RETRIES,
      timeout: OPENAI_REPLY_TIMEOUT_MS
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

type NextQuestionTarget =
  | 'referral_source'
  | 'identity'
  | 'full_name'
  | 'contact'
  | 'service_type'
  | 'primary_goal'
  | 'timeline_or_budget'
  | 'handoff';

type QuestionSlot = 'identity_bundle' | 'service_type' | 'primary_goal' | 'timeline_or_budget';
type NextQuestionDecision = {question: string; target: NextQuestionTarget};

function parseRawAiReply(input: string): ReturnType<typeof aiReplySchema.safeParse> {
  try {
    return aiReplySchema.safeParse(JSON.parse(input));
  } catch {
    return aiReplySchema.safeParse(null);
  }
}

function stripMarkdownCodeFence(input: string): string {
  const trimmed = input.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1].trim() : trimmed;
}

function extractLikelyJsonObject(input: string): string | null {
  const stripped = stripMarkdownCodeFence(input);
  const start = stripped.indexOf('{');
  const end = stripped.lastIndexOf('}');
  if (start < 0 || end < 0 || end <= start) {
    return null;
  }
  return stripped.slice(start, end + 1);
}

function normalizeJsonLikeText(input: string): string {
  return input
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/,\s*([}\]])/g, '$1');
}

function tryLocalJsonRepair(input: string): {parsed: ReturnType<typeof aiReplySchema.safeParse>; usedRepair: boolean} {
  const direct = parseRawAiReply(input);
  if (direct.success) {
    return {parsed: direct, usedRepair: false};
  }

  const extracted = extractLikelyJsonObject(input);
  if (!extracted) {
    return {parsed: direct, usedRepair: false};
  }

  const repairedCandidate = normalizeJsonLikeText(extracted);
  const repaired = parseRawAiReply(repairedCandidate);
  return {
    parsed: repaired,
    usedRepair: repaired.success
  };
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

function classifyRecoverableReason(error: unknown): LlmDeferReason {
  if (error instanceof OpenAI.APIError) {
    const code = typeof error.code === 'string' ? error.code : '';
    if (code === 'insufficient_quota') {
      return 'quota';
    }
    if (error.status === 429 || code === 'rate_limit_exceeded') {
      return 'rate_limit';
    }
  }
  return 'connection';
}

function classifyParseFailReason(error: unknown): ParseFailReason {
  const errorName = error instanceof Error ? error.name : '';
  const errorMessage = error instanceof Error ? error.message.toLowerCase() : '';
  if (errorName === 'LengthFinishReasonError' || errorMessage.includes('length')) {
    return 'length_limit';
  }
  if (errorName.includes('Timeout') || errorMessage.includes('timeout')) {
    return 'timeout';
  }
  if (error instanceof SyntaxError || errorMessage.includes('json')) {
    return 'invalid_json';
  }
  return null;
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

function containsBannedPhrase(locale: Locale, text: string): boolean {
  const lower = text.toLowerCase();
  return BANNED_REPLY_PHRASES[locale].some((phrase) => lower.includes(phrase));
}

function trimForAnswer(input: string): string {
  const clean = input.trim().replace(/\s+/g, ' ');
  if (clean.length <= 420) {
    return clean;
  }
  return `${clean.slice(0, 417)}...`;
}

function hasAmbiguousNumericBudgetContext(message: string): boolean {
  const hasArea = hasAreaSignal(message);
  const hasBudget = hasExplicitBudgetSignal(message);
  const numericTokens = message.match(/\d[\d\s.,]*/g)?.length ?? 0;
  return hasArea && !hasBudget && numericTokens > 0;
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

type UserAnsweredIntent = 'timeline' | 'budget' | 'contact' | 'service' | 'referral' | 'none';

function detectAnsweredIntentFromHistory(params: {
  message: string;
  history: ChatMessage[];
}): UserAnsweredIntent {
  const lastAssistantQuestion = getLastAssistantQuestion(params.history)?.toLowerCase() ?? '';
  if (!lastAssistantQuestion) {
    return 'none';
  }
  if (/(бюдж|budget|budž|budzet|стоим|price|cost)/i.test(lastAssistantQuestion)) {
    return 'budget';
  }
  if (/(срок|timeline|deadline|launch|термін|rok|duration)/i.test(lastAssistantQuestion)) {
    return 'timeline';
  }
  if (/(email|phone|telegram|контакт|контак|имя|name|kontakt|ime)/i.test(lastAssistantQuestion)) {
    return 'contact';
  }
  if (/(откуда|referral|узнал|heard about|source|izvor|джерел)/i.test(lastAssistantQuestion)) {
    return 'referral';
  }
  if (/(service|услуг|послуг|scenario|конверс|сценар|канал|kpi|ниш|бизнес)/i.test(lastAssistantQuestion)) {
    return 'service';
  }
  return 'none';
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

function maxSimilarityToRecent(answer: string, recentAssistantAnswers: string[]): number {
  if (!recentAssistantAnswers.length) {
    return 0;
  }
  return recentAssistantAnswers.reduce((max, previous) => Math.max(max, similarity(answer, previous)), 0);
}

type GracefulSignalType = 'contact' | 'timeline' | 'budget' | 'area' | 'handoff' | 'progress';

const GRACEFUL_SIGNAL_VARIANTS: Record<Locale, Record<GracefulSignalType, string[]>> = {
  ru: {
    contact: [
      'Отлично, контакт уже есть.',
      'Принял, данные для связи у нас есть.',
      'Спасибо, контакт сохранил для менеджера.'
    ],
    timeline: [
      'По срокам запуска понял.',
      'Ориентир по времени учёл.',
      'Сроки принял, продолжаем.'
    ],
    budget: [
      'Ориентир по бюджету принял.',
      'Рамку по бюджету понял.',
      'Бюджетный диапазон учёл.'
    ],
    area: [
      'Понял параметры по площади, бюджет лучше уточнить отдельно.',
      'Контекст по площадям вижу, финансовый ориентир уточним отдельно.',
      'По площади всё ясно, бюджет давайте зафиксируем отдельно.'
    ],
    handoff: [
      'Контекста уже достаточно для передачи менеджеру.',
      'Данных хватает, передаю дальше в работу менеджеру.',
      'Этого объёма информации достаточно для handoff менеджеру.'
    ],
    progress: [
      'Понял, продолжаем по сути проекта.',
      'Хорошо, двигаемся дальше по деталям.',
      'Контекст понятен, иду к следующему уточнению.'
    ]
  },
  uk: {
    contact: [
      'Чудово, контакт вже є.',
      'Прийняв, дані для зв’язку зафіксовано.',
      'Дякую, контакт збережено для менеджера.'
    ],
    timeline: [
      'За термінами запуску все зрозуміло.',
      'Орієнтир за часом врахував.',
      'Терміни прийняв, рухаємось далі.'
    ],
    budget: [
      'Орієнтир бюджету прийняв.',
      'Рамку бюджету зрозумів.',
      'Бюджетний діапазон врахував.'
    ],
    area: [
      'Контекст площі зрозумілий, бюджет краще уточнити окремо.',
      'Параметри площі бачу, фінансовий орієнтир уточнимо окремо.',
      'За площею все ясно, бюджет зафіксуємо окремо.'
    ],
    handoff: [
      'Контексту вже достатньо для передачі менеджеру.',
      'Даних вистачає, передаю менеджеру в роботу.',
      'Цього обсягу інформації достатньо для handoff менеджеру.'
    ],
    progress: [
      'Зрозумів, рухаємось по суті проєкту.',
      'Добре, переходимо до наступного уточнення.',
      'Контекст ясний, продовжуємо далі.'
    ]
  },
  'sr-ME': {
    contact: [
      'Odlično, kontakt već imamo.',
      'U redu, podaci za kontakt su sačuvani.',
      'Hvala, kontakt je zabilježen za menadžera.'
    ],
    timeline: [
      'Rok pokretanja je jasan.',
      'Vremenski okvir sam uzeo u obzir.',
      'Rok je prihvaćen, idemo dalje.'
    ],
    budget: [
      'Budžetski okvir je prihvaćen.',
      'Razumio sam okvir budžeta.',
      'Budžetski raspon je uzet u obzir.'
    ],
    area: [
      'Parametri površine su jasni, budžet je bolje potvrditi odvojeno.',
      'Kontekst površine je jasan, finansijski okvir ćemo potvrditi odvojeno.',
      'Površina je jasna, budžet ćemo precizirati posebno.'
    ],
    handoff: [
      'Imamo dovoljno konteksta za predaju menadžeru.',
      'Podataka je dovoljno, predajem menadžeru u obradu.',
      'Ovaj nivo detalja je dovoljan za handoff menadžeru.'
    ],
    progress: [
      'Razumio sam, nastavljamo suštinu projekta.',
      'U redu, idemo dalje kroz detalje.',
      'Kontekst je jasan, prelazimo na sledeće pojašnjenje.'
    ]
  },
  en: {
    contact: [
      'Great, we already have your contact.',
      'Understood, contact details are in place.',
      'Thanks, contact information is saved for the manager.'
    ],
    timeline: [
      'Got it on the launch timeline.',
      'I captured the timing expectations.',
      'Timeline noted, moving forward.'
    ],
    budget: [
      'Got your budget direction.',
      'I captured the budget range.',
      'Budget frame is clear, moving on.'
    ],
    area: [
      'The area context is clear; budget should be confirmed separately.',
      'I captured the area constraints, and we should clarify budget separately.',
      'Area details are clear, budget is better confirmed separately.'
    ],
    handoff: [
      'We already have enough context for manager handoff.',
      'The brief is detailed enough to pass to a manager.',
      'This level of detail is sufficient for handoff.'
    ],
    progress: [
      'Understood, let us continue with project details.',
      'Clear context, moving to the next clarification.',
      'Got it, continuing the brief flow.'
    ]
  }
};

function chooseGracefulVariant(params: {
  locale: Locale;
  signalType: GracefulSignalType;
  recentAssistantAnswers: string[];
}): string {
  const variants = GRACEFUL_SIGNAL_VARIANTS[params.locale][params.signalType];
  for (const variant of variants) {
    const repeated = params.recentAssistantAnswers.some((previous) =>
      similarity(previous, variant) >= 0.66 || previous.toLowerCase().includes(variant.toLowerCase())
    );
    if (!repeated) {
      return variant;
    }
  }
  const indexSeed = params.recentAssistantAnswers.join('|').length;
  return variants[indexSeed % variants.length];
}

function buildGracefulSignalSummary(params: {
  locale: Locale;
  hasContact: boolean;
  hasTimeline: boolean;
  hasBudget: boolean;
  hasAreaWithoutBudget: boolean;
  handoffReady: boolean;
  recentAssistantAnswers: string[];
}): string {
  if (params.locale === 'ru') {
    if (params.hasContact) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'contact', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasAreaWithoutBudget) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'area', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasTimeline) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'timeline', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasBudget) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'budget', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.handoffReady) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'handoff', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    return chooseGracefulVariant({locale: params.locale, signalType: 'progress', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.locale === 'uk') {
    if (params.hasContact) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'contact', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasAreaWithoutBudget) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'area', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasTimeline) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'timeline', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasBudget) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'budget', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.handoffReady) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'handoff', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    return chooseGracefulVariant({locale: params.locale, signalType: 'progress', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.locale === 'sr-ME') {
    if (params.hasContact) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'contact', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasAreaWithoutBudget) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'area', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasTimeline) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'timeline', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.hasBudget) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'budget', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    if (params.handoffReady) {
      return chooseGracefulVariant({locale: params.locale, signalType: 'handoff', recentAssistantAnswers: params.recentAssistantAnswers});
    }
    return chooseGracefulVariant({locale: params.locale, signalType: 'progress', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.hasContact) {
    return chooseGracefulVariant({locale: params.locale, signalType: 'contact', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.hasAreaWithoutBudget) {
    return chooseGracefulVariant({locale: params.locale, signalType: 'area', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.hasTimeline) {
    return chooseGracefulVariant({locale: params.locale, signalType: 'timeline', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.hasBudget) {
    return chooseGracefulVariant({locale: params.locale, signalType: 'budget', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  if (params.handoffReady) {
    return chooseGracefulVariant({locale: params.locale, signalType: 'handoff', recentAssistantAnswers: params.recentAssistantAnswers});
  }
  return chooseGracefulVariant({locale: params.locale, signalType: 'progress', recentAssistantAnswers: params.recentAssistantAnswers});
}

function getQuestionSlotOrder(deferContactUntilBriefComplete = false): QuestionSlot[] {
  return deferContactUntilBriefComplete
    ? ['service_type', 'primary_goal', 'timeline_or_budget', 'identity_bundle']
    : ['identity_bundle', 'service_type', 'primary_goal', 'timeline_or_budget'];
}

function resolveQuestionForSlot(params: {
  slot: QuestionSlot;
  locale: Locale;
  missingFields: string[];
  hasBudget: boolean;
  hasTimeline: boolean;
}): NextQuestionDecision | null {
  const missing = new Set(params.missingFields);
  if (params.slot === 'identity_bundle') {
    const needsFullName = missing.has('full_name');
    const needsContact = missing.has('contact');
    if (needsFullName && needsContact) {
      return {question: getIdentityRequestPrompt(params.locale), target: 'identity'};
    }
    if (needsFullName) {
      return {question: getNameOnlyPrompt(params.locale), target: 'full_name'};
    }
    if (needsContact) {
      return {question: getContactOnlyPrompt(params.locale), target: 'contact'};
    }
    return null;
  }
  if (params.slot === 'service_type' && missing.has('service_type')) {
    return {question: serviceTypePrompt[params.locale], target: 'service_type'};
  }
  if (params.slot === 'primary_goal' && missing.has('primary_goal')) {
    return {question: primaryGoalPrompt[params.locale], target: 'primary_goal'};
  }
  if (params.slot === 'timeline_or_budget' && missing.has('timeline_or_budget')) {
    return {
      question: getQualificationPrompt({
        locale: params.locale,
        hasScope: true,
        hasBudget: params.hasBudget,
        hasTimeline: params.hasTimeline
      }),
      target: 'timeline_or_budget'
    };
  }
  return null;
}

function chooseNextQuestionDecision(params: {
  locale: Locale;
  missingFields: string[];
  hasBudget: boolean;
  hasTimeline: boolean;
  askReferralSource?: boolean;
  deferContactUntilBriefComplete?: boolean;
}): NextQuestionDecision {
  if (params.askReferralSource) {
    return {question: getReferralSourcePrompt(params.locale), target: 'referral_source'};
  }
  for (const slot of getQuestionSlotOrder(params.deferContactUntilBriefComplete)) {
    const resolved = resolveQuestionForSlot({
      slot,
      locale: params.locale,
      missingFields: params.missingFields,
      hasBudget: params.hasBudget,
      hasTimeline: params.hasTimeline
    });
    if (resolved) {
      return resolved;
    }
  }
  return {
    question: getQualificationPrompt({
      locale: params.locale,
      hasScope: true,
      hasBudget: true,
      hasTimeline: true
    }),
    target: 'handoff'
  };
}

function mapTargetToSlot(target: NextQuestionTarget): QuestionSlot | null {
  if (target === 'identity' || target === 'full_name' || target === 'contact') {
    return 'identity_bundle';
  }
  if (target === 'service_type' || target === 'primary_goal' || target === 'timeline_or_budget') {
    return target;
  }
  return null;
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

function isMeaningfulUserMessage(message: string): boolean {
  const cleaned = cleanText(message);
  if (!cleaned) {
    return false;
  }
  if (isShortFactReply(cleaned)) {
    return false;
  }
  if (cleaned.length < 20) {
    return false;
  }
  return /[A-Za-zА-Яа-яЁёІіЇїЄє]/.test(cleaned);
}

function hasRecentScopedUserContext(history: ChatMessage[]): boolean {
  const recentUserMessages = history
    .filter((item) => item.role === 'user')
    .slice(-4);
  return recentUserMessages.some((item) => isLikelyAllowed(item.content));
}

function isProjectDiscussionFirstIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return PROJECT_DISCUSS_FIRST_HINTS.some((hint) => lower.includes(hint));
}

function isProjectContextContinuationAfterContactPrompt(params: {
  history: ChatMessage[];
  message: string;
  currentTurnSignals: ReturnType<typeof extractLeadSignals>;
  hasDirectContactInCurrentMessage: boolean;
}): boolean {
  if (!hasRecentIdentityCapturePrompt(params.history) || params.hasDirectContactInCurrentMessage) {
    return false;
  }
  if (!isMeaningfulUserMessage(params.message)) {
    return false;
  }
  return Boolean(
    params.currentTurnSignals.hasScope
    || params.currentTurnSignals.hasBudget
    || params.currentTurnSignals.hasTimeline
    || hasMeaningfulPrimaryGoal(params.currentTurnSignals.primaryGoal)
  );
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

function shouldAdvanceFromDuplicateQuestion(params: {
  history: ChatMessage[];
  nextQuestion: string;
  message: string;
}): boolean {
  if (!isMeaningfulUserMessage(params.message)) {
    return false;
  }
  const lastAssistantQuestion = getLastAssistantQuestion(params.history);
  if (!lastAssistantQuestion) {
    return false;
  }
  const normalizedLast = lastAssistantQuestion.toLowerCase();
  const normalizedNext = params.nextQuestion.toLowerCase();
  return normalizedLast.includes(normalizedNext) || similarity(lastAssistantQuestion, params.nextQuestion) >= 0.72;
}

function getNextQuestionAfterDuplicate(params: {
  locale: Locale;
  currentTarget: NextQuestionTarget;
  missingFields: string[];
  hasBudget: boolean;
  hasTimeline: boolean;
  deferContactUntilBriefComplete: boolean;
}): NextQuestionDecision | null {
  const currentSlot = mapTargetToSlot(params.currentTarget);
  if (!currentSlot) {
    return null;
  }
  const order = getQuestionSlotOrder(params.deferContactUntilBriefComplete);
  const currentIndex = order.indexOf(currentSlot);
  if (currentIndex < 0) {
    return null;
  }
  for (const slot of order.slice(currentIndex + 1)) {
    const resolved = resolveQuestionForSlot({
      slot,
      locale: params.locale,
      missingFields: params.missingFields,
      hasBudget: params.hasBudget,
      hasTimeline: params.hasTimeline
    });
    if (resolved) {
      return resolved;
    }
  }
  return null;
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
  contactDeferralActive: boolean;
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
  if (hasRecentIdentityCapturePrompt(params.history) && !params.contactDeferralActive) {
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
  const currentTurnSignals = extractLeadSignals({history: [], message: params.message});
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
    const completenessScore = Math.max(0, Math.min(100, Math.round(((4 - missingFields.length) / 4) * 100)));
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
  const historyInScope = hasRecentScopedUserContext(params.history);
  const hasMeaningfulGoalContext = hasMeaningfulPrimaryGoal(mergedDraft.primaryGoal) || hasMeaningfulPrimaryGoal(mergedDraft.firstDeliverable);
  const shortReplyContinuation =
    isShortFactReply(params.message) &&
    isQualificationQuestion(getLastAssistantQuestion(params.history));
  const conversationInScope = messageInScope || contextHasScope || shortReplyContinuation || historyInScope || hasMeaningfulGoalContext;
  const serviceFamily = signals.serviceFamily !== 'unknown'
    ? signals.serviceFamily
    : mapServiceTypeToFamily(mergedDraft.serviceType);
  const hasContact = Boolean(
    mergedDraft.email ||
    mergedDraft.phone ||
    mergedDraft.telegramHandle ||
    params.briefContext?.hasConversationContact
  );
  const hasDirectContactInCurrentMessage = Boolean(
    currentTurnSignals.normalizedEmail
    || currentTurnSignals.normalizedPhone
    || currentTurnSignals.telegramHandle
  );
  const hasProjectMissingFields = brief.missingFields.some((field) =>
    field === 'service_type' || field === 'primary_goal' || field === 'timeline_or_budget'
  );
  const contactDeferralActive = !hasContact
    && !highIntent
    && hasProjectMissingFields
    && (
      isProjectDiscussionFirstIntent(params.message)
      || isProjectContextContinuationAfterContactPrompt({
        history: params.history,
        message: params.message,
        currentTurnSignals,
        hasDirectContactInCurrentMessage
      })
    );
  const serviceDetailScore = computeServiceDetailScore({
    serviceFamily,
    primaryGoal: mergedDraft.primaryGoal,
    firstDeliverable: mergedDraft.firstDeliverable,
    constraints: mergedDraft.constraints,
    message: params.message
  });

  const defaultNextQuestionDecision = chooseNextQuestionDecision({
    locale: params.locale,
    missingFields: brief.missingFields,
    hasBudget: Boolean(mergedDraft.budgetHint) || signals.hasBudget,
    hasTimeline: Boolean(mergedDraft.timelineHint) || signals.hasTimeline,
    askReferralSource: shouldAskReferralOnce,
    deferContactUntilBriefComplete: contactDeferralActive
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
    handoffReady: coreHandoffReady || shouldAskReferralOnce,
    contactDeferralActive
  });
  let nextQuestion = shouldAskReferralOnce
    ? defaultNextQuestionDecision.question
    : (serviceClarify.nextQuestion ?? defaultNextQuestionDecision.question);
  let nextQuestionTarget: NextQuestionTarget = shouldAskReferralOnce
    ? defaultNextQuestionDecision.target
    : (serviceClarify.nextQuestion ? 'primary_goal' : defaultNextQuestionDecision.target);

  if (shouldAdvanceFromDuplicateQuestion({
    history: params.history,
    nextQuestion,
    message: params.message
  })) {
    const advancedQuestion = getNextQuestionAfterDuplicate({
      locale: params.locale,
      currentTarget: nextQuestionTarget,
      missingFields: brief.missingFields,
      hasBudget: Boolean(mergedDraft.budgetHint) || signals.hasBudget,
      hasTimeline: Boolean(mergedDraft.timelineHint) || signals.hasTimeline,
      deferContactUntilBriefComplete: contactDeferralActive
    });
    if (advancedQuestion) {
      nextQuestion = advancedQuestion.question;
      nextQuestionTarget = advancedQuestion.target;
    }
  }

  return {
    signals,
    brief,
    mergedDraft,
    preferredName: extractPreferredFirstName(mergedDraft.fullName),
    highIntent,
    nextQuestion,
    nextQuestionTarget,
    conversationInScope,
    serviceFamily,
    serviceDetailScore,
    serviceClarifyNextQuestion: serviceClarify.nextQuestion,
    askedServiceClarifySteps: serviceClarify.askedStepsForFamily,
    serviceClarifyActive: serviceClarify.active,
    referralPromptRequired: shouldAskReferralOnce,
    contactDeferralActive
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

type TopicGuard = 'allowed' | 'unclear' | 'disallowed';

function getTopicGuard(message: string, conversationInScope: boolean): TopicGuard {
  if (conversationInScope) {
    return 'allowed';
  }
  return isClearlyOutOfScope(message) ? 'disallowed' : 'unclear';
}

function computeLeadIntentScore(params: {
  normalizedScore: number;
  highIntent: boolean;
  handoffReady: boolean;
  completenessScore: number;
}): number {
  let leadIntentScore = Math.max(
    params.normalizedScore,
    params.highIntent ? 72 : 0,
    params.completenessScore >= 80 ? 65 : 0
  );
  if (!params.handoffReady && !params.highIntent) {
    leadIntentScore = Math.min(72, leadIntentScore);
  }
  return leadIntentScore;
}

function buildGuardPrefix(locale: Locale, topicGuard: TopicGuard): string {
  if (topicGuard === 'allowed') {
    return '';
  }
  if (locale === 'ru') {
    return topicGuard === 'disallowed'
      ? 'Понял запрос, но нужно оставаться в рамках цифровой разработки и автоматизации.'
      : 'Понял, уточню направление, чтобы ответить точнее.';
  }
  if (locale === 'uk') {
    return topicGuard === 'disallowed'
      ? 'Зрозумів запит, але потрібно залишатися в межах цифрової розробки та автоматизації.'
      : 'Зрозумів, уточню напрям, щоб відповісти точніше.';
  }
  if (locale === 'sr-ME') {
    return topicGuard === 'disallowed'
      ? 'Razumio sam upit, ali treba da ostanemo u okviru digitalnog razvoja i automatizacije.'
      : 'Razumio sam, pojasniću pravac da odgovor bude precizan.';
  }
  return topicGuard === 'disallowed'
    ? 'Understood your request, but we should stay within digital product and automation scope.'
    : 'Understood, I will clarify direction to respond precisely.';
}

function getNonRepeatingLead(locale: Locale): string {
  if (locale === 'ru') {
    return 'Уточнение принял, продолжаю по контексту.';
  }
  if (locale === 'uk') {
    return 'Уточнення прийняв, продовжую за контекстом.';
  }
  if (locale === 'sr-ME') {
    return 'Pojašnjenje je primljeno, nastavljam po kontekstu.';
  }
  return 'Clarification received, continuing with context.';
}

function buildGracefulFailAnswer(params: {
  locale: Locale;
  topicGuard: TopicGuard;
  hasContact: boolean;
  hasTimeline: boolean;
  hasBudget: boolean;
  hasAreaWithoutBudget: boolean;
  handoffReady: boolean;
  recentAssistantAnswers: string[];
}): string {
  const prefix = buildGuardPrefix(params.locale, params.topicGuard);
  const summary = buildGracefulSignalSummary({
    locale: params.locale,
    hasContact: params.hasContact,
    hasTimeline: params.hasTimeline,
    hasBudget: params.hasBudget,
    hasAreaWithoutBudget: params.hasAreaWithoutBudget,
    handoffReady: params.handoffReady,
    recentAssistantAnswers: params.recentAssistantAnswers
  });
  return trimForAnswer([prefix, summary].filter(Boolean).join(' '));
}

function applyAnswerConstraints(params: {
  answer: string;
  topicGuard: TopicGuard;
  locale: Locale;
  nextQuestion: string;
  verificationHint?: string;
  handoffReady: boolean;
}): string {
  let composed = trimForAnswer(params.answer);
  if (params.verificationHint) {
    composed = trimForAnswer(`${composed} ${params.verificationHint}`);
  }
  if (params.topicGuard !== 'allowed') {
    return ensureTargetQuestion(composed, scopeClarifyPrompt[params.locale]);
  }
  composed = ensureTargetQuestion(composed, params.nextQuestion);
  if (params.handoffReady) {
    const low = composed.toLowerCase();
    const mentionsHandoff = low.includes('manager') || low.includes('менеджер') || low.includes('менеджеру');
    if (!mentionsHandoff) {
      composed = trimForAnswer(`${composed} ${handoffNotice(params.locale)}`);
    }
  }
  return composed;
}

async function requestStructuredReply(params: {
  conversationId?: string;
  model: string;
  maxOutputTokens: number;
  systemPrompt: string;
  developerPrompt: string;
  userPrompt: string;
  path: string;
  stage: string;
  timeoutMs?: number;
}): Promise<{
  parsed: StructuredAiReply | null;
  content: string;
  recoverableReason: LlmDeferReason | null;
  parseFailReason: ParseFailReason;
  jsonRepairUsed: boolean;
  requestId: string | null;
  latencyMs: number;
  tokenCapHit: boolean;
}> {
  if (!client) {
    return {
      parsed: null,
      content: '',
      recoverableReason: 'connection',
      parseFailReason: 'timeout',
      jsonRepairUsed: false,
      requestId: null,
      latencyMs: 0,
      tokenCapHit: false
    };
  }
  const startedAt = Date.now();
  try {
    const completion = await client.chat.completions.parse({
      model: params.model,
      messages: [
        {role: 'system', content: params.systemPrompt},
        {role: 'developer', content: params.developerPrompt},
        {role: 'user', content: params.userPrompt}
      ],
      response_format: zodResponseFormat(aiReplySchema, 'ai_reply'),
      max_completion_tokens: params.maxOutputTokens
    }, {
      timeout: params.timeoutMs ?? OPENAI_REPLY_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES
    });
    const usage = completion.usage;
    const latencyMs = Date.now() - startedAt;
    const tokenCapHit = (usage?.completion_tokens ?? 0) >= Math.max(params.maxOutputTokens - 2, 1);
    console.info('[ai] OpenAI usage', {
      path: params.path,
      stage: params.stage,
      conversationId: params.conversationId ?? 'unknown',
      model: params.model,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      requestId: (completion as {_request_id?: string})._request_id ?? null,
      latencyMs,
      tokenCapHit
    });
    const content = completion.choices[0]?.message?.content ?? '';
    const parsed = completion.choices[0]?.message?.parsed ?? null;
    if (parsed) {
      return {
        parsed,
        content,
        recoverableReason: null,
        parseFailReason: null,
        jsonRepairUsed: false,
        requestId: (completion as {_request_id?: string})._request_id ?? null,
        latencyMs,
        tokenCapHit
      };
    }

    if (content) {
      const repaired = tryLocalJsonRepair(content);
      if (repaired.parsed.success) {
        return {
          parsed: repaired.parsed.data,
          content,
          recoverableReason: null,
          parseFailReason: null,
          jsonRepairUsed: repaired.usedRepair,
          requestId: (completion as {_request_id?: string})._request_id ?? null,
          latencyMs,
          tokenCapHit
        };
      }
    }

    return {
      parsed: null,
      content,
      recoverableReason: null,
      parseFailReason: 'invalid_json',
      jsonRepairUsed: false,
      requestId: (completion as {_request_id?: string})._request_id ?? null,
      latencyMs,
      tokenCapHit
    };
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    const parseFailReason = classifyParseFailReason(error);
    if (parseFailReason) {
      return {
        parsed: null,
        content: '',
        recoverableReason: null,
        parseFailReason,
        jsonRepairUsed: false,
        requestId: null,
        latencyMs,
        tokenCapHit: parseFailReason === 'length_limit'
      };
    }

    if (isRecoverableOpenAiError(error)) {
      if (error instanceof OpenAI.APIError) {
        console.warn('[ai] Recoverable OpenAI error while requesting structured reply', {
          path: params.path,
          stage: params.stage,
          status: error.status,
          code: error.code,
          requestId: error.requestID,
          model: params.model
        });
      } else {
        console.warn('[ai] Recoverable connection/server error while requesting structured reply', {
          path: params.path,
          stage: params.stage,
          model: params.model
        });
      }
      return {
        parsed: null,
        content: '',
        recoverableReason: classifyRecoverableReason(error),
        parseFailReason: classifyParseFailReason(error),
        jsonRepairUsed: false,
        requestId: null,
        latencyMs,
        tokenCapHit: false
      };
    }
    throw error;
  }
}

async function requestTextReply(params: {
  conversationId?: string;
  model: string;
  maxOutputTokens: number;
  messages: Array<{role: 'system' | 'developer' | 'user'; content: string}>;
  path: string;
  stage: string;
  timeoutMs?: number;
}): Promise<{text: string | null; recoverableReason: LlmDeferReason | null}> {
  if (!client) {
    return {text: null, recoverableReason: 'connection'};
  }
  const startedAt = Date.now();
  try {
    const completion = await client.chat.completions.create({
      model: params.model,
      messages: params.messages,
      max_completion_tokens: params.maxOutputTokens
    }, {
      timeout: params.timeoutMs ?? OPENAI_REPLY_TIMEOUT_MS,
      maxRetries: OPENAI_MAX_RETRIES
    });
    const usage = completion.usage;
    console.info('[ai] OpenAI usage', {
      path: params.path,
      stage: params.stage,
      conversationId: params.conversationId ?? 'unknown',
      model: params.model,
      inputTokens: usage?.prompt_tokens ?? null,
      outputTokens: usage?.completion_tokens ?? null,
      totalTokens: usage?.total_tokens ?? null,
      requestId: (completion as {_request_id?: string})._request_id ?? null,
      latencyMs: Date.now() - startedAt
    });
    return {text: cleanText(completion.choices[0]?.message?.content ?? null), recoverableReason: null};
  } catch (error) {
    if (isRecoverableOpenAiError(error)) {
      if (error instanceof OpenAI.APIError) {
        console.warn('[ai] Recoverable OpenAI error while requesting text reply', {
          path: params.path,
          stage: params.stage,
          status: error.status,
          code: error.code,
          requestId: error.requestID,
          model: params.model
        });
      } else {
        console.warn('[ai] Recoverable connection/server error while requesting text reply', {
          path: params.path,
          stage: params.stage,
          model: params.model
        });
      }
      return {
        text: null,
        recoverableReason: classifyRecoverableReason(error)
      };
    }
    throw error;
  }
}

function toScopedResponse(params: {
  locale: Locale;
  topicGuard: TopicGuard;
  answer: string;
  leadIntentScore: number;
  meta: ReturnType<typeof getConversationMeta>;
  identityState: 'unverified' | 'pending_match' | 'verified';
  memoryLoaded: boolean;
  verificationHint?: string;
  fallbackModelUsed?: boolean;
  gracefulFailUsed?: boolean;
  rephraseUsed?: boolean;
  templateBlockTriggered?: boolean;
  repetitionScore?: number | null;
  llmReplyDeferred?: boolean;
  deferReason?: LlmDeferReason | null;
  llmCallsCount?: number;
  jsonRepairUsed?: boolean;
  sameModelFallbackSkipped?: boolean;
  parseFailReason?: ParseFailReason;
  replyLatencyMs?: number | null;
}): ChatResponse {
  if (params.topicGuard !== 'allowed') {
    return {
      answer: params.answer,
      topic: params.topicGuard,
      leadIntentScore: params.topicGuard === 'disallowed' ? 0 : 20,
      nextQuestion: scopeClarifyPrompt[params.locale],
      requiresLeadCapture: false,
      conversationStage: 'discovery',
      missingFields: ['service_type', 'primary_goal'],
      handoffReady: false,
      identityState: params.identityState,
      memoryLoaded: params.memoryLoaded,
      verificationHint: params.verificationHint,
      dialogMode: params.topicGuard === 'disallowed' ? 'disallowed' : 'scope_clarify',
      fallbackModelUsed: params.fallbackModelUsed ?? false,
      gracefulFailUsed: params.gracefulFailUsed ?? false,
      rephraseUsed: params.rephraseUsed ?? false,
      templateBlockTriggered: params.templateBlockTriggered ?? false,
      repetitionScore: params.repetitionScore ?? null,
      llmReplyDeferred: params.llmReplyDeferred ?? false,
      deferReason: params.deferReason ?? null,
      topicGuard: params.topicGuard,
      llmCallsCount: params.llmCallsCount ?? 0,
      jsonRepairUsed: params.jsonRepairUsed ?? false,
      sameModelFallbackSkipped: params.sameModelFallbackSkipped ?? false,
      parseFailReason: params.parseFailReason ?? null,
      replyLatencyMs: params.replyLatencyMs ?? null
    };
  }

  return {
    answer: params.answer,
    topic: 'allowed',
    leadIntentScore: params.leadIntentScore,
    nextQuestion: params.meta.nextQuestion,
    requiresLeadCapture: false,
    conversationStage: params.meta.brief.conversationStage,
    missingFields: params.meta.brief.missingFields,
    handoffReady: params.meta.brief.handoffReady,
    identityState: params.identityState,
    memoryLoaded: params.memoryLoaded,
    verificationHint: params.verificationHint,
    dialogMode: 'context_continuation',
    fallbackModelUsed: params.fallbackModelUsed ?? false,
    gracefulFailUsed: params.gracefulFailUsed ?? false,
    rephraseUsed: params.rephraseUsed ?? false,
    templateBlockTriggered: params.templateBlockTriggered ?? false,
    repetitionScore: params.repetitionScore ?? null,
    llmReplyDeferred: params.llmReplyDeferred ?? false,
    deferReason: params.deferReason ?? null,
    topicGuard: params.topicGuard,
    llmCallsCount: params.llmCallsCount ?? 0,
    jsonRepairUsed: params.jsonRepairUsed ?? false,
    sameModelFallbackSkipped: params.sameModelFallbackSkipped ?? false,
    parseFailReason: params.parseFailReason ?? null,
    replyLatencyMs: params.replyLatencyMs ?? null
  };
}

function buildGracefulFallbackResponse(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
  identityState: 'unverified' | 'pending_match' | 'verified';
  memoryLoaded?: boolean;
  verificationHint?: string;
  briefContext?: BriefContext;
  channel: 'web' | 'telegram' | 'instagram' | 'facebook' | 'whatsapp';
  topicGuard: TopicGuard;
  deferReason?: LlmDeferReason | null;
  fallbackModelUsed?: boolean;
  rephraseUsed?: boolean;
  templateBlockTriggered?: boolean;
  repetitionScore?: number | null;
  llmCallsCount?: number;
  jsonRepairUsed?: boolean;
  sameModelFallbackSkipped?: boolean;
  parseFailReason?: ParseFailReason;
  replyLatencyMs?: number | null;
}): ChatResponse {
  const meta = getConversationMeta({
    locale: params.locale,
    message: params.message,
    history: params.history,
    briefContext: params.briefContext,
    identityState: params.identityState,
    channel: params.channel
  });
  const currentTurnSignals = extractLeadSignals({history: [], message: params.message});
  const hasContact = Boolean(currentTurnSignals.normalizedEmail || currentTurnSignals.normalizedPhone || currentTurnSignals.telegramHandle);
  const hasTimeline = Boolean(currentTurnSignals.timelineHint);
  const hasBudget = Boolean(currentTurnSignals.budgetHint) && !hasAmbiguousNumericBudgetContext(params.message);
  const hasAreaWithoutBudget = hasAmbiguousNumericBudgetContext(params.message) && !hasBudget;
  const recentAssistantAnswers = params.history
    .filter((item) => item.role === 'assistant')
    .slice(-2)
    .map((item) => item.content);
  const nextQuestion = params.topicGuard === 'allowed' ? meta.nextQuestion : scopeClarifyPrompt[params.locale];
  const base = buildGracefulFailAnswer({
    locale: params.locale,
    topicGuard: params.topicGuard,
    hasContact,
    hasTimeline,
    hasBudget,
    hasAreaWithoutBudget,
    handoffReady: meta.brief.handoffReady,
    recentAssistantAnswers
  });
  const constrained = applyAnswerConstraints({
    answer: base,
    topicGuard: params.topicGuard,
    locale: params.locale,
    nextQuestion,
    verificationHint: params.verificationHint,
    handoffReady: params.topicGuard === 'allowed' && meta.brief.handoffReady
  });
  const repetitionScore = maxSimilarityToRecent(constrained, recentAssistantAnswers);
  const adjusted = repetitionScore >= REPLY_REPETITION_THRESHOLD
    ? ensureTargetQuestion(getNonRepeatingLead(params.locale), nextQuestion)
    : constrained;
  const personalized = maybeAddressByName({
    answer: adjusted,
    preferredName: meta.preferredName,
    history: params.history
  });
  return toScopedResponse({
    locale: params.locale,
    topicGuard: params.topicGuard,
    answer: personalized,
    leadIntentScore: computeLeadIntentScore({
      normalizedScore: 0,
      highIntent: meta.highIntent,
      handoffReady: meta.brief.handoffReady,
      completenessScore: meta.brief.completenessScore
    }),
    meta,
    identityState: params.identityState,
    memoryLoaded: params.memoryLoaded ?? false,
    verificationHint: params.verificationHint,
    fallbackModelUsed: params.fallbackModelUsed ?? false,
    gracefulFailUsed: true,
    rephraseUsed: params.rephraseUsed ?? false,
    templateBlockTriggered: params.templateBlockTriggered ?? true,
    repetitionScore: params.repetitionScore ?? repetitionScore,
    llmReplyDeferred: true,
    deferReason: params.deferReason ?? 'connection',
    llmCallsCount: params.llmCallsCount ?? 0,
    jsonRepairUsed: params.jsonRepairUsed ?? false,
    sameModelFallbackSkipped: params.sameModelFallbackSkipped ?? false,
    parseFailReason: params.parseFailReason ?? null,
    replyLatencyMs: params.replyLatencyMs ?? null
  });
}

export type GeneratedReplyDiagnostics = {
  answer: string;
  usedLlm: boolean;
  fallbackModelUsed: boolean;
  gracefulFailUsed: boolean;
  rephraseUsed: boolean;
  templateBlockTriggered: boolean;
  repetitionScore: number | null;
  llmReplyDeferred: boolean;
  deferReason: LlmDeferReason | null;
};

export type LowCostContextReply = GeneratedReplyDiagnostics;
export type HandoffTerminalReply = GeneratedReplyDiagnostics;

function pickNonRepeatingVariant(variants: string[], recentAssistantAnswers: string[]): string {
  for (const variant of variants) {
    const repeated = recentAssistantAnswers.some((previous) =>
      similarity(previous, variant) >= 0.66 || previous.toLowerCase().includes(variant.toLowerCase())
    );
    if (!repeated) {
      return variant;
    }
  }
  const indexSeed = recentAssistantAnswers.join('|').length;
  return variants[indexSeed % variants.length];
}

function buildLowCostGracefulAnswer(params: {
  locale: Locale;
  remainingMessages: number;
  recentAssistantAnswers: string[];
}): string {
  const baseVariants: Record<Locale, string[]> = {
    ru: [
      'Уточнение учёл, команда менеджера уже смотрит заявку.',
      'Деталь добавил, менеджер уже в процессе.',
      'Принял это уточнение, заявка уже у менеджера в работе.'
    ],
    uk: [
      'Уточнення врахував, команда менеджера вже переглядає заявку.',
      'Деталь додав, менеджер вже в процесі.',
      'Прийняв це уточнення, заявка вже в менеджера в роботі.'
    ],
    'sr-ME': [
      'Pojašnjenje je dodato, menadžer već obrađuje zahtjev.',
      'Detalj je unijet, menadžer je već u toku.',
      'Primio sam ovo pojašnjenje, zahtjev je već kod menadžera.'
    ],
    en: [
      'Clarification added, the manager is already reviewing your request.',
      'I noted this detail, and a manager is already on it.',
      'Thanks, this update is recorded and the manager is already processing it.'
    ]
  };
  const base = pickNonRepeatingVariant(baseVariants[params.locale], params.recentAssistantAnswers);
  if (params.locale === 'ru') {
    return params.remainingMessages > 0
      ? `${base} Можно отправить ещё ${params.remainingMessages} уточнение.`
      : base;
  }
  if (params.locale === 'uk') {
    return params.remainingMessages > 0
      ? `${base} Можна надіслати ще ${params.remainingMessages} уточнення.`
      : base;
  }
  if (params.locale === 'sr-ME') {
    return params.remainingMessages > 0
      ? `${base} Možete poslati još ${params.remainingMessages} pojašnjenje.`
      : base;
  }
  return params.remainingMessages > 0
    ? `${base} You can send ${params.remainingMessages} more clarification.`
    : base;
}

export async function generateLowCostContextReply(params: {
  locale: Locale;
  message: string;
  history: ChatMessage[];
  remainingMessages: number;
  conversationId?: string;
}): Promise<LowCostContextReply> {
  const recentAssistantAnswers = params.history
    .filter((item) => item.role === 'assistant')
    .slice(-2)
    .map((item) => item.content);

  const graceful = (reason: LlmDeferReason = 'connection', templateBlockTriggered = false, repetitionScore: number | null = null): LowCostContextReply => ({
    answer: trimForAnswer(buildLowCostGracefulAnswer({
      locale: params.locale,
      remainingMessages: params.remainingMessages,
      recentAssistantAnswers
    })),
    usedLlm: false,
    fallbackModelUsed: false,
    gracefulFailUsed: true,
    rephraseUsed: false,
    templateBlockTriggered,
    repetitionScore,
    llmReplyDeferred: true,
    deferReason: reason
  });

  if (!client) {
    return graceful();
  }

  const userPrompt = [
    `Locale=${params.locale}.`,
    'You are in post-handoff clarification mode.',
    `Remaining clarifications before pause=${params.remainingMessages}.`,
    `Recent assistant replies:\n${recentAssistantAnswers.join('\n') || '(none)'}`,
    `Current user message:\n${params.message}`,
    'Write 1-2 concise human sentences.',
    'Acknowledge that the clarification was added and manager is reviewing.',
    'If remaining clarifications > 0, mention the exact number.',
    'Avoid repeating opening words from recent assistant replies.'
  ].join('\n\n');

  const tryReply = async (model: string, stage: string): Promise<{text: string | null; reason: LlmDeferReason | null}> => {
    const result = await requestTextReply({
      conversationId: params.conversationId,
      model,
      maxOutputTokens: Math.min(FALLBACK_MAX_OUTPUT_TOKENS, 180),
      path: 'chat/message_low_cost',
      stage,
      messages: [
        {role: 'system', content: 'Write natural client-facing acknowledgements. No canned templates. Max 2 sentences.'},
        {role: 'developer', content: 'Do not output JSON or markdown. Return plain text only.'},
        {role: 'user', content: userPrompt}
      ]
    });
    return {
      text: result.text,
      reason: result.recoverableReason
    };
  };

  let usedModel = FAST_MODEL;
  let deferReason: LlmDeferReason | null = null;
  let attempt = await tryReply(FAST_MODEL, 'low_cost_primary');
  let answer = attempt.text;
  deferReason = attempt.reason ?? deferReason;
  let fallbackModelUsed = false;
  if (!answer) {
    fallbackModelUsed = true;
    usedModel = FALLBACK_MODEL;
    attempt = await tryReply(FALLBACK_MODEL, 'low_cost_fallback');
    answer = attempt.text;
    deferReason = attempt.reason ?? deferReason;
  }
  if (!answer) {
    return graceful(deferReason ?? 'connection');
  }

  let composed = trimForAnswer(answer);
  let repetitionScore = maxSimilarityToRecent(composed, recentAssistantAnswers);
  let rephraseUsed = false;
  const templateBlockTriggered = repetitionScore >= REPLY_REPETITION_THRESHOLD
    || templateLikeAnswer(composed, recentAssistantAnswers)
    || containsBannedPhrase(params.locale, composed);
  if (templateBlockTriggered) {
    const rephrased = await requestTextReply({
      conversationId: params.conversationId,
      model: usedModel,
      maxOutputTokens: REPHRASE_MAX_OUTPUT_TOKENS,
      path: 'chat/message_low_cost',
      stage: 'low_cost_rephrase',
      messages: [
        {role: 'system', content: 'Rewrite the answer to sound human and non-repetitive. Keep intent and locale.'},
        {role: 'developer', content: 'Output plain text only. Keep it 1-2 short sentences.'},
        {role: 'user', content: `Recent replies:\n${recentAssistantAnswers.join('\n') || '(none)'}\n\nOriginal answer:\n${composed}`}
      ]
    });
    if (!rephrased.text) {
      return graceful(rephrased.recoverableReason ?? deferReason ?? 'connection', true, repetitionScore);
    }
    composed = trimForAnswer(rephrased.text);
    repetitionScore = maxSimilarityToRecent(composed, recentAssistantAnswers);
    if (containsBannedPhrase(params.locale, composed)) {
      return graceful('parse_error', true, repetitionScore);
    }
    rephraseUsed = true;
  }

  return {
    answer: composed,
    usedLlm: true,
    fallbackModelUsed,
    gracefulFailUsed: false,
    rephraseUsed,
    templateBlockTriggered,
    repetitionScore,
    llmReplyDeferred: false,
    deferReason: null
  };
}

function buildHandoffTerminalGracefulAnswer(params: {
  locale: Locale;
  cooldownHours: number;
  recentAssistantAnswers: string[];
}): string {
  const variants: Record<Locale, string[]> = {
    ru: [
      `Передал заявку менеджеру, команда уже начала работу. Следующее сообщение в чате будет доступно через ${params.cooldownHours} часа.`,
      `Заявка уже у менеджера и обработка запущена. Написать в этот чат снова можно через ${params.cooldownHours} часа.`,
      `Лид передан менеджеру, работа начата. Следующее сообщение в чате станет доступно через ${params.cooldownHours} часа.`
    ],
    uk: [
      `Заявку передано менеджеру, команда вже почала роботу. Наступне повідомлення в чаті буде доступне через ${params.cooldownHours} години.`,
      `Заявка вже у менеджера і обробку запущено. Написати в цей чат знову можна через ${params.cooldownHours} години.`,
      `Лід передано менеджеру, роботу розпочато. Наступне повідомлення в чаті стане доступним через ${params.cooldownHours} години.`
    ],
    'sr-ME': [
      `Zahtjev je predat menadžeru i obrada je već počela. Sledeća poruka u chatu biće dostupna za ${params.cooldownHours} sata.`,
      `Prijava je već kod menadžera i tim je krenuo sa obradom. U chat možete pisati ponovo za ${params.cooldownHours} sata.`,
      `Lead je proslijeđen menadžeru, posao je pokrenut. Sledeća poruka u chatu biće dostupna za ${params.cooldownHours} sata.`
    ],
    en: [
      `Your request is now with the manager and processing has started. The next message in this chat will be available in ${params.cooldownHours} hours.`,
      `The lead has been handed to a manager and work is in progress. You can send the next message in this chat in ${params.cooldownHours} hours.`,
      `A manager has received your request and started processing it. The next message in this chat will be available in ${params.cooldownHours} hours.`
    ]
  };
  return pickNonRepeatingVariant(variants[params.locale], params.recentAssistantAnswers);
}

export async function generateHandoffTerminalReply(params: {
  locale: Locale;
  history: ChatMessage[];
  conversationId?: string;
  cooldownHours?: number;
}): Promise<HandoffTerminalReply> {
  const cooldownHours = Math.max(1, Math.round(params.cooldownHours ?? 3));
  const recentAssistantAnswers = params.history
    .filter((item) => item.role === 'assistant')
    .slice(-2)
    .map((item) => item.content);

  const graceful = (
    reason: LlmDeferReason = 'connection',
    templateBlockTriggered = false,
    repetitionScore: number | null = null
  ): HandoffTerminalReply => ({
    answer: trimForAnswer(buildHandoffTerminalGracefulAnswer({
      locale: params.locale,
      cooldownHours,
      recentAssistantAnswers
    })),
    usedLlm: false,
    fallbackModelUsed: false,
    gracefulFailUsed: true,
    rephraseUsed: false,
    templateBlockTriggered,
    repetitionScore,
    llmReplyDeferred: true,
    deferReason: reason
  });

  if (!client) {
    return graceful('connection');
  }

  const userPrompt = [
    `Locale=${params.locale}.`,
    `Cooldown hours=${cooldownHours}.`,
    `Recent assistant replies:\n${recentAssistantAnswers.join('\n') || '(none)'}`,
    'Write exactly 2 short sentences in a natural human style.',
    'Sentence 1 must say the request is handed to manager and processing started.',
    `Sentence 2 must say the next message in this chat is available in ${cooldownHours} hours.`,
    'Avoid canned opening phrases and avoid repeating previous opening clauses.'
  ].join('\n\n');

  const tryReply = async (model: string, stage: string): Promise<{text: string | null; reason: LlmDeferReason | null}> => {
    const result = await requestTextReply({
      conversationId: params.conversationId,
      model,
      maxOutputTokens: Math.min(FALLBACK_MAX_OUTPUT_TOKENS, 180),
      path: 'chat/handoff_terminal',
      stage,
      messages: [
        {role: 'system', content: 'Write natural client-facing handoff confirmation. No templates. Plain text only.'},
        {role: 'developer', content: 'Do not output JSON or markdown. Keep it to 2 short sentences.'},
        {role: 'user', content: userPrompt}
      ]
    });
    return {text: result.text, reason: result.recoverableReason};
  };

  let usedModel = FAST_MODEL;
  let deferReason: LlmDeferReason | null = null;
  let attempt = await tryReply(FAST_MODEL, 'handoff_terminal_primary');
  let answer = attempt.text;
  deferReason = attempt.reason ?? deferReason;
  let fallbackModelUsed = false;
  if (!answer) {
    fallbackModelUsed = true;
    usedModel = FALLBACK_MODEL;
    attempt = await tryReply(FALLBACK_MODEL, 'handoff_terminal_fallback');
    answer = attempt.text;
    deferReason = attempt.reason ?? deferReason;
  }
  if (!answer) {
    return graceful(deferReason ?? 'connection');
  }

  let composed = trimForAnswer(answer);
  let repetitionScore = maxSimilarityToRecent(composed, recentAssistantAnswers);
  let rephraseUsed = false;
  const templateBlockTriggered = repetitionScore >= REPLY_REPETITION_THRESHOLD
    || templateLikeAnswer(composed, recentAssistantAnswers)
    || containsBannedPhrase(params.locale, composed);
  if (templateBlockTriggered) {
    const rephrased = await requestTextReply({
      conversationId: params.conversationId,
      model: usedModel,
      maxOutputTokens: REPHRASE_MAX_OUTPUT_TOKENS,
      path: 'chat/handoff_terminal',
      stage: 'handoff_terminal_rephrase',
      messages: [
        {role: 'system', content: 'Rewrite the handoff message to sound human and non-repetitive.'},
        {role: 'developer', content: 'Keep two short sentences, plain text only.'},
        {role: 'user', content: `Recent replies:\n${recentAssistantAnswers.join('\n') || '(none)'}\n\nOriginal answer:\n${composed}`}
      ]
    });
    if (!rephrased.text) {
      return graceful(rephrased.recoverableReason ?? deferReason ?? 'connection', true, repetitionScore);
    }
    composed = trimForAnswer(rephrased.text);
    repetitionScore = maxSimilarityToRecent(composed, recentAssistantAnswers);
    if (containsBannedPhrase(params.locale, composed)) {
      return graceful('parse_error', true, repetitionScore);
    }
    rephraseUsed = true;
  }

  return {
    answer: composed,
    usedLlm: true,
    fallbackModelUsed,
    gracefulFailUsed: false,
    rephraseUsed,
    templateBlockTriggered,
    repetitionScore,
    llmReplyDeferred: false,
    deferReason: null
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
  deferState?: {
    llmReplyDeferred?: boolean;
    deferReason?: LlmDeferReason | null;
  };
  channel: 'web' | 'telegram' | 'instagram' | 'facebook' | 'whatsapp';
}): Promise<ChatResponse> {
  // Legacy function - returns graceful fallback for backward compatibility with tests
  // New code should use runConversationalEngine from conversation-integration
  const {locale, message, history} = params;
  const replyLocale = detectReplyLanguage(message, history, locale);
  const identityState = params.identityState ?? 'unverified';
  const memoryLoaded = params.memoryLoaded ?? false;
  
  // Return graceful fallback response
  return {
    answer: locale === 'ru' 
      ? 'Понял ваш вопрос. Для получения персонализированного ответа, пожалуйста, опишите задачу подробнее.'
      : locale === 'uk'
      ? 'Зрозумів ваше запитання. Для отримання персоналізованої відповіді, будь ласка, опишіть задачу детальніше.'
      : locale === 'sr-ME'
      ? 'Razumio sam vaše pitanje. Za personalizovani odgovor, molim opišite zadatak detaljnije.'
      : 'I understand your question. For a personalized answer, please describe your task in more detail.',
    topic: 'allowed',
    leadIntentScore: 50,
    nextQuestion: locale === 'ru'
      ? 'Какой цифровой продукт или услугу нужно сделать в первую очередь?'
      : locale === 'uk'
      ? 'Який цифровий продукт або послугу потрібно зробити в першу чергу?'
      : locale === 'sr-ME'
      ? 'Koji digitalni proizvod ili uslugu treba prvo da uradimo?'
      : 'What digital product or service should we build first?',
    requiresLeadCapture: false,
    conversationStage: 'discovery',
    missingFields: ['service_type', 'primary_goal'],
    handoffReady: false,
    identityState,
    memoryAccess: 'session_only' as const,
    memoryLoaded,
    dialogMode: 'scope_clarify',
    llmReplyDeferred: false,
    deferReason: null,
    fallbackModelUsed: false,
    gracefulFailUsed: true,
    rephraseUsed: false,
    templateBlockTriggered: false,
    repetitionScore: null,
    topicGuard: 'allowed',
    llmCallsCount: 0,
    jsonRepairUsed: false,
    sameModelFallbackSkipped: false,
    parseFailReason: null,
    replyLatencyMs: 0,
    dialogTurnMode: 'progress',
    questionsCount: 1,
    fallbackPath: 'deterministic',
    validatorAdjusted: false
  };
}
