import type {Locale} from '@/types/lead';
import {formatRetryHhMmSs} from '@/lib/web-chat-lifecycle';

export type SafetyViolationKind = 'abuse' | 'exploit' | 'invalid_email' | 'invalid_phone' | 'invalid_name';
export type SafetyAction = 'allow' | 'warn' | 'lock';

export type SafetyGuardState = {
  invalidStrikes: number;
  lastViolationKind: SafetyViolationKind | null;
  lastViolationAt: string | null;
  lockUntil: string | null;
  lockReason: SafetyViolationKind | null;
};

export type SafetyDecision =
  | {action: 'allow'}
  | {
      action: 'warn' | 'lock';
      reason: SafetyViolationKind;
      invalidStrikes: number;
      attemptsLeft: number;
    };

const EMAIL_VALID_RE = /^[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}$/i;
const EMAIL_CANDIDATE_RE = /[^\s<>"']+@[^\s<>"']+/g;
const PHONE_CANDIDATE_RE = /(?:\+?\d[\d\s().-]{5,}\d)/g;

const PHONE_HINTS = [
  'phone', 'phone number', 'my number', 'number', 'call me', 'contact number',
  'телефон', 'номер', 'мой номер', 'контакт',
  'телефон', 'номер', 'мій номер', 'контакт',
  'telefon', 'broj', 'kontakt'
];

const NAME_HINT_PATTERNS: RegExp[] = [
  /(?:my name is|name is|i am|i'm)\s+(.+)/i,
  /(?:меня зовут|мо[её] имя)\s+(.+)/i,
  /(?:моє ім'я|мене звати)\s+(.+)/i,
  /(?:zovem se|moje ime je)\s+(.+)/i
];

const PLACEHOLDER_NAMES = new Set([
  'test', 'admin', 'unknown', 'none', 'null', 'user', 'username',
  'тест', 'админ', 'неизвестно', 'нет', 'пусто',
  'тест', 'адмін', 'невідомо', 'нема',
  'tester', 'korisnik'
]);

const ABUSE_PATTERNS: RegExp[] = [
  /\bidiot\b/i,
  /\bstupid\b/i,
  /\bmoron\b/i,
  /\bдур(а|ак|ило|ень)\b/i,
  /\bтуп(ой|ая|ица)\b/i,
  /\bдебил\b/i,
  /\bлох\b/i,
  /\bидот\b/i,
  /\bидиот\b/i,
  /\bбля(д|т|ть|ть)\b/i,
  /\bсука\b/i,
  /\bнах(уй|ер)\b/i,
  /\bпизд(а|ец|ец)\b/i
];

const EXPLOIT_PATTERNS: RegExp[] = [
  /ignore (all )?(previous|prior) instructions/i,
  /reveal (the )?(system|developer) prompt/i,
  /show (me )?(your )?(system|hidden) instructions/i,
  /jailbreak/i,
  /prompt injection/i,
  /developer mode/i,
  /\bDROP\s+TABLE\b/i,
  /<script[\s>]/i,
  /union\s+select/i,
  /information_schema/i
];

const DEFAULT_INVALID_THRESHOLD = 3;
const SAFETY_LOCK_HOURS = 1;

function includesAnyHint(textLower: string, hints: string[]): boolean {
  return hints.some((hint) => textLower.includes(hint));
}

function cleanToken(value: string): string {
  return value.trim().replace(/[.,!?;:]+$/g, '');
}

function extractNameCandidate(message: string): string | null {
  for (const pattern of NAME_HINT_PATTERNS) {
    const match = message.match(pattern);
    const candidate = cleanToken(match?.[1] ?? '');
    if (candidate) {
      return candidate;
    }
  }

  const hasContact = (message.match(EMAIL_CANDIDATE_RE) ?? []).length > 0 || (message.match(PHONE_CANDIDATE_RE) ?? []).length > 0;
  if (hasContact && message.includes(',')) {
    const firstPart = cleanToken(message.split(',', 1)[0] ?? '');
    if (firstPart) {
      return firstPart;
    }
  }

  return null;
}

function isValidName(name: string): boolean {
  const normalized = cleanToken(name).replace(/\s+/g, ' ');
  if (normalized.length < 2 || normalized.length > 40) {
    return false;
  }
  if (/\d/.test(normalized)) {
    return false;
  }
  if (/https?:\/\//i.test(normalized) || normalized.includes('@')) {
    return false;
  }
  const words = normalized.split(/\s+/);
  if (!words.every((word) => /^[A-Za-zА-Яа-яЁёІіЇїЄє][A-Za-zА-Яа-яЁёІіЇїЄє'-]*$/.test(word))) {
    return false;
  }
  return !PLACEHOLDER_NAMES.has(normalized.toLowerCase());
}

function isValidPhoneCandidate(candidate: string): boolean {
  const digits = candidate.replace(/[^\d]/g, '');
  return digits.length >= 8 && digits.length <= 15;
}

function hasInvalidEmail(message: string): boolean {
  const candidates = message.match(EMAIL_CANDIDATE_RE) ?? [];
  if (!candidates.length) {
    return false;
  }
  return !candidates.some((candidate) => EMAIL_VALID_RE.test(candidate));
}

function hasInvalidPhone(message: string): boolean {
  const lower = message.toLowerCase();
  const hasHint = includesAnyHint(lower, PHONE_HINTS);
  const candidates = message.match(PHONE_CANDIDATE_RE) ?? [];
  const validCandidate = candidates.some((candidate) => isValidPhoneCandidate(candidate));
  if (candidates.length > 0) {
    return !validCandidate;
  }

  if (!hasHint) {
    return false;
  }

  const digits = message.replace(/[^\d]/g, '');
  if (!digits) {
    return false;
  }
  return digits.length < 8 || digits.length > 15;
}

/**
 * Patterns that indicate user is asking about privacy/terms/help (NOT providing name).
 */
const PRIVACY_AND_HELP_PATTERNS: RegExp[] = [
  /\bprivacy\b/i,
  /\bpolicy\b/i,
  /\bterms\b/i,
  /\bcondition\b/i,
  /\bagreement\b/i,
  /\blegal\b/i,
  /\blicense\b/i,
  /\blicensing\b/i,
  /\bcookie\b/i,
  /\bgdpr\b/i,
  /\bdata protection\b/i,
  /\bpersonal data\b/i,
  /\bгде.*ссылк\b/i,
  /\bгде.*политик\b/i,
  /\bде.*посилан\b/i,
  /\bgdje.*link\b/i
];

function hasInvalidName(message: string): boolean {
  const lower = message.toLowerCase();
  
  // CRITICAL: Never trigger on privacy policy, terms, or help questions
  if (matchesAny(PRIVACY_AND_HELP_PATTERNS, message)) {
    return false;
  }
  
  const hasNameHint = lower.includes('name') || lower.includes('имя') || lower.includes('зовут') || lower.includes('zovem se');
  const candidate = extractNameCandidate(message);
  if (!candidate) {
    return false;
  }
  if (!hasNameHint && !message.includes(',')) {
    return false;
  }
  return !isValidName(candidate);
}

function matchesAny(patterns: RegExp[], text: string): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function toIsoOrNull(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function toViolationKind(value: unknown): SafetyViolationKind | null {
  if (value === 'abuse' || value === 'exploit' || value === 'invalid_email' || value === 'invalid_phone' || value === 'invalid_name') {
    return value;
  }
  return null;
}

export function readSafetyGuardState(metadata?: Record<string, unknown> | null): SafetyGuardState {
  const raw = (metadata?.safetyGuard ?? null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    return {
      invalidStrikes: 0,
      lastViolationKind: null,
      lastViolationAt: null,
      lockUntil: null,
      lockReason: null
    };
  }

  const invalidRaw = raw.invalidStrikes;
  const invalidStrikes = typeof invalidRaw === 'number' && Number.isFinite(invalidRaw)
    ? Math.max(0, Math.floor(invalidRaw))
    : 0;

  return {
    invalidStrikes,
    lastViolationKind: toViolationKind(raw.lastViolationKind),
    lastViolationAt: toIsoOrNull(raw.lastViolationAt),
    lockUntil: toIsoOrNull(raw.lockUntil),
    lockReason: toViolationKind(raw.lockReason)
  };
}

export function getSafetyRetryAfterSeconds(lockUntil: string | null | undefined, now = new Date()): number {
  if (!lockUntil) {
    return 0;
  }
  const untilMs = Date.parse(lockUntil);
  if (!Number.isFinite(untilMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((untilMs - now.getTime()) / 1000));
}

export function isSafetyLockActive(lockUntil: string | null | undefined, now = new Date()): boolean {
  return getSafetyRetryAfterSeconds(lockUntil, now) > 0;
}

export function buildSafetyLockUntil(now = new Date(), lockHours = SAFETY_LOCK_HOURS): string {
  return new Date(now.getTime() + lockHours * 60 * 60 * 1000).toISOString();
}

export function evaluateSafetyInput(params: {
  message: string;
  currentInvalidStrikes?: number;
  invalidThreshold?: number;
}): SafetyDecision {
  const message = params.message.trim();
  if (!message) {
    return {action: 'allow'};
  }

  if (matchesAny(ABUSE_PATTERNS, message)) {
    return {
      action: 'lock',
      reason: 'abuse',
      invalidStrikes: params.currentInvalidStrikes ?? 0,
      attemptsLeft: 0
    };
  }

  if (matchesAny(EXPLOIT_PATTERNS, message)) {
    return {
      action: 'lock',
      reason: 'exploit',
      invalidStrikes: params.currentInvalidStrikes ?? 0,
      attemptsLeft: 0
    };
  }

  const invalidKinds: SafetyViolationKind[] = [];
  if (hasInvalidEmail(message)) {
    invalidKinds.push('invalid_email');
  }
  if (hasInvalidPhone(message)) {
    invalidKinds.push('invalid_phone');
  }
  if (hasInvalidName(message)) {
    invalidKinds.push('invalid_name');
  }

  if (!invalidKinds.length) {
    return {action: 'allow'};
  }

  const threshold = Math.max(1, params.invalidThreshold ?? DEFAULT_INVALID_THRESHOLD);
  const nextStrikes = Math.max(0, params.currentInvalidStrikes ?? 0) + 1;
  const attemptsLeft = Math.max(0, threshold - nextStrikes);
  if (nextStrikes >= threshold) {
    return {
      action: 'lock',
      reason: invalidKinds[0],
      invalidStrikes: nextStrikes,
      attemptsLeft
    };
  }

  return {
    action: 'warn',
    reason: invalidKinds[0],
    invalidStrikes: nextStrikes,
    attemptsLeft
  };
}

export function getSafetyWarningMessage(locale: Locale, kind: SafetyViolationKind, attemptsLeft: number): string {
  const attempts = Math.max(0, attemptsLeft);
  if (locale === 'ru') {
    if (kind === 'invalid_email') {
      return `Похоже, email указан в неверном формате. Укажите, пожалуйста, в формате name@example.com. Осталось попыток до паузы 1 час: ${attempts}.`;
    }
    if (kind === 'invalid_phone') {
      return `Похоже, номер указан в неверном формате. Укажите, пожалуйста, в международном формате, например +38268123456. Осталось попыток до паузы 1 час: ${attempts}.`;
    }
    if (kind === 'invalid_name') {
      return `Похоже, имя заполнено неверно. Укажите реальное имя (2-40 символов, только буквы). Осталось попыток до паузы 1 час: ${attempts}.`;
    }
    return `Пожалуйста, продолжим в корректном и деловом формате. Осталось попыток до паузы 1 час: ${attempts}.`;
  }

  if (locale === 'uk') {
    if (kind === 'invalid_email') {
      return `Схоже, email заповнено у неправильному форматі. Вкажіть, будь ласка, у форматі name@example.com. Спроб до паузи 1 година: ${attempts}.`;
    }
    if (kind === 'invalid_phone') {
      return `Схоже, номер заповнено у неправильному форматі. Вкажіть, будь ласка, у міжнародному форматі, наприклад +38268123456. Спроб до паузи 1 година: ${attempts}.`;
    }
    if (kind === 'invalid_name') {
      return `Схоже, ім'я заповнено некоректно. Вкажіть реальне ім'я (2-40 символів, лише літери). Спроб до паузи 1 година: ${attempts}.`;
    }
    return `Будь ласка, продовжимо в коректному та діловому форматі. Спроб до паузи 1 година: ${attempts}.`;
  }

  if (locale === 'sr-ME') {
    if (kind === 'invalid_email') {
      return `Izgleda da je email u pogrešnom formatu. Unesite, molim, u formatu name@example.com. Preostalih pokušaja do pauze od 1 sata: ${attempts}.`;
    }
    if (kind === 'invalid_phone') {
      return `Izgleda da je broj telefona u pogrešnom formatu. Unesite međunarodni format, npr. +38268123456. Preostalih pokušaja do pauze od 1 sata: ${attempts}.`;
    }
    if (kind === 'invalid_name') {
      return `Izgleda da ime nije u ispravnom formatu. Unesite realno ime (2-40 karaktera, samo slova). Preostalih pokušaja do pauze od 1 sata: ${attempts}.`;
    }
    return `Molim da nastavimo u korektnom poslovnom tonu. Preostalih pokušaja do pauze od 1 sata: ${attempts}.`;
  }

  if (kind === 'invalid_email') {
    return `Your email looks invalid. Please use a valid format like name@example.com. Attempts left before a 1-hour pause: ${attempts}.`;
  }
  if (kind === 'invalid_phone') {
    return `Your phone number looks invalid. Please use an international format like +38268123456. Attempts left before a 1-hour pause: ${attempts}.`;
  }
  if (kind === 'invalid_name') {
    return `Your name looks invalid. Please enter a real name (2-40 characters, letters only). Attempts left before a 1-hour pause: ${attempts}.`;
  }
  return `Please continue in a respectful business format. Attempts left before a 1-hour pause: ${attempts}.`;
}

export function getSafetyGoodbyeMessage(
  locale: Locale,
  retryAfterSeconds: number,
  kind: SafetyViolationKind
): string {
  const countdown = formatRetryHhMmSs(retryAfterSeconds);
  if (locale === 'ru') {
    if (kind === 'abuse' || kind === 'exploit') {
      return `Спасибо за обращение. Этот чат временно закрыт на ${countdown} из-за нарушения правил общения. После паузы можно начать заново по задаче в рамках услуг.`;
    }
    return `Спасибо за обращение. Этот чат временно закрыт на ${countdown}, потому что контактные данные несколько раз были в неверном формате. После паузы можно начать заново.`;
  }
  if (locale === 'uk') {
    if (kind === 'abuse' || kind === 'exploit') {
      return `Дякуємо за звернення. Цей чат тимчасово закрито на ${countdown} через порушення правил спілкування. Після паузи можна почати знову в межах послуг.`;
    }
    return `Дякуємо за звернення. Цей чат тимчасово закрито на ${countdown}, оскільки контактні дані кілька разів були у некоректному форматі. Після паузи можна почати знову.`;
  }
  if (locale === 'sr-ME') {
    if (kind === 'abuse' || kind === 'exploit') {
      return `Hvala na poruci. Ovaj chat je privremeno zatvoren na ${countdown} zbog kršenja pravila komunikacije. Nakon pauze možete ponovo pokrenuti razgovor u okviru usluga.`;
    }
    return `Hvala na poruci. Ovaj chat je privremeno zatvoren na ${countdown} jer su kontakt podaci više puta bili u neispravnom formatu. Nakon pauze možete pokušati ponovo.`;
  }
  if (kind === 'abuse' || kind === 'exploit') {
    return `Thanks for reaching out. This chat is temporarily closed for ${countdown} due to policy violations. You can start a new conversation after the pause.`;
  }
  return `Thanks for reaching out. This chat is temporarily closed for ${countdown} because contact details were repeatedly invalid. You can start a new conversation after the pause.`;
}
