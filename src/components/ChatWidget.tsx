'use client';

import {FormEvent, useCallback, useEffect, useMemo, useRef, useState} from 'react';
import {Turnstile} from '@marsidev/react-turnstile';
import {useLocale, useTranslations} from 'next-intl';
import type {Locale} from '@/types/lead';

type ChatMode = 'normal' | 'handoff_locked' | 'handoff_low_cost' | 'safety_locked';
type SafetyReason = 'abuse' | 'exploit' | 'invalid_email' | 'invalid_phone' | 'invalid_name';

type ChatResult = {
  sessionId?: string;
  history?: ChatHistoryItem[];
  sessionMerged?: boolean;
  mergedFromConversationId?: string;
  answer: string;
  topic: 'allowed' | 'disallowed' | 'unclear';
  leadIntentScore: number;
  nextQuestion: string;
  identityState?: 'unverified' | 'pending_match' | 'verified';
  memoryAccess?: 'none' | 'session_only' | 'full_customer';
  memoryLoaded?: boolean;
  verificationHint?: string;
  chatLocked?: boolean;
  chatMode?: ChatMode;
  cooldownUntil?: string;
  retryAfterSeconds?: number;
  remainingLowCostMessages?: number;
  message?: string;
  sessionClosed?: boolean;
  safetyReason?: SafetyReason;
};

type ChatHistoryItem = {
  role: 'user' | 'assistant';
  content: string;
};

type ChatMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
};

type StartSessionResult = {
  sessionId?: string;
  allowed: boolean;
  reused?: boolean;
  sessionSource?: 'existing_session' | 'browser_key' | 'created' | 'conflict_reused' | 'identity_customer';
  history?: ChatHistoryItem[];
  identityState?: 'unverified' | 'pending_match' | 'verified';
  memoryAccess?: 'none' | 'session_only' | 'full_customer';
  memoryLoaded?: boolean;
  chatLocked?: boolean;
  chatMode?: ChatMode;
  cooldownUntil?: string;
  retryAfterSeconds?: number;
  remainingLowCostMessages?: number;
  message?: string;
  safetyReason?: SafetyReason;
};

type StartSessionClientHints = {
  language?: string;
  timezone?: string;
  platform?: string;
  viewportWidth?: number;
  viewportHeight?: number;
  dpr?: number;
  touchPoints?: number;
};

type ScrollLockSnapshot = {
  scrollY: number;
  body: {
    position: string;
    top: string;
    left: string;
    right: string;
    width: string;
    overflow: string;
  };
  html: {
    overflow: string;
    overscrollBehavior: string;
  };
};

const SESSION_STORAGE_KEY = 'systema_chat_session_id_v1';
const BROWSER_SESSION_KEY = 'systema_chat_browser_key_v1';

function getOrCreateBrowserSessionKey(): string {
  if (typeof window === 'undefined') {
    return '';
  }
  const fromStorage = window.localStorage.getItem(BROWSER_SESSION_KEY);
  if (fromStorage) {
    return fromStorage;
  }
  const generated = window.crypto?.randomUUID?.();
  const randomHex = () => Math.floor(Math.random() * 16).toString(16);
  const fallbackUuid = `xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx`
    .replace(/x/g, randomHex)
    .replace(/y/g, () => ((Math.floor(Math.random() * 4) + 8).toString(16)));
  const browserSessionKey = generated ?? fallbackUuid;
  window.localStorage.setItem(BROWSER_SESSION_KEY, browserSessionKey);
  return browserSessionKey;
}

function collectClientHints(): StartSessionClientHints | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  const navigatorWithHints = navigator as Navigator & {userAgentData?: {platform?: string}};
  const hints: StartSessionClientHints = {};
  const language = cleanTextValue(navigator.language);
  const timezone = cleanTextValue(Intl.DateTimeFormat().resolvedOptions().timeZone);
  const platform = cleanTextValue(navigatorWithHints.userAgentData?.platform ?? navigator.platform);
  if (language) {
    hints.language = language;
  }
  if (timezone) {
    hints.timezone = timezone;
  }
  if (platform) {
    hints.platform = platform;
  }
  if (Number.isFinite(window.innerWidth) && window.innerWidth > 0) {
    hints.viewportWidth = Math.floor(window.innerWidth);
  }
  if (Number.isFinite(window.innerHeight) && window.innerHeight > 0) {
    hints.viewportHeight = Math.floor(window.innerHeight);
  }
  if (Number.isFinite(window.devicePixelRatio) && window.devicePixelRatio > 0) {
    hints.dpr = Number(window.devicePixelRatio.toFixed(2));
  }
  const touchPoints = (navigator.maxTouchPoints ?? 0);
  if (Number.isFinite(touchPoints) && touchPoints >= 0) {
    hints.touchPoints = Math.floor(touchPoints);
  }

  return Object.keys(hints).length ? hints : undefined;
}

function cleanTextValue(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim();
  return normalized || undefined;
}

export function ChatWidget() {
  const t = useTranslations('Chat');
  const locale = useLocale() as Locale;
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
  const turnstileEnabled = Boolean(siteKey) && (
    process.env.NODE_ENV === 'production' || process.env.NEXT_PUBLIC_TURNSTILE_ENFORCE_DEV === 'true'
  );
  const [open, setOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileVerified, setTurnstileVerified] = useState(() => !turnstileEnabled);
  const [chatLocked, setChatLocked] = useState(false);
  const [chatMode, setChatMode] = useState<ChatMode>('normal');
  const [retryAfterSeconds, setRetryAfterSeconds] = useState(0);
  const [remainingLowCostMessages, setRemainingLowCostMessages] = useState(0);
  const [startingSession, setStartingSession] = useState(false);
  const attemptedRestoreRef = useRef(false);
  const sessionStartInFlightRef = useRef(false);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const messageSequenceRef = useRef(0);
  const clientHintsRef = useRef<StartSessionClientHints | undefined>(undefined);
  const scrollLockSnapshotRef = useRef<ScrollLockSnapshot | null>(null);

  const createMessage = useCallback((role: ChatMessage['role'], content: string): ChatMessage => {
    messageSequenceRef.current += 1;
    return {
      id: `chat-message-${messageSequenceRef.current}`,
      role,
      content
    };
  }, []);

  const canStart = useMemo(() => Boolean(sessionId), [sessionId]);
  const canCompose = useMemo(() => canStart && turnstileVerified && !chatLocked, [canStart, turnstileVerified, chatLocked]);
  const countdownLabel = useMemo(() => {
    if (retryAfterSeconds <= 0) {
      return '';
    }
    const hours = Math.floor(retryAfterSeconds / 3600);
    const minutes = Math.floor((retryAfterSeconds % 3600) / 60);
    const seconds = retryAfterSeconds % 60;
    return [hours, minutes, seconds].map((part) => String(part).padStart(2, '0')).join(':');
  }, [retryAfterSeconds]);

  const scrollToLatestMessage = useCallback((behavior: ScrollBehavior = 'auto') => {
    chatEndRef.current?.scrollIntoView({block: 'end', behavior});
  }, []);

  const startSession = useCallback(async (options?: {existingSessionId?: string; silent?: boolean}) => {
    if (sessionStartInFlightRef.current) {
      return;
    }
    sessionStartInFlightRef.current = true;
    setStartingSession(true);

    try {
    const existingSessionFromStorage = !options?.existingSessionId && typeof window !== 'undefined'
      ? window.localStorage.getItem(SESSION_STORAGE_KEY) ?? undefined
      : undefined;
    const existingSessionId = options?.existingSessionId ?? existingSessionFromStorage;
    const silent = options?.silent ?? false;
    if (sessionId && !existingSessionId) {
      return;
    }

    const response = await fetch('/api/chat/session/start', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        locale,
        pagePath: window.location.pathname,
        turnstileToken,
        existingSessionId,
        browserSessionKey: getOrCreateBrowserSessionKey(),
        clientHints: clientHintsRef.current ?? (clientHintsRef.current = collectClientHints()),
        honeypot: ''
      })
    });

      if (!response.ok) {
        if (response.status === 404 && existingSessionId && typeof window !== 'undefined') {
          window.localStorage.removeItem(SESSION_STORAGE_KEY);
          setSessionId(null);
        }
        if (!silent) {
          setMessages([createMessage('assistant', t('startError'))]);
        }
        return;
      }

    const data = (await response.json()) as StartSessionResult;
    setChatLocked(Boolean(data.chatLocked));
    setChatMode(data.chatMode ?? 'normal');
    setRetryAfterSeconds(Number(data.retryAfterSeconds ?? 0));
    setRemainingLowCostMessages(Number(data.remainingLowCostMessages ?? 0));
    if (!data.allowed || !data.sessionId) {
      if (typeof window !== 'undefined') {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
      }
      setSessionId(null);
      if (data.message) {
        setMessages([createMessage('assistant', data.message)]);
      }
      return;
    }

    if (typeof window !== 'undefined') {
      window.localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
    }
    setSessionId(data.sessionId);

    const history = Array.isArray(data.history)
      ? data.history.filter((item) => item.role === 'user' || item.role === 'assistant')
      : [];
    if (history.length > 0) {
      setMessages(history.map((item) => createMessage(item.role, item.content)));
      return;
    }

    setMessages([createMessage('assistant', data.message ?? t('hello'))]);
    } finally {
      sessionStartInFlightRef.current = false;
      setStartingSession(false);
    }
  }, [createMessage, locale, sessionId, t, turnstileToken]);

  const restoreSessionIfExists = useCallback(() => {
    if (sessionId || attemptedRestoreRef.current || typeof window === 'undefined') {
      return;
    }

    const existingSessionId = window.localStorage.getItem(SESSION_STORAGE_KEY);
    attemptedRestoreRef.current = true;
    if (!existingSessionId) {
      return;
    }

    void startSession({existingSessionId, silent: true});
  }, [sessionId, startSession]);

  const unlockBackgroundScroll = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const snapshot = scrollLockSnapshotRef.current;
    if (!snapshot) {
      return;
    }
    const body = window.document.body;
    const html = window.document.documentElement;
    body.style.position = snapshot.body.position;
    body.style.top = snapshot.body.top;
    body.style.left = snapshot.body.left;
    body.style.right = snapshot.body.right;
    body.style.width = snapshot.body.width;
    body.style.overflow = snapshot.body.overflow;
    html.style.overflow = snapshot.html.overflow;
    html.style.overscrollBehavior = snapshot.html.overscrollBehavior;
    scrollLockSnapshotRef.current = null;
    window.scrollTo(0, snapshot.scrollY);
  }, []);

  useEffect(() => {
    const openFromEvent = () => {
      setOpen(true);
      restoreSessionIfExists();
    };

    const openFromClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const trigger = target.closest('[data-chat-open]');
      if (!trigger) {
        return;
      }

      event.preventDefault();
      setOpen(true);
      restoreSessionIfExists();
    };

    window.addEventListener('systema:open-chat', openFromEvent as EventListener);
    document.addEventListener('click', openFromClick);

    return () => {
      window.removeEventListener('systema:open-chat', openFromEvent as EventListener);
      document.removeEventListener('click', openFromClick);
    };
  }, [restoreSessionIfExists]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    const shouldLockBackgroundScroll = window.matchMedia('(max-width: 980px)').matches;
    if (!open) {
      unlockBackgroundScroll();
      return;
    }
    if (!shouldLockBackgroundScroll) {
      unlockBackgroundScroll();
      return;
    }
    if (!scrollLockSnapshotRef.current) {
      const body = window.document.body;
      const html = window.document.documentElement;
      scrollLockSnapshotRef.current = {
        scrollY: window.scrollY,
        body: {
          position: body.style.position,
          top: body.style.top,
          left: body.style.left,
          right: body.style.right,
          width: body.style.width,
          overflow: body.style.overflow
        },
        html: {
          overflow: html.style.overflow,
          overscrollBehavior: html.style.overscrollBehavior
        }
      };
      body.style.position = 'fixed';
      body.style.top = `-${window.scrollY}px`;
      body.style.left = '0';
      body.style.right = '0';
      body.style.width = '100%';
      body.style.overflow = 'hidden';
      html.style.overflow = 'hidden';
      html.style.overscrollBehavior = 'none';
    }
    return unlockBackgroundScroll;
  }, [open, unlockBackgroundScroll]);

  useEffect(() => {
    if (!open || (!messages.length && !loading)) {
      return;
    }

    const animationFrame = window.requestAnimationFrame(() => {
      scrollToLatestMessage(messages.length > 1 ? 'smooth' : 'auto');
    });

    return () => window.cancelAnimationFrame(animationFrame);
  }, [loading, messages, open, scrollToLatestMessage]);

  useEffect(() => {
    if (!chatLocked || retryAfterSeconds <= 0) {
      return;
    }
    const timer = window.setInterval(() => {
      setRetryAfterSeconds((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [chatLocked, retryAfterSeconds]);

  async function onSubmitMessage(event: FormEvent) {
    event.preventDefault();
    if (!sessionId || !input.trim() || loading) {
      return;
    }

    const userText = input.trim();
    setInput('');
    setLoading(true);
    setMessages((prev) => [...prev, createMessage('user', userText)]);

    const response = await fetch('/api/chat/message', {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        sessionId,
        locale,
        message: userText,
        turnstileToken,
        honeypot: ''
      })
    });

    if (!response.ok) {
      if (response.status === 404 && typeof window !== 'undefined') {
        window.localStorage.removeItem(SESSION_STORAGE_KEY);
        setSessionId(null);
      }
      setLoading(false);
      setMessages((prev) => [...prev, createMessage('assistant', t('replyError'))]);
      return;
    }

    const data = (await response.json()) as ChatResult;
    if (data.sessionId && data.sessionId !== sessionId) {
      setSessionId(data.sessionId);
      if (typeof window !== 'undefined') {
        window.localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
      }
    }
    if (data.sessionClosed && typeof window !== 'undefined') {
      window.localStorage.removeItem(SESSION_STORAGE_KEY);
      setSessionId(null);
    }
    setChatLocked(Boolean(data.chatLocked));
    setChatMode(data.chatMode ?? 'normal');
    setRetryAfterSeconds(Number(data.retryAfterSeconds ?? 0));
    setRemainingLowCostMessages(Number(data.remainingLowCostMessages ?? 0));
    const mergedHistory = Array.isArray(data.history)
      ? data.history.filter((item) => item.role === 'user' || item.role === 'assistant')
      : [];
    if (mergedHistory.length > 0) {
      const reconstructed = mergedHistory.map((item) => createMessage(item.role, item.content));
      const hasLatestAssistantAnswer = mergedHistory.some((item, index) => (
        index === mergedHistory.length - 1
        && item.role === 'assistant'
        && item.content === data.answer
      ));
      setMessages(hasLatestAssistantAnswer
        ? reconstructed
        : [...reconstructed, createMessage('assistant', data.answer)]);
    } else {
      setMessages((prev) => [...prev, createMessage('assistant', data.answer)]);
    }
    setLoading(false);
  }

  return (
    <>
      <button
        className="chat-launcher"
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          setOpen(true);
          restoreSessionIfExists();
        }}
      >
        {open ? t('close') : t('cta')}
      </button>

      {open ? (
        <aside className="chat-panel" aria-label={t('title')}>
          <header>
            <h3>{t('title')}</h3>
            <button
              className="chat-close-button"
              type="button"
              onClick={() => setOpen(false)}
            >
              {t('close')}
            </button>
          </header>

          {turnstileEnabled && siteKey && !turnstileVerified ? (
            <div className="chat-turnstile-wrap">
              <Turnstile
                siteKey={siteKey}
                onSuccess={(token) => {
                  setTurnstileToken(token);
                  setTurnstileVerified(true);
                }}
                onExpire={() => {
                  if (!canStart) {
                    setTurnstileToken('');
                    setTurnstileVerified(false);
                  }
                }}
                onError={() => {
                  if (!canStart) {
                    setTurnstileToken('');
                    setTurnstileVerified(false);
                  }
                }}
                options={{theme: 'light'}}
              />
            </div>
          ) : null}

          {messages.length > 0 || loading ? (
            <div className="chat-log" role="log" aria-live="polite" aria-relevant="additions text">
              {messages.map((item) => (
                <div key={item.id} className={`chat-row chat-row-${item.role}`}>
                  <p className={`chat-message chat-message-enter ${item.role}`}>
                    {item.content}
                  </p>
                </div>
              ))}
              {loading ? (
                <div className="chat-row chat-row-assistant">
                  <p className="chat-message chat-message-enter chat-message-typing assistant" role="status">
                    <span className="chat-visually-hidden">{t('typing')}</span>
                    <span className="chat-typing-dots" aria-hidden="true">
                      <span />
                      <span />
                      <span />
                    </span>
                  </p>
                </div>
              ) : null}
              <div ref={chatEndRef} aria-hidden />
            </div>
          ) : null}

          {chatLocked && retryAfterSeconds > 0 ? (
            <p className="chat-system-note">
              {t('cooldownLabel', {time: countdownLabel})}
            </p>
          ) : null}
          {chatMode === 'handoff_low_cost' && !chatLocked ? (
            <p className="chat-system-note">
              {t('lowCostMode', {count: remainingLowCostMessages})}
            </p>
          ) : null}

          {!canStart && !chatLocked ? (
            <div className="chat-start-action">
              <button
                className="chat-start-button"
                type="button"
                onClick={() => void startSession()}
                disabled={!turnstileVerified || loading || startingSession}
              >
                {t('start')}
              </button>
            </div>
          ) : null}

          {canCompose ? (
            <form className="chat-composer" onSubmit={onSubmitMessage}>
              <input
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={t('placeholder')}
                disabled={loading}
              />
              <button type="submit" disabled={loading || !input.trim()}>{t('send')}</button>
            </form>
          ) : null}

        </aside>
      ) : null}
    </>
  );
}
