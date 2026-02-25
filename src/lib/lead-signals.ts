import type {ChatMessage, Locale, ServiceFamily} from '@/types/lead';

export type LeadSignals = {
  name: string | null;
  email: string | null;
  phone: string | null;
  telegramHandle: string | null;
  normalizedEmail: string | null;
  normalizedPhone: string | null;
  serviceType: string | null;
  primaryGoal: string | null;
  firstDeliverable: string | null;
  timelineHint: string | null;
  timelineNormalized: string | null;
  budgetHint: string | null;
  budgetRaw: string | null;
  budgetNormalized: string | null;
  referralSource: string | null;
  constraints: string | null;
  serviceFamily: ServiceFamily;
  hasScope: boolean;
  hasBudget: boolean;
  hasTimeline: boolean;
  userMessageCount: number;
};

const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i;
const PHONE_RE = /(?:\+?\d[\d\s().-]{7,}\d)/;
const TELEGRAM_HANDLE_RE = /\B@([A-Za-z][A-Za-z0-9_]{4,31})\b/;
const TELEGRAM_LINK_RE = /(?:https?:\/\/)?t\.me\/([A-Za-z][A-Za-z0-9_]{4,31})\b/i;

const NAME_STOPWORDS = new Set([
  'хочу', 'нужно', 'надо', 'ready', 'need', 'want', 'project', 'задача',
  'мой', 'моя', 'меня', 'номер', 'телефон', 'контакт', 'email', 'почта',
  'telegram', 'телеграм', 'phone', 'name', 'call', 'budget', 'timeline',
  'да', 'нет', 'yes', 'no', 'ok', 'okay', 'ага', 'угу', 'ок'
]);

const NAME_PATTERNS: RegExp[] = [
  /(?:my name is|name is|i am|i'm)\s+([A-Za-z][A-Za-z'-]{1,39})/i,
  /(?:меня зовут|мо[её] имя)\s+([А-ЯA-Z][А-Яа-яA-Za-zЁё'-]{1,39})/i,
  /([А-ЯA-Z][А-Яа-яA-Za-zЁё'-]{1,39})\s+(?:меня зовут|мо[её] имя)(?=$|[\s.,!?;:])/i,
  /(?:мене звати|моє ім'?я)\s+([А-ЯA-Z][А-Яа-яA-Za-zЁёІіЇїЄє'-]{1,39})/i,
  /([А-ЯA-Z][А-Яа-яA-Za-zЁёІіЇїЄє'-]{1,39})\s+(?:мене звати|моє ім'?я)(?=$|[\s.,!?;:])/i,
  /(?<![A-Za-zА-Яа-яЁёІіЇїЄє])я\s+([А-ЯA-Z][А-Яа-яA-Za-zЁё'-]{2,39})(?=$|[\s.,!?;:])/i
];

const SERVICE_MAP: Array<{type: string; hints: string[]}> = [
  {type: 'landing_website', hints: ['landing', 'website', 'site', 'лендинг', 'сайт', 'лендінг', 'sajt']},
  {
    type: 'web_app',
    hints: [
      'web app', 'dashboard', 'portal', 'веб-прилож', 'кабинет', 'портал', 'web aplikac',
      'application', 'приложен', 'застосунк', 'aplikac'
    ]
  },
  {type: 'mobile_app', hints: ['mobile', 'ios', 'android', 'мобиль', 'мобайл', 'додаток']},
  {
    type: 'branding_logo',
    hints: [
      'branding', 'brand identity', 'logo', 'logotype', 'brandbook', 'guideline',
      'логотип', 'брендинг', 'айдентик', 'фирстил',
      'логотип', 'брендинг', 'айдентик', 'фірмов',
      'brending', 'logo', 'vizuelni identitet', 'vizuelni identitet'
    ]
  },
  {type: 'automation', hints: ['automation', 'workflow', 'crm', 'интеграц', 'автоматизац', 'automatiz', 'integrac']},
  {type: 'ai_assistant', hints: ['ai', 'assistant', 'chatbot', 'ии', 'бот', 'чат-бот']},
  {type: 'smm_growth', hints: ['smm', 'seo', 'marketing', 'маркет', 'продвижен']},
  {type: 'ui_ux', hints: ['ui', 'ux', 'figma', 'дизайн', 'prototype']}
];

const BUDGET_HINTS = [
  'budget', 'price', 'cost', 'estimate', 'usd', 'eur', '$', '€', '£', '¥',
  'бюджет', 'стоим', 'цена', 'смет', 'евро', 'доллар', 'руб',
  'бюджет', 'вартіст', 'кошторис', 'грн',
  'budžet', 'cijena', 'cena', 'eur', 'usd'
];

const TIMELINE_HINTS = [
  'timeline', 'deadline', 'asap', 'urgent', 'week', 'month', 'launch',
  'срок', 'дедлайн', 'срочно', 'недел', 'месяц', 'запуск',
  'термін', 'дедлайн', 'тиж', 'місяц',
  'rok', 'hitno', 'sedmic', 'nedelj', 'mesec', 'mjesec'
];

const NO_DEADLINE_HINTS = [
  'сроки не важ', 'срок не важ', 'сроки не крит', 'дедлайн не важ', 'без дедлайн', 'не срочно',
  'термін не важ', 'строки не важ', 'без дедлайну', 'не терміново',
  'timeline is flexible', 'no deadline', 'not important', 'not critical', 'no rush', 'flexible timeline',
  'rok nije bitan', 'rok nije važan', 'nije hitno', 'fleksibilan rok'
];

const ASAP_HINTS = [
  'asap', 'urgent', 'as soon as possible', 'как можно скорее', 'срочно', 'поскорее',
  'якнайшвидше', 'терміново', 'što prije', 'hitno'
];

const UP_TO_BUDGET_HINTS = ['up to', 'under', 'max', 'maximum', 'less than', 'до', 'не более', 'максимум', 'najviše'];
const APPROX_BUDGET_HINTS = ['about', 'around', 'approx', '~', 'примерно', 'около', 'где-то', 'орієнтовно', 'otprilike', 'oko'];
const BUDGET_NUMBER_HINTS = ['k', 'к', 'm', 'м', 'тыс', 'thousand', 'млн', 'million'];

const CURRENCY_HINTS: Array<{code: string; regex: RegExp}> = [
  {code: 'EUR', regex: /(?:€|\beur\b|\beuro\b|\beuros\b|евро|evra)/i},
  {code: 'USD', regex: /(?:\$|\busd\b|\bdollar\b|\bdollars\b|доллар)/i},
  {code: 'GBP', regex: /(?:£|\bgbp\b|\bpound\b|\bpounds\b)/i},
  {code: 'RUB', regex: /(?:руб|\brub\b|₽)/i},
  {code: 'UAH', regex: /(?:грн|\buah\b|₴)/i},
  // Keep "дин" as standalone currency token only to avoid matching words like "лендинг".
  {code: 'RSD', regex: /(?:\brsd\b|\bdin\b|\bdinar\b|(?<![A-Za-zА-Яа-яЁёІіЇїЄє])дин(?:ар(?:а|ов)?|\.?)?(?![A-Za-zА-Яа-яЁёІіЇїЄє]))/i},
  {code: 'CHF', regex: /\bchf\b/i},
  {code: 'AED', regex: /\baed\b/i}
];

const CONSTRAINT_HINTS = ['without', 'must', 'need to', 'без', 'обязательно', 'нужно чтобы', 'потрібно'];
const CONTACT_REQUEST_HINTS = [
  'ваше имя', 'вашe имя', 'контакт', 'телефон', 'email', 'telegram',
  'name', 'contact', 'phone', 'telegram',
  'ime', 'kontakt', 'telefon',
  "ім'я", 'контакт', 'телефон', 'пошта'
];
const NAME_REQUEST_HINTS = [
  'как к вам обращаться', 'как вас зовут', 'ваше имя', 'вашe имя',
  'what is your name', 'your name', 'name',
  'kako da vam se obra', 'kako se zovete', 'ime',
  "як до вас звертатися", "як вас звати", "ваше ім'я"
];
const REFERRAL_REQUEST_HINTS = [
  'откуда вы узнали о нас', 'где вы о нас узнали', 'по рекомендации',
  'where did you hear about us', 'how did you hear about us', 'where did you find us',
  'heard about us', 'find us',
  'gdje ste čuli za nas', 'kako ste čuli za nas',
  'звідки ви дізналися про нас', 'як ви дізналися про нас', 'дізналися про нас'
];
const REFERRAL_LOW_SIGNAL = new Set([
  'да', 'нет', 'не знаю', 'yes', 'no', 'idk', 'не помню', 'unknown', 'n/a',
  'ok', 'okay', 'хорошо', 'ладно', 'добре', 'u redu'
]);
const REFERRAL_EXPLICIT_PATTERNS: RegExp[] = [
  /(узнал(?:а|и)?\s+о\s+вас|наш[её]л(?:а|и)?\s+вас|по\s+рекомендац)/i,
  /(звідки\s+дізнал(?:ися|ась)|дізнав(?:ся|лася)\s+про\s+вас|за\s+рекомендац)/i,
  /(heard about you|heard about us|found you|found us|referred by|came from)/i,
  /(čuo\s+za\s+vas|saznao\s+za\s+vas|preko\s+preporuk)/i
];
const MAX_SHORT_CONTACT_REPLY_LENGTH = 96;
const MAX_SHORT_NAME_REPLY_LENGTH = 48;
const NO_DEADLINE_PATTERNS: RegExp[] = [
  /\b(?:no|without)\s+deadline\b/i,
  /\btimeline\s+is\s+flexible\b/i,
  /\bnot\s+important\b/i,
  /\bnot\s+critical\b/i,
  /\bflexible\b/i,
  /без\s+дедлайн/i,
  /не\s+сроч/i,
  /срок[а-яёіїє]*\s*(?:пока\s*)?не\s*(?:важ|крит)/i,
  /срок[а-яёіїє]*\s*(?:не\s*)?важн/i,
  /термін[а-яёіїє]*\s*(?:не\s*)?важ/i,
  /строк[а-яёіїє]*\s*(?:не\s*)?важ/i,
  /\brok\s+nije\s+(?:bitan|važan)\b/i,
  /\bnije\s+hitno\b/i
];
const DATE_RANGE_PATTERNS: RegExp[] = [
  /\bnext\s+(week|month|quarter)\b/i,
  /\bthis\s+(week|month|quarter)\b/i,
  /следующ[а-яёіїє]+\s+(недел[а-яёіїє]+|месяц[а-яёіїє]+|квартал[а-яёіїє]+)/i,
  /эт[а-яёіїє]+\s+(недел[а-яёіїє]+|месяц[а-яёіїє]+|квартал[а-яёіїє]+)/i,
  /наступн[а-яёіїє]+\s+(тиж[а-яёіїє]+|місяц[а-яёіїє]+|квартал[а-яёіїє]+)/i,
  /\bov(aj|e)\s+(mjesec|nedelj\w+|sedmic\w+|kvartal)\b/i
];

function normalize(input: string): string {
  return input.toLowerCase();
}

function clean(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function firstMatch(regex: RegExp, text: string): string | null {
  const match = text.match(regex);
  return clean(match?.[0] ?? null);
}

function extractNameByPatterns(text: string): string | null {
  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    const candidate = clean(match?.[1] ?? null)?.replace(/[.,!?;:]+$/g, '') ?? null;
    if (!candidate) {
      continue;
    }
    if (NAME_STOPWORDS.has(candidate.toLowerCase())) {
      continue;
    }
    return candidate;
  }
  return null;
}

function normalizeNameToken(token: string): string | null {
  const cleaned = token
    .trim()
    .replace(/^[^A-Za-zА-Яа-яЁёІіЇїЄє'-]+/g, '')
    .replace(/[^A-Za-zА-Яа-яЁёІіЇїЄє'-]+$/g, '');
  if (!cleaned) {
    return null;
  }
  if (!/^[A-Za-zА-Яа-яЁёІіЇїЄє][A-Za-zА-Яа-яЁёІіЇїЄє'-]{1,39}$/.test(cleaned)) {
    return null;
  }
  const lower = cleaned.toLowerCase();
  if (NAME_STOPWORDS.has(lower)) {
    return null;
  }
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

function wasIdentityRequestedRecently(history: ChatMessage[]): boolean {
  const recentAssistantMessages = history
    .slice(-6)
    .filter((item) => item.role === 'assistant')
    .slice(-3);
  return recentAssistantMessages.some((item) => {
    const content = item.content.toLowerCase();
    return includesAny(content, CONTACT_REQUEST_HINTS);
  });
}

function hasContactSignal(text: string): boolean {
  return Boolean(
    firstMatch(EMAIL_RE, text) ||
    firstMatch(PHONE_RE, text) ||
    extractTelegramHandle(text)
  );
}

function extractNameFromShortContactReply(params: {message: string; history: ChatMessage[]}): string | null {
  const currentMessage = clean(params.message);
  if (!currentMessage) {
    return null;
  }
  if (currentMessage.length > MAX_SHORT_CONTACT_REPLY_LENGTH) {
    return null;
  }
  if (!wasIdentityRequestedRecently(params.history) || !hasContactSignal(currentMessage)) {
    return null;
  }

  const [firstPart] = currentMessage.split(',', 1);
  const firstToken = clean(firstPart ?? currentMessage)?.split(/\s+/)[0] ?? '';
  if (!firstToken || /\d/.test(firstToken)) {
    return null;
  }

  return normalizeNameToken(firstToken);
}

function wasNameRequestedRecently(history: ChatMessage[]): boolean {
  const recentAssistantMessages = history
    .slice(-6)
    .filter((item) => item.role === 'assistant')
    .slice(-3);
  return recentAssistantMessages.some((item) => {
    const content = item.content.toLowerCase();
    return includesAny(content, NAME_REQUEST_HINTS);
  });
}

function extractNameFromShortNameReply(params: {message: string; history: ChatMessage[]}): string | null {
  const currentMessage = clean(params.message);
  if (!currentMessage) {
    return null;
  }
  if (currentMessage.length > MAX_SHORT_NAME_REPLY_LENGTH) {
    return null;
  }
  if (!wasNameRequestedRecently(params.history)) {
    return null;
  }
  if (hasContactSignal(currentMessage)) {
    return null;
  }
  const words = currentMessage.split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 4) {
    return null;
  }
  const candidateToken = words[0] ?? '';
  return normalizeNameToken(candidateToken);
}

function cleanReferralSource(value: string): string | null {
  const normalized = clean(value)?.replace(/\s+/g, ' ') ?? null;
  if (!normalized) {
    return null;
  }
  if (normalized.length > 240) {
    return `${normalized.slice(0, 240)}...`;
  }
  return normalized;
}

export function wasReferralQuestionAsked(history: ChatMessage[]): boolean {
  const recentAssistantMessages = history
    .slice(-8)
    .filter((item) => item.role === 'assistant')
    .slice(-4);
  return recentAssistantMessages.some((item) => {
    const content = item.content.toLowerCase();
    return includesAny(content, REFERRAL_REQUEST_HINTS);
  });
}

function extractReferralSource(params: {message: string; history: ChatMessage[]}): string | null {
  const currentMessage = cleanReferralSource(params.message);
  if (!currentMessage) {
    return null;
  }
  if (REFERRAL_EXPLICIT_PATTERNS.some((pattern) => pattern.test(currentMessage))) {
    return currentMessage;
  }
  if (!wasReferralQuestionAsked(params.history)) {
    return null;
  }
  const lower = currentMessage.toLowerCase();
  if (REFERRAL_LOW_SIGNAL.has(lower)) {
    return null;
  }
  return currentMessage;
}

function normalizeEmail(email: string | null): string | null {
  return email ? email.toLowerCase() : null;
}

function normalizePhone(phone: string | null): string | null {
  if (!phone) {
    return null;
  }
  const withLeadingPlus = phone.trim().startsWith('+');
  const digits = phone.replace(/[^\d]/g, '');
  if (digits.length < 8) {
    return null;
  }
  return withLeadingPlus ? `+${digits}` : `+${digits}`;
}

function extractTelegramHandle(text: string): string | null {
  const byHandle = text.match(TELEGRAM_HANDLE_RE)?.[1];
  if (byHandle) {
    return `@${byHandle}`;
  }

  const byLink = text.match(TELEGRAM_LINK_RE)?.[1];
  if (byLink) {
    return `@${byLink}`;
  }

  return null;
}

function includesAny(text: string, hints: string[]): boolean {
  return hints.some((hint) => text.includes(hint));
}

function detectServiceType(textLower: string): string | null {
  for (const entry of SERVICE_MAP) {
    if (includesAny(textLower, entry.hints)) {
      return entry.type;
    }
  }
  if (/\bapp\b/i.test(textLower)) {
    return 'web_app';
  }
  return null;
}

export function mapServiceTypeToFamily(serviceType?: string | null): ServiceFamily {
  if (!serviceType) {
    return 'unknown';
  }
  if (serviceType === 'landing_website' || serviceType === 'web_app' || serviceType === 'mobile_app') {
    return 'website_app';
  }
  if (serviceType === 'branding_logo') {
    return 'branding_logo';
  }
  if (serviceType === 'automation') {
    return 'automation';
  }
  if (serviceType === 'ai_assistant') {
    return 'ai_assistant';
  }
  if (serviceType === 'ui_ux') {
    return 'ui_ux';
  }
  if (serviceType === 'smm_growth') {
    return 'smm_growth';
  }
  return 'unknown';
}

function splitSentences(text: string): string[] {
  return text
    .split(/\n|[.!?]/)
    .map((line) => clean(line))
    .filter((line): line is string => Boolean(line));
}

function firstSentenceByHints(text: string, hints: string[]): string | null {
  const sentences = splitSentences(text);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (includesAny(lower, hints)) {
      return sentence;
    }
  }
  return null;
}

function detectCurrencyCode(text: string): string | null {
  for (const entry of CURRENCY_HINTS) {
    if (entry.regex.test(text)) {
      return entry.code;
    }
  }
  return null;
}

function parseAmountToken(input: string): number | null {
  const raw = input.trim().toLowerCase();
  if (!raw) {
    return null;
  }

  let multiplier = 1;
  if (/(k|к|тыс|thousand)\b/i.test(raw)) {
    multiplier = 1000;
  } else if (/(m|м|млн|million)\b/i.test(raw)) {
    multiplier = 1000000;
  }

  let numeric = raw
    .replace(/(k|к|тыс|thousand|m|м|млн|million)\b/gi, '')
    .replace(/[^\d.,]/g, '')
    .trim();
  if (!numeric) {
    return null;
  }

  if (numeric.includes('.') && numeric.includes(',')) {
    numeric = numeric.replace(/,/g, '');
  } else if (numeric.includes(',') && !numeric.includes('.')) {
    numeric = numeric.replace(',', '.');
  }

  const value = Number.parseFloat(numeric);
  if (!Number.isFinite(value)) {
    return null;
  }
  const normalized = Math.round(value * multiplier);
  return normalized > 0 ? normalized : null;
}

function hasBudgetIndicators(params: {lower: string; currency: string | null}): boolean {
  if (params.currency) {
    return true;
  }
  if (includesAny(params.lower, BUDGET_HINTS) || includesAny(params.lower, UP_TO_BUDGET_HINTS) || includesAny(params.lower, APPROX_BUDGET_HINTS)) {
    return true;
  }
  return BUDGET_NUMBER_HINTS.some((hint) => params.lower.includes(hint));
}

type BudgetParse = {
  raw: string;
  normalized: string;
};

function parseBudgetHint(text: string): BudgetParse | null {
  const cleaned = clean(text);
  if (!cleaned) {
    return null;
  }
  const lower = cleaned.toLowerCase();
  const currency = detectCurrencyCode(cleaned);
  const hasIndicators = hasBudgetIndicators({lower, currency});

  const rangeMatch = cleaned.match(/([~≈]?\s*\d[\d\s.,]*(?:\s?(?:k|к|m|м|тыс|thousand|млн|million))?)\s*[-–—]\s*([~≈]?\s*\d[\d\s.,]*(?:\s?(?:k|к|m|м|тыс|thousand|млн|million))?)/i);
  if (rangeMatch) {
    const leftToken = (rangeMatch[1] ?? '').trim();
    const rightToken = (rangeMatch[2] ?? '').trim();
    const rightUnit = rightToken.match(/(k|к|m|м|тыс|thousand|млн|million)$/i)?.[1] ?? null;
    const normalizedLeftToken = rightUnit && !/\b(k|к|m|м|тыс|thousand|млн|million)\b/i.test(leftToken)
      ? `${leftToken}${rightUnit}`
      : leftToken;
    const first = parseAmountToken(normalizedLeftToken);
    const second = parseAmountToken(rightToken);
    if (first && second) {
      const min = Math.min(first, second);
      const max = Math.max(first, second);
      return {
        raw: rangeMatch[0].trim(),
        normalized: `${currency ?? 'UNKNOWN'} ${min}-${max}`
      };
    }
  }

  if (!hasIndicators) {
    return null;
  }
  const singleMatch = cleaned.match(/([~≈]?\s*\d[\d\s.,]*(?:\s?(?:k|к|m|м|тыс|thousand|млн|million))?)/i);
  if (!singleMatch) {
    return null;
  }
  const token = singleMatch[1] ?? '';
  const justDigits = token.replace(/[^\d]/g, '');
  if (!currency && !includesAny(lower, BUDGET_HINTS) && !/(k|к|m|м|тыс|thousand|млн|million)\b/i.test(token) && justDigits.length >= 8) {
    return null;
  }
  const amount = parseAmountToken(token);
  if (!amount) {
    return null;
  }

  const isUpTo = includesAny(lower, UP_TO_BUDGET_HINTS);
  const isApprox = includesAny(lower, APPROX_BUDGET_HINTS);
  let normalized = `${currency ?? 'UNKNOWN'} ${amount}`;
  if (isUpTo) {
    normalized = `up_to ${currency ?? 'UNKNOWN'} ${amount}`;
  } else if (isApprox) {
    normalized = `approx ${currency ?? 'UNKNOWN'} ${amount}`;
  }

  return {
    raw: token.trim(),
    normalized
  };
}

type TimelineParse = {
  raw: string;
  normalized: string;
};

function parseTimelineHint(text: string): TimelineParse | null {
  const cleaned = clean(text);
  if (!cleaned) {
    return null;
  }
  const lower = cleaned.toLowerCase();
  const sentences = splitSentences(cleaned);

  const noDeadlineByPattern = NO_DEADLINE_PATTERNS.find((pattern) => pattern.test(cleaned));
  if (noDeadlineByPattern) {
    return {raw: cleaned, normalized: 'no_deadline'};
  }
  const noDeadlineSentence = sentences.find((sentence) => includesAny(sentence.toLowerCase(), NO_DEADLINE_HINTS));
  if (noDeadlineSentence) {
    return {raw: noDeadlineSentence, normalized: 'no_deadline'};
  }

  const asapSentence = sentences.find((sentence) => includesAny(sentence.toLowerCase(), ASAP_HINTS));
  if (asapSentence) {
    return {raw: asapSentence, normalized: 'asap'};
  }

  const durationMatch = cleaned.match(/(\d{1,3})\s*(day|days|week|weeks|month|months|year|years|дн(?:я|ей|и)?|день|недел[ьяию]|недел[яи]|месяц(?:а|ев)?|год(?:а|ов)?|тиж(?:день|ні|нів)?|місяц(?:і|ів)?|рік|роки|god(?:ine)?|nedelj[aeu]?|sedmic[aeu]?|mjesec(?:a|i)?|mesec(?:a|i)?)/i);
  if (durationMatch) {
    const count = Number.parseInt(durationMatch[1] ?? '0', 10);
    const unitRaw = (durationMatch[2] ?? '').toLowerCase();
    const unit = unitRaw.startsWith('day') || unitRaw.startsWith('д') ? 'days'
      : unitRaw.startsWith('week') || unitRaw.startsWith('нед') || unitRaw.startsWith('тиж') || unitRaw.startsWith('sedmic') ? 'weeks'
        : unitRaw.startsWith('month') || unitRaw.startsWith('мес') || unitRaw.startsWith('міс') || unitRaw.startsWith('mjesec') ? 'months'
          : 'years';
    if (count > 0) {
      return {raw: durationMatch[0].trim(), normalized: `duration:${count}_${unit}`};
    }
  }

  const quarterMatch = cleaned.match(/\bq([1-4])(?:\s*[-/]\s*(\d{4}))?\b/i);
  if (quarterMatch) {
    const year = quarterMatch[2] ? `_${quarterMatch[2]}` : '';
    return {
      raw: quarterMatch[0].trim(),
      normalized: `quarter:q${quarterMatch[1]}${year}`
    };
  }

  for (const pattern of DATE_RANGE_PATTERNS) {
    const dateMatch = cleaned.match(pattern);
    if (dateMatch?.[0]) {
      return {
        raw: dateMatch[0].trim(),
        normalized: `date_range:${dateMatch[0].trim().toLowerCase()}`
      };
    }
  }

  const timelineSentence = firstSentenceByHints(cleaned, TIMELINE_HINTS);
  if (timelineSentence) {
    return {
      raw: timelineSentence,
      normalized: `free_text:${timelineSentence.slice(0, 120)}`
    };
  }

  if (includesAny(lower, TIMELINE_HINTS)) {
    return {
      raw: cleaned,
      normalized: `free_text:${cleaned.slice(0, 120)}`
    };
  }

  return null;
}

function formatBudgetHint(parsed: BudgetParse | null): string | null {
  if (!parsed) {
    return null;
  }
  return `raw: ${parsed.raw}; normalized: ${parsed.normalized}`;
}

function inferPrimaryGoal(message: string, hasScope: boolean): string | null {
  const cleaned = clean(message);
  if (!cleaned) {
    return null;
  }

  const sentence = splitSentences(cleaned)[0] ?? cleaned;
  if (!hasScope && sentence.length < 12) {
    return null;
  }

  return sentence.length > 200 ? `${sentence.slice(0, 200)}...` : sentence;
}

export function extractLeadSignals(params: {
  history: ChatMessage[];
  message: string;
}): LeadSignals {
  const userHistory = params.history
    .filter((m) => m.role === 'user')
    .map((m) => m.content)
    .join('\n');
  const currentMessage = params.message;
  const merged = userHistory ? `${userHistory}\n${currentMessage}` : currentMessage;
  const mergedLower = normalize(merged);

  const email = firstMatch(EMAIL_RE, currentMessage) ?? firstMatch(EMAIL_RE, userHistory);
  const phone = firstMatch(PHONE_RE, currentMessage) ?? firstMatch(PHONE_RE, userHistory);
  const telegramHandle = extractTelegramHandle(currentMessage) ?? extractTelegramHandle(userHistory);
  const name = extractNameByPatterns(currentMessage)
    ?? extractNameFromShortNameReply({message: currentMessage, history: params.history})
    ?? extractNameFromShortContactReply({message: currentMessage, history: params.history})
    ?? extractNameByPatterns(userHistory);

  const currentBudget = parseBudgetHint(currentMessage);
  const historyBudget = parseBudgetHint(userHistory);
  const budget = currentBudget ?? historyBudget;

  const currentTimeline = parseTimelineHint(currentMessage);
  const historyTimeline = parseTimelineHint(userHistory);
  const timeline = currentTimeline ?? historyTimeline;

  const hasScope = SERVICE_MAP.some((entry) => includesAny(mergedLower, entry.hints));
  const hasBudget = Boolean(budget) || includesAny(mergedLower, BUDGET_HINTS);
  const hasTimeline = Boolean(timeline) || includesAny(mergedLower, TIMELINE_HINTS);

  const serviceType = detectServiceType(mergedLower);
  const referralSource = extractReferralSource({
    history: params.history,
    message: currentMessage
  });

  return {
    name,
    email,
    phone,
    telegramHandle,
    normalizedEmail: normalizeEmail(email),
    normalizedPhone: normalizePhone(phone),
    serviceType,
    primaryGoal: inferPrimaryGoal(currentMessage, hasScope),
    firstDeliverable: firstSentenceByHints(currentMessage, ['сделать', 'нужно', 'build', 'create', 'implement', 'сделать в первую очередь']) ?? inferPrimaryGoal(currentMessage, hasScope),
    timelineHint: timeline?.normalized ?? firstSentenceByHints(merged, TIMELINE_HINTS),
    timelineNormalized: timeline?.normalized ?? null,
    budgetHint: formatBudgetHint(budget) ?? firstSentenceByHints(merged, BUDGET_HINTS),
    budgetRaw: budget?.raw ?? null,
    budgetNormalized: budget?.normalized ?? null,
    referralSource,
    constraints: firstSentenceByHints(merged, CONSTRAINT_HINTS),
    serviceFamily: mapServiceTypeToFamily(serviceType),
    hasScope,
    hasBudget,
    hasTimeline,
    userMessageCount: params.history.filter((m) => m.role === 'user').length
  };
}

export function getIdentityRequestPrompt(locale: Locale): string {
  if (locale === 'ru') {
    return 'Чтобы не потерять контекст, напишите ваше имя и любой контакт: email, телефон или Telegram.';
  }
  if (locale === 'uk') {
    return "Щоб не втратити контекст, напишіть ваше ім'я та будь-який контакт: email, телефон або Telegram.";
  }
  if (locale === 'sr-ME') {
    return 'Da ne izgubimo kontekst, pošaljite ime i jedan kontakt: email, telefon ili Telegram.';
  }
  return 'To keep context, please share your name and one contact: email, phone, or Telegram.';
}

export function getNameOnlyPrompt(locale: Locale): string {
  if (locale === 'ru') {
    return 'Спасибо. Как к вам обращаться?';
  }
  if (locale === 'uk') {
    return "Дякую. Як до вас звертатися?";
  }
  if (locale === 'sr-ME') {
    return 'Hvala. Kako da vam se obraćam?';
  }
  return 'Thanks. What is your name?';
}

export function getContactOnlyPrompt(locale: Locale): string {
  if (locale === 'ru') {
    return 'Спасибо. Оставьте, пожалуйста, любой контакт для связи менеджера: email, телефон или Telegram.';
  }
  if (locale === 'uk') {
    return "Дякую. Залиште, будь ласка, будь-який контакт для зв'язку менеджера: email, телефон або Telegram.";
  }
  if (locale === 'sr-ME') {
    return 'Hvala. Ostavite jedan kontakt za menadžera: email, telefon ili Telegram.';
  }
  return 'Thanks. Please share one contact for a manager: email, phone, or Telegram.';
}

export function getReferralSourcePrompt(locale: Locale): string {
  if (locale === 'ru') {
    return 'Подскажите, пожалуйста, откуда вы узнали о нас?';
  }
  if (locale === 'uk') {
    return 'Підкажіть, будь ласка, звідки ви дізналися про нас?';
  }
  if (locale === 'sr-ME') {
    return 'Recite, molim vas, gdje ste čuli za nas?';
  }
  return 'Could you share where you heard about us?';
}

export function getQualificationPrompt(params: {
  locale: Locale;
  hasScope: boolean;
  hasBudget: boolean;
  hasTimeline: boolean;
}): string {
  const missing = {
    scope: !params.hasScope,
    budget: !params.hasBudget,
    timeline: !params.hasTimeline
  };

  if (params.locale === 'ru') {
    if (missing.scope) return 'Что нужно сделать в первую очередь, одной фразой?';
    if (missing.timeline) return 'Какие сроки запуска для вас критичны?';
    if (missing.budget) return 'Какой ориентир по бюджету комфортен?';
    return 'Хотите, я передам менеджеру готовый бриф и он свяжется с вами?';
  }

  if (params.locale === 'uk') {
    if (missing.scope) return 'Що потрібно зробити в першу чергу, однією фразою?';
    if (missing.timeline) return 'Які строки запуску для вас критичні?';
    if (missing.budget) return 'Який орієнтир бюджету комфортний?';
    return 'Передати менеджеру готовий бриф для наступного кроку?';
  }

  if (params.locale === 'sr-ME') {
    if (missing.scope) return 'Šta je prvi prioritet, u jednoj rečenici?';
    if (missing.timeline) return 'Koji rok je kritičan za lansiranje?';
    if (missing.budget) return 'Koji okvir budžeta je prihvatljiv?';
    return 'Da li da predam menadžeru kompletan brief za sledeći korak?';
  }

  if (missing.scope) return 'What is the first priority to build, in one sentence?';
  if (missing.timeline) return 'What timeline is critical for launch?';
  if (missing.budget) return 'What budget range is comfortable for you?';
  return 'Would you like me to hand this brief to a manager for next steps?';
}
