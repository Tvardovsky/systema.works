import type {Locale} from '@/types/lead';

export const WEB_CHAT_COOLDOWN_HOURS = 3;
export const WEB_CHAT_WINDOW_LIMIT = 2;
export const CHAT_COOLDOWN_COOKIE_NAME = 'systema_chat_cooldown_until';

export type WebChatLifecycleMode = 'normal' | 'handoff_locked' | 'handoff_low_cost';

export type WebChatLifecycle = {
  mode: WebChatLifecycleMode;
  cooldownUntil: string | null;
  handoffAt: string | null;
  lowCostMessagesInWindow: number;
  windowLimit: number;
  cooldownHours: number;
};

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function toInt(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.round(value);
  }
  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.round(parsed);
    }
  }
  return fallback;
}

export function getDefaultWebChatLifecycle(): WebChatLifecycle {
  return {
    mode: 'normal',
    cooldownUntil: null,
    handoffAt: null,
    lowCostMessagesInWindow: 0,
    windowLimit: WEB_CHAT_WINDOW_LIMIT,
    cooldownHours: WEB_CHAT_COOLDOWN_HOURS
  };
}

export function readWebChatLifecycle(metadata?: Record<string, unknown> | null): WebChatLifecycle {
  const raw = (metadata?.webChatLifecycle ?? null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    return getDefaultWebChatLifecycle();
  }

  const modeRaw = cleanString(raw.mode);
  const mode: WebChatLifecycleMode =
    modeRaw === 'handoff_locked' || modeRaw === 'handoff_low_cost' || modeRaw === 'normal'
      ? modeRaw
      : 'normal';

  return {
    mode,
    cooldownUntil: cleanString(raw.cooldownUntil),
    handoffAt: cleanString(raw.handoffAt),
    lowCostMessagesInWindow: Math.max(0, toInt(raw.lowCostMessagesInWindow, 0)),
    windowLimit: Math.max(1, toInt(raw.windowLimit, WEB_CHAT_WINDOW_LIMIT)),
    cooldownHours: Math.max(1, toInt(raw.cooldownHours, WEB_CHAT_COOLDOWN_HOURS))
  };
}

export function mergeWebChatLifecycleMetadata(
  metadata: Record<string, unknown> | null | undefined,
  lifecycle: WebChatLifecycle
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? {...metadata} : {};
  return {
    ...base,
    webChatLifecycle: lifecycle
  };
}

export function buildLockedLifecycle(now = new Date(), previous?: WebChatLifecycle): WebChatLifecycle {
  const cooldownHours = previous?.cooldownHours ?? WEB_CHAT_COOLDOWN_HOURS;
  return {
    mode: 'handoff_locked',
    cooldownUntil: new Date(now.getTime() + cooldownHours * 60 * 60 * 1000).toISOString(),
    handoffAt: previous?.handoffAt ?? now.toISOString(),
    lowCostMessagesInWindow: 0,
    windowLimit: previous?.windowLimit ?? WEB_CHAT_WINDOW_LIMIT,
    cooldownHours
  };
}

export function buildLowCostLifecycle(previous?: WebChatLifecycle): WebChatLifecycle {
  return {
    mode: 'handoff_low_cost',
    cooldownUntil: null,
    handoffAt: previous?.handoffAt ?? new Date().toISOString(),
    lowCostMessagesInWindow: previous?.lowCostMessagesInWindow ?? 0,
    windowLimit: previous?.windowLimit ?? WEB_CHAT_WINDOW_LIMIT,
    cooldownHours: previous?.cooldownHours ?? WEB_CHAT_COOLDOWN_HOURS
  };
}

export function getRetryAfterSeconds(cooldownUntil: string | null | undefined, now = new Date()): number {
  const iso = cleanString(cooldownUntil);
  if (!iso) {
    return 0;
  }
  const untilMs = Date.parse(iso);
  if (!Number.isFinite(untilMs)) {
    return 0;
  }
  return Math.max(0, Math.ceil((untilMs - now.getTime()) / 1000));
}

export function isLifecycleLocked(lifecycle: WebChatLifecycle, now = new Date()): boolean {
  if (lifecycle.mode !== 'handoff_locked') {
    return false;
  }
  return getRetryAfterSeconds(lifecycle.cooldownUntil, now) > 0;
}

export function formatRetryHhMmSs(totalSeconds: number): string {
  const seconds = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  return [hours, minutes, sec].map((part) => String(part).padStart(2, '0')).join(':');
}

export function getLockedMessage(locale: Locale, retryAfterSeconds: number): string {
  const countdown = formatRetryHhMmSs(retryAfterSeconds);
  if (locale === 'ru') {
    return `Спасибо, заявка уже передана менеджеру и находится в работе. Следующее сообщение будет доступно через ${countdown}.`;
  }
  if (locale === 'uk') {
    return `Дякуємо, заявку вже передано менеджеру та взято в роботу. Наступне повідомлення буде доступне через ${countdown}.`;
  }
  if (locale === 'sr-ME') {
    return `Hvala, zahtjev je već predat menadžeru i u obradi je. Sledeća poruka biće dostupna za ${countdown}.`;
  }
  return `Thanks, your request has already been handed to a manager and is in progress. Your next message will be available in ${countdown}.`;
}

export function getHandoffTerminalMessage(locale: Locale): string {
  if (locale === 'ru') {
    return 'Спасибо, заявка передана менеджеру. Мы уже начали обработку. Следующее сообщение в этом чате будет доступно через 3 часа.';
  }
  if (locale === 'uk') {
    return 'Дякуємо, заявку передано менеджеру. Ми вже почали обробку. Наступне повідомлення в цьому чаті буде доступне через 3 години.';
  }
  if (locale === 'sr-ME') {
    return 'Hvala, zahtjev je predat menadžeru. Obrada je već počela. Sledeća poruka u ovom chatu biće dostupna za 3 sata.';
  }
  return 'Thank you, your request has been handed to a manager. Processing has already started. The next message in this chat will be available in 3 hours.';
}

export function getLowCostAckMessage(locale: Locale, remainingMessages: number): string {
  if (locale === 'ru') {
    return remainingMessages > 0
      ? `Спасибо за уточнение, я добавил это в заявку. Менеджер уже рассматривает запрос. Доступно ещё ${remainingMessages} уточнение до следующей паузы.`
      : 'Спасибо за уточнение, я добавил это в заявку. Менеджер уже рассматривает запрос.';
  }
  if (locale === 'uk') {
    return remainingMessages > 0
      ? `Дякую за уточнення, я додав це до заявки. Менеджер вже розглядає запит. Доступно ще ${remainingMessages} уточнення до наступної паузи.`
      : 'Дякую за уточнення, я додав це до заявки. Менеджер вже розглядає запит.';
  }
  if (locale === 'sr-ME') {
    return remainingMessages > 0
      ? `Hvala na pojašnjenju, dodao sam to u zahtjev. Menadžer već razmatra upit. Dostupno je još ${remainingMessages} pojašnjenje do sledeće pauze.`
      : 'Hvala na pojašnjenju, dodao sam to u zahtjev. Menadžer već razmatra upit.';
  }
  return remainingMessages > 0
    ? `Thanks for the clarification, I added it to your request. A manager is already reviewing it. You can send ${remainingMessages} more clarification before the next pause.`
    : 'Thanks for the clarification, I added it to your request. A manager is already reviewing it.';
}

export function parseCooldownCookie(rawValue: string | undefined, now = new Date()): {
  cooldownUntil: string | null;
  retryAfterSeconds: number;
  locked: boolean;
} {
  const cooldownUntil = cleanString(rawValue);
  const retryAfterSeconds = getRetryAfterSeconds(cooldownUntil, now);
  return {
    cooldownUntil,
    retryAfterSeconds,
    locked: retryAfterSeconds > 0
  };
}
