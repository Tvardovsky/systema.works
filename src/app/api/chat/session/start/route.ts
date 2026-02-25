import {NextRequest, NextResponse} from 'next/server';
import {startSessionSchema} from '@/lib/schemas';
import {
  createWebSession,
  findRecentOpenWebConversationByIdentityCustomer,
  findOpenWebConversationByBrowserKey,
  getActiveWebSafetyLockByBrowserKey,
  getConversationById,
  getConversationMessages,
  isChannelEnabled,
  upsertConversationClientTelemetry
} from '@/lib/repositories/omnichannel';
import {enforceRateLimit, getClientIp, verifyTurnstile} from '@/lib/security';
import {getSafetyGoodbyeMessage} from '@/lib/chat-safety';
import {extractServerClientSignal} from '@/lib/client-telemetry';
import {
  CHAT_COOLDOWN_COOKIE_NAME,
  getLockedMessage,
  getRetryAfterSeconds,
  isLifecycleLocked,
  parseCooldownCookie,
  readWebChatLifecycle
} from '@/lib/web-chat-lifecycle';

const SESSION_COOKIE_NAME = 'systema_chat_session_id';
const VISITOR_COOKIE_NAME = 'systema_chat_visitor_id';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value?: string | null): value is string {
  if (!value) {
    return false;
  }
  return UUID_RE.test(value);
}

function setSessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set(SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30
  });
}

function setVisitorCookie(response: NextResponse, browserSessionKey: string) {
  response.cookies.set(VISITOR_COOKIE_NAME, browserSessionKey, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 180
  });
}

function setCooldownCookie(response: NextResponse, cooldownUntil?: string) {
  if (cooldownUntil) {
    response.cookies.set(CHAT_COOLDOWN_COOKIE_NAME, cooldownUntil, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      path: '/',
      maxAge: 60 * 60 * 4
    });
    return;
  }
  response.cookies.set(CHAT_COOLDOWN_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0
  });
}

function getAutoMergeWindowMinutes(): number {
  const raw = process.env.WEB_AUTO_MERGE_WINDOW_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : 60;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }
  return Math.max(1, Math.min(24 * 60, parsed));
}

export async function POST(request: NextRequest) {
  const payload = startSessionSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  if (payload.data.honeypot) {
    return NextResponse.json({error: 'Blocked'}, {status: 400});
  }

  const webEnabled = await isChannelEnabled('web');
  if (!webEnabled) {
    return NextResponse.json({error: 'Web chat is disabled'}, {status: 503});
  }

  const ip = getClientIp(request);
  const sessionSnapshot = extractServerClientSignal({
    request,
    ip,
    locale: payload.data.locale,
    pagePath: payload.data.pagePath,
    clientHints: payload.data.clientHints
  });
  const rateKey = `chat:start:${ip}`;
  if (!enforceRateLimit(rateKey, 15, 60_000)) {
    return NextResponse.json({error: 'Too many requests'}, {status: 429});
  }

  const explicitExistingSessionId = payload.data.existingSessionId;
  const cookieExistingSessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const cookieVisitorKey = request.cookies.get(VISITOR_COOKIE_NAME)?.value;
  const existingSessionId = explicitExistingSessionId || cookieExistingSessionId;
  const resolvedExistingSession = existingSessionId ? await getConversationById(existingSessionId) : null;
  const existingWebSession = resolvedExistingSession && resolvedExistingSession.channel === 'web' && resolvedExistingSession.status !== 'closed'
    ? resolvedExistingSession
    : null;
  const effectiveBrowserKey = payload.data.browserSessionKey
    ?? (isUuid(cookieVisitorKey) ? cookieVisitorKey : null)
    ?? (isUuid(existingWebSession?.channel_user_id) ? existingWebSession.channel_user_id : null);
  if (!effectiveBrowserKey) {
    return NextResponse.json({error: 'Missing browser session key'}, {status: 400});
  }
  const reusableByBrowserKey = await findOpenWebConversationByBrowserKey(effectiveBrowserKey);
  const activeSafetyLock = await getActiveWebSafetyLockByBrowserKey(effectiveBrowserKey);

  if (activeSafetyLock) {
    const response = NextResponse.json({
      allowed: false,
      reused: false,
      history: [],
      chatLocked: true,
      chatMode: 'safety_locked',
      cooldownUntil: activeSafetyLock.lockUntil,
      retryAfterSeconds: activeSafetyLock.retryAfterSeconds,
      remainingLowCostMessages: 0,
      message: getSafetyGoodbyeMessage(
        payload.data.locale,
        activeSafetyLock.retryAfterSeconds,
        activeSafetyLock.reason ?? 'exploit'
      ),
      safetyReason: activeSafetyLock.reason ?? undefined,
      sessionSource: 'browser_key'
    });
    setVisitorCookie(response, effectiveBrowserKey);
    setCooldownCookie(response, activeSafetyLock.lockUntil);
    return response;
  }

  const respondWithExistingConversation = async (
    sessionSource: 'existing_session' | 'browser_key' | 'created' | 'conflict_reused' | 'identity_customer',
    conversationId: string
  ) => {
    const existing = await getConversationById(conversationId);
    if (!existing || existing.channel !== 'web' || existing.status === 'closed') {
      return null;
    }

    if (sessionSource !== 'created') {
      await upsertConversationClientTelemetry({
        conversationId: existing.id,
        snapshot: sessionSnapshot,
        eventType: 'session_start'
      });
    }

    const historyRows = await getConversationMessages(existing.id, 50);
    const history = historyRows
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({role: item.role as 'user' | 'assistant', content: item.content}));
    const memoryLoaded = existing.identity_state === 'verified' && existing.memory_access === 'full_customer';
    const lifecycle = readWebChatLifecycle((existing.metadata ?? null) as Record<string, unknown> | null);
    const retryAfterSeconds = getRetryAfterSeconds(lifecycle.cooldownUntil);
    const chatLocked = isLifecycleLocked(lifecycle);
    const chatMode = lifecycle.mode;
    const message = chatLocked ? getLockedMessage(payload.data.locale, retryAfterSeconds) : undefined;
    const browserSessionKey = isUuid(existing.channel_user_id) ? existing.channel_user_id : effectiveBrowserKey;

    const response = NextResponse.json({
      sessionId: existing.id,
      allowed: true,
      reused: sessionSource !== 'created',
      history,
      identityState: existing.identity_state ?? 'unverified',
      memoryAccess: existing.memory_access ?? 'session_only',
      memoryLoaded,
      chatLocked,
      chatMode,
      cooldownUntil: lifecycle.cooldownUntil,
      retryAfterSeconds: retryAfterSeconds || undefined,
      remainingLowCostMessages: lifecycle.windowLimit,
      message,
      sessionSource
    });
    setSessionCookie(response, existing.id);
    setVisitorCookie(response, browserSessionKey);
    setCooldownCookie(response, chatLocked ? (lifecycle.cooldownUntil ?? undefined) : undefined);
    return response;
  };

  let preferredExistingSession = existingWebSession;
  let preferredExistingSessionSource: 'existing_session' | 'browser_key' = 'existing_session';
  if (existingWebSession && reusableByBrowserKey && reusableByBrowserKey.id !== existingWebSession.id) {
    const [existingHistoryRows, browserHistoryRows] = await Promise.all([
      getConversationMessages(existingWebSession.id, 40),
      getConversationMessages(reusableByBrowserKey.id, 40)
    ]);
    const existingHasAssistant = existingHistoryRows.some((item) => item.role === 'assistant');
    const browserHasAssistant = browserHistoryRows.some((item) => item.role === 'assistant');
    if (!existingHasAssistant && browserHasAssistant) {
      preferredExistingSession = reusableByBrowserKey;
      preferredExistingSessionSource = 'browser_key';
    }
  }

  if (preferredExistingSession) {
    const existingResponse = await respondWithExistingConversation(preferredExistingSessionSource, preferredExistingSession.id);
    if (existingResponse) {
      return existingResponse;
    }
  }

  if (reusableByBrowserKey) {
    const browserKeyResponse = await respondWithExistingConversation('browser_key', reusableByBrowserKey.id);
    if (browserKeyResponse) {
      return browserKeyResponse;
    }
  }

  if (sessionSnapshot.ipHash) {
    const identityCustomerConversation = await findRecentOpenWebConversationByIdentityCustomer({
      browserSessionKey: effectiveBrowserKey,
      ipHash: sessionSnapshot.ipHash,
      windowMinutes: getAutoMergeWindowMinutes()
    });
    if (identityCustomerConversation) {
      const identityResponse = await respondWithExistingConversation('identity_customer', identityCustomerConversation.id);
      if (identityResponse) {
        return identityResponse;
      }
    }
  }

  const cooldownCookie = parseCooldownCookie(request.cookies.get(CHAT_COOLDOWN_COOKIE_NAME)?.value);
  if (cooldownCookie.locked) {
    const response = NextResponse.json({
      allowed: false,
      reused: false,
      history: [],
      chatLocked: true,
      chatMode: 'handoff_locked',
      cooldownUntil: cooldownCookie.cooldownUntil,
      retryAfterSeconds: cooldownCookie.retryAfterSeconds,
      remainingLowCostMessages: 0,
      message: getLockedMessage(payload.data.locale, cooldownCookie.retryAfterSeconds),
      sessionSource: 'browser_key'
    });
    setVisitorCookie(response, effectiveBrowserKey);
    setCooldownCookie(response, cooldownCookie.cooldownUntil ?? undefined);
    return response;
  }

  const human = await verifyTurnstile(payload.data.turnstileToken, ip);
  if (!human) {
    return NextResponse.json({error: 'Verification failed'}, {status: 403});
  }

  const session = await createWebSession({
    locale: payload.data.locale,
    pagePath: payload.data.pagePath,
    browserSessionKey: effectiveBrowserKey,
    initialTelemetrySnapshot: sessionSnapshot
  });
  const createdResponse = await respondWithExistingConversation(session.sessionSource, session.sessionId);
  if (createdResponse) {
    return createdResponse;
  }

  const fallbackResponse = NextResponse.json({error: 'Unable to initialize chat session'}, {status: 500});
  setVisitorCookie(fallbackResponse, effectiveBrowserKey);
  return fallbackResponse;
}
