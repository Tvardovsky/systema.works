import {NextRequest, NextResponse} from 'next/server';
import {randomUUID} from 'crypto';
import {chatMessageSchema} from '@/lib/schemas';
import type {ChatMessage, ChatResponse} from '@/types/lead';
import {
  appendConversationMessage,
  appendLeadBriefRevision,
  captureIdentityClaims,
  createCommunication,
  getConversationById,
  getConversationMessages,
  getLeadBriefByConversation,
  isChannelEnabled,
  setConversationSafetyState,
  touchCustomerContacts,
  touchIdentityContacts,
  upsertConversationClientTelemetry,
  updateConversationMetadata,
  upsertLeadBrief
} from '@/lib/repositories/omnichannel';
import {enforceRateLimit, getClientIp, verifyTurnstile} from '@/lib/security';
import {generateLowCostContextReply} from '@/lib/ai';
import {handleInboundEvent} from '@/lib/orchestrator';
import {extractBriefSignals} from '@/lib/brief-extractor';
import {computeLeadBriefState} from '@/lib/lead-brief';
import {extractPathFromReferer, extractServerClientSignal} from '@/lib/client-telemetry';
import {
  buildSafetyLockUntil,
  evaluateSafetyInput,
  getSafetyGoodbyeMessage,
  getSafetyRetryAfterSeconds,
  getSafetyWarningMessage,
  isSafetyLockActive,
  readSafetyGuardState,
  type SafetyViolationKind
} from '@/lib/chat-safety';
import {
  CHAT_COOLDOWN_COOKIE_NAME,
  buildLockedLifecycle,
  buildLowCostLifecycle,
  getLockedMessage,
  getRetryAfterSeconds,
  isLifecycleLocked,
  mergeWebChatLifecycleMetadata,
  readWebChatLifecycle
} from '@/lib/web-chat-lifecycle';

type AiRuntimeDeferReason = 'quota' | 'rate_limit' | 'connection' | 'parse_error';

function getConfiguredDialogEngineVersion(): 'v1' | 'v2' | 'v3' {
  const mode = process.env.CHAT_DIALOG_MODE?.toLowerCase();
  if (mode === 'v2_deterministic') {
    return 'v2';
  }
  if (mode === 'v3_llm_first') {
    return 'v3';
  }
  return process.env.CHAT_ENGINE_VERSION?.toLowerCase() === 'v1' ? 'v1' : 'v3';
}

function cleanText(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function mergeAiRuntimeMetadata(
  metadata: Record<string, unknown> | null | undefined,
  aiRuntime: {llmReplyDeferred: boolean; deferReason: AiRuntimeDeferReason | null}
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? {...metadata} : {};
  return {
    ...base,
    aiRuntime
  };
}

function preferRichText(existing?: string | null, candidate?: string | null, minCandidateLength = 16): string | null {
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
  if (incoming.length < minCandidateLength && current.length >= minCandidateLength) {
    return current;
  }
  return incoming.length >= current.length ? incoming : current;
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

function buildSafetyResponsePayload(params: {
  answer: string;
  conversation: NonNullable<Awaited<ReturnType<typeof getConversationById>>>;
  reason: SafetyViolationKind;
  chatLocked: boolean;
  chatMode: 'normal' | 'safety_locked';
  cooldownUntil?: string;
  retryAfterSeconds?: number;
  remainingLowCostMessages?: number;
  sessionClosed?: boolean;
  conversationStage?: ChatResponse['conversationStage'];
  missingFields?: string[];
  handoffReady?: boolean;
  dialogMode?: ChatResponse['dialogMode'];
}) {
  return {
    sessionId: params.conversation.id,
    answer: params.answer,
    topic: 'allowed' as const,
    leadIntentScore: Number(params.conversation.lead_intent_score ?? 80),
    nextQuestion: '',
    requiresLeadCapture: false,
    conversationStage: params.conversationStage ?? ('handoff_ready' as const),
    missingFields: params.missingFields ?? [],
    handoffReady: params.handoffReady ?? true,
    identityState: String(params.conversation.identity_state ?? 'unverified'),
    memoryAccess: String(params.conversation.memory_access ?? 'session_only'),
    memoryLoaded: false,
    dialogMode: params.dialogMode ?? ('context_continuation' as const),
    chatLocked: params.chatLocked,
    chatMode: params.chatMode,
    cooldownUntil: params.cooldownUntil ?? undefined,
    retryAfterSeconds: params.retryAfterSeconds ?? undefined,
    remainingLowCostMessages: params.remainingLowCostMessages ?? undefined,
    safetyReason: params.reason,
    sessionClosed: params.sessionClosed ?? false
  };
}

function sanitizeSafetyCapturedSignals(
  reason: SafetyViolationKind,
  fields: Awaited<ReturnType<typeof extractBriefSignals>>['fields']
) {
  return {
    ...fields,
    fullName: reason === 'invalid_name' ? null : fields.fullName,
    email: reason === 'invalid_email' ? null : fields.email,
    phone: reason === 'invalid_phone' ? null : fields.phone
  };
}

async function persistSafetyWarningContext(params: {
  conversation: NonNullable<Awaited<ReturnType<typeof getConversationById>>>;
  locale: 'en' | 'sr-ME' | 'ru' | 'uk';
  message: string;
  reason: SafetyViolationKind;
}) {
  const [historyRows, existingBrief] = await Promise.all([
    getConversationMessages(params.conversation.id, 30),
    getLeadBriefByConversation(params.conversation.id)
  ]);
  const history = historyRows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({role: row.role as 'user' | 'assistant', content: row.content}));

  const extraction = await extractBriefSignals({
    locale: params.locale,
    message: params.message,
    history,
    conversationId: params.conversation.id
  });
  const captured = sanitizeSafetyCapturedSignals(params.reason, extraction.fields);

  if (captured.fullName || captured.email || captured.phone || captured.telegramHandle) {
    const claimStatus = params.conversation.identity_state === 'verified' ? 'verified' : 'captured';
    try {
      await touchCustomerContacts({
        customerId: params.conversation.customer_id,
        fullName: captured.fullName ?? undefined,
        email: captured.email ?? undefined,
        phone: captured.phone ?? undefined,
        locale: params.locale
      });
      await touchIdentityContacts({
        customerId: params.conversation.customer_id,
        channel: 'web',
        channelUserId: params.conversation.channel_user_id ?? params.conversation.id,
        email: captured.email ?? undefined,
        phone: captured.phone ?? undefined,
        telegramHandle: captured.telegramHandle ?? undefined
      });
      await captureIdentityClaims({
        conversationId: params.conversation.id,
        customerId: params.conversation.customer_id,
        sourceChannel: 'web',
        email: captured.email ?? null,
        phone: captured.phone ?? null,
        telegramHandle: captured.telegramHandle ?? null,
        status: claimStatus
      });
    } catch {
      // Safety warning flow should not fail on enrichment writes.
    }
  }

  const mergedBrief = {
    fullName: existingBrief?.fullName ?? captured.fullName ?? null,
    email: existingBrief?.email ?? captured.email ?? null,
    phone: existingBrief?.phone ?? captured.phone ?? null,
    telegramHandle: existingBrief?.telegramHandle ?? captured.telegramHandle ?? null,
    serviceType: captured.serviceType ?? existingBrief?.serviceType ?? null,
    primaryGoal: preferRichText(existingBrief?.primaryGoal ?? null, captured.primaryGoal, 16),
    firstDeliverable: preferRichText(existingBrief?.firstDeliverable ?? null, captured.firstDeliverable, 14),
    timelineHint: captured.timelineHint ?? existingBrief?.timelineHint ?? null,
    budgetHint: captured.budgetHint ?? existingBrief?.budgetHint ?? null,
    referralSource: preferRichText(existingBrief?.referralSource ?? null, captured.referralSource, 6),
    constraints: preferRichText(existingBrief?.constraints ?? null, captured.constraints, 12),
    briefStructured: existingBrief?.briefStructured ?? null,
    briefStructuredVersion: existingBrief?.briefStructuredVersion ?? 'v1'
  };
  const computed = computeLeadBriefState(mergedBrief, {highIntent: false});

  const updatedBrief = await upsertLeadBrief({
    conversationId: params.conversation.id,
    customerId: params.conversation.customer_id,
    sourceChannel: 'web',
    updatedBy: 'ai',
    status: computed.status,
    missingFields: computed.missingFields,
    completenessScore: computed.completenessScore,
    patch: {
      fullName: mergedBrief.fullName,
      email: mergedBrief.email,
      phone: mergedBrief.phone,
      telegramHandle: mergedBrief.telegramHandle,
      serviceType: mergedBrief.serviceType,
      primaryGoal: mergedBrief.primaryGoal,
      firstDeliverable: mergedBrief.firstDeliverable,
      timelineHint: mergedBrief.timelineHint,
      budgetHint: mergedBrief.budgetHint,
      referralSource: mergedBrief.referralSource,
      constraints: mergedBrief.constraints,
      briefStructured: mergedBrief.briefStructured,
      briefStructuredVersion: mergedBrief.briefStructuredVersion
    }
  });

  if (existingBrief) {
    const fieldsToCheck: Array<keyof typeof updatedBrief> = [
      'status',
      'fullName',
      'email',
      'phone',
      'telegramHandle',
      'serviceType',
      'primaryGoal',
      'firstDeliverable',
      'timelineHint',
      'budgetHint',
      'referralSource',
      'constraints',
      'briefStructured',
      'briefStructuredVersion',
      'completenessScore',
      'missingFields'
    ];
    const changed = fieldsToCheck.some((field) => JSON.stringify(existingBrief[field]) !== JSON.stringify(updatedBrief[field]));
    if (changed) {
      await appendLeadBriefRevision({
        leadBriefId: updatedBrief.id,
        changedByType: 'ai',
        beforeState: {brief: existingBrief},
        afterState: {brief: updatedBrief},
        note: 'Safety warning: context merged from same turn'
      });
    }
  } else {
    await appendLeadBriefRevision({
      leadBriefId: updatedBrief.id,
      changedByType: 'ai',
      beforeState: {},
      afterState: {brief: updatedBrief},
      note: 'Safety warning: initial brief capture from same turn'
    });
  }

  return {
    computed,
    llmExtractionBypassed: extraction.deterministicFallback
  };
}

export async function buildLowCostAssistantAnswer(params: {
  locale: 'en' | 'sr-ME' | 'ru' | 'uk';
  message: string;
  history: ChatMessage[];
  remainingLowCostMessages: number;
  chatLocked: boolean;
  retryAfterSeconds: number;
  conversationId: string;
}) {
  const lowCostReply = await generateLowCostContextReply({
    locale: params.locale,
    message: params.message,
    history: params.history,
    remainingMessages: Math.max(0, params.remainingLowCostMessages),
    conversationId: params.conversationId
  });

  const answer = params.chatLocked
    ? `${lowCostReply.answer} ${getLockedMessage(params.locale, params.retryAfterSeconds)}`
    : lowCostReply.answer;

  return {
    answer: answer.trim(),
    llmBypassed: !lowCostReply.usedLlm,
    fallbackModelUsed: lowCostReply.fallbackModelUsed,
    gracefulFailUsed: lowCostReply.gracefulFailUsed,
    rephraseUsed: lowCostReply.rephraseUsed,
    templateBlockTriggered: lowCostReply.templateBlockTriggered,
    repetitionScore: lowCostReply.repetitionScore,
    llmReplyDeferred: lowCostReply.llmReplyDeferred,
    deferReason: lowCostReply.deferReason
  };
}

async function handleLowCostWebMessage(params: {
  conversation: NonNullable<Awaited<ReturnType<typeof getConversationById>>>;
  message: string;
  locale: 'en' | 'sr-ME' | 'ru' | 'uk';
  lifecycle: ReturnType<typeof readWebChatLifecycle>;
}) {
  const userPlatformMessageId = randomUUID();
  await appendConversationMessage({
    conversationId: params.conversation.id,
    role: 'user',
    content: params.message,
    platformMessageId: userPlatformMessageId,
    metadata: {
      chatMode: 'handoff_low_cost',
      llmBypassed: true
    }
  });

  const [historyRows, existingBrief] = await Promise.all([
    getConversationMessages(params.conversation.id, 30),
    getLeadBriefByConversation(params.conversation.id)
  ]);
  const history = historyRows
    .filter((row) => row.role === 'user' || row.role === 'assistant')
    .map((row) => ({role: row.role as 'user' | 'assistant', content: row.content}));

  const briefExtraction = await extractBriefSignals({
    locale: params.locale,
    message: params.message,
    history,
    conversationId: params.conversation.id
  });
  const capturedSignals = briefExtraction.fields;
  const llmExtractionBypassed = briefExtraction.deterministicFallback;

  if (capturedSignals.fullName || capturedSignals.email || capturedSignals.phone || capturedSignals.telegramHandle) {
    const claimStatus = params.conversation.identity_state === 'verified' ? 'verified' : 'captured';
    try {
      await touchCustomerContacts({
        customerId: params.conversation.customer_id,
        fullName: capturedSignals.fullName ?? undefined,
        email: capturedSignals.email ?? undefined,
        phone: capturedSignals.phone ?? undefined,
        locale: params.locale
      });
      await touchIdentityContacts({
        customerId: params.conversation.customer_id,
        channel: 'web',
        channelUserId: params.conversation.channel_user_id ?? params.conversation.id,
        email: capturedSignals.email ?? undefined,
        phone: capturedSignals.phone ?? undefined,
        telegramHandle: capturedSignals.telegramHandle ?? undefined
      });
      await captureIdentityClaims({
        conversationId: params.conversation.id,
        customerId: params.conversation.customer_id,
        sourceChannel: 'web',
        email: capturedSignals.email ?? null,
        phone: capturedSignals.phone ?? null,
        telegramHandle: capturedSignals.telegramHandle ?? null,
        status: claimStatus
      });
    } catch {
      // Non-blocking enrichment in low-cost mode.
    }
  }

  const mergedBrief = {
    fullName: existingBrief?.fullName ?? capturedSignals.fullName ?? null,
    email: existingBrief?.email ?? capturedSignals.email ?? null,
    phone: existingBrief?.phone ?? capturedSignals.phone ?? null,
    telegramHandle: existingBrief?.telegramHandle ?? capturedSignals.telegramHandle ?? null,
    serviceType: capturedSignals.serviceType ?? existingBrief?.serviceType ?? null,
    primaryGoal: preferRichText(existingBrief?.primaryGoal ?? null, capturedSignals.primaryGoal, 16),
    firstDeliverable: preferRichText(existingBrief?.firstDeliverable ?? null, capturedSignals.firstDeliverable, 14),
    timelineHint: capturedSignals.timelineHint ?? existingBrief?.timelineHint ?? null,
    budgetHint: capturedSignals.budgetHint ?? existingBrief?.budgetHint ?? null,
    referralSource: preferRichText(existingBrief?.referralSource ?? null, capturedSignals.referralSource, 6),
    constraints: preferRichText(existingBrief?.constraints ?? null, capturedSignals.constraints, 12)
  };
  const briefComputed = computeLeadBriefState(mergedBrief, {highIntent: false});

  const updatedBrief = await upsertLeadBrief({
    conversationId: params.conversation.id,
    customerId: params.conversation.customer_id,
    sourceChannel: 'web',
    updatedBy: 'system',
    status: 'handoff',
    missingFields: briefComputed.missingFields,
    completenessScore: briefComputed.completenessScore,
    patch: mergedBrief
  });
  if (existingBrief) {
    const fieldsToCheck: Array<keyof typeof updatedBrief> = [
      'status',
      'fullName',
      'email',
      'phone',
      'telegramHandle',
      'serviceType',
      'primaryGoal',
      'firstDeliverable',
      'timelineHint',
      'budgetHint',
      'referralSource',
      'constraints',
      'completenessScore',
      'missingFields'
    ];
    const changed = fieldsToCheck.some((field) => JSON.stringify(existingBrief[field]) !== JSON.stringify(updatedBrief[field]));
    if (changed) {
      await appendLeadBriefRevision({
        leadBriefId: updatedBrief.id,
        changedByType: 'system',
        beforeState: {brief: existingBrief},
        afterState: {brief: updatedBrief},
        note: 'Low-cost clarification update'
      });
    }
  } else {
    await appendLeadBriefRevision({
      leadBriefId: updatedBrief.id,
      changedByType: 'system',
      beforeState: {},
      afterState: {brief: updatedBrief},
      note: 'Initial brief created in low-cost mode'
    });
  }

  let nextLifecycle = buildLowCostLifecycle(params.lifecycle);
  nextLifecycle.lowCostMessagesInWindow += 1;
  const reachedWindowLimit = nextLifecycle.lowCostMessagesInWindow >= nextLifecycle.windowLimit;

  let chatLocked = false;
  let chatMode: 'handoff_locked' | 'handoff_low_cost' = 'handoff_low_cost';
  let cooldownUntil: string | undefined;
  let retryAfterSeconds = 0;
  let remainingLowCostMessages = Math.max(0, nextLifecycle.windowLimit - nextLifecycle.lowCostMessagesInWindow);

  if (reachedWindowLimit) {
    nextLifecycle = buildLockedLifecycle(new Date(), nextLifecycle);
    chatLocked = true;
    chatMode = 'handoff_locked';
    cooldownUntil = nextLifecycle.cooldownUntil ?? undefined;
    retryAfterSeconds = getRetryAfterSeconds(nextLifecycle.cooldownUntil);
    remainingLowCostMessages = nextLifecycle.windowLimit;
  }

  const lowCostAssistant = await buildLowCostAssistantAnswer({
    locale: params.locale,
    message: params.message,
    history,
    remainingLowCostMessages: chatLocked ? 0 : remainingLowCostMessages,
    chatLocked,
    retryAfterSeconds,
    conversationId: params.conversation.id
  });
  const answer = lowCostAssistant.answer;

  await updateConversationMetadata({
    conversationId: params.conversation.id,
    metadata: mergeAiRuntimeMetadata(
      mergeWebChatLifecycleMetadata(
        (params.conversation.metadata ?? null) as Record<string, unknown> | null,
        nextLifecycle
      ),
      {
        llmReplyDeferred: lowCostAssistant.llmReplyDeferred,
        deferReason: lowCostAssistant.deferReason ?? null
      }
    )
  });

  await appendConversationMessage({
    conversationId: params.conversation.id,
    role: 'assistant',
    content: answer,
    metadata: {
      engineVersion: getConfiguredDialogEngineVersion(),
      dialogNextSlot: briefComputed.nextSlot ?? null,
      dialogMode: 'context_continuation',
      chatMode,
      llmBypassed: lowCostAssistant.llmBypassed,
      llmExtractionBypassed,
      fallbackModelUsed: lowCostAssistant.fallbackModelUsed,
      gracefulFailUsed: lowCostAssistant.gracefulFailUsed,
      rephraseUsed: lowCostAssistant.rephraseUsed,
      templateBlockTriggered: lowCostAssistant.templateBlockTriggered,
      repetitionScore: lowCostAssistant.repetitionScore,
      llmReplyDeferred: lowCostAssistant.llmReplyDeferred,
      deferReason: lowCostAssistant.deferReason ?? null,
      chatLocked,
      cooldownUntil: cooldownUntil ?? null,
      retryAfterSeconds: retryAfterSeconds || null
    }
  });

  await createCommunication({
    customerId: params.conversation.customer_id,
    conversationId: params.conversation.id,
    type: 'bot',
    visibility: 'client_visible',
    body: answer,
    payload: {
      channel: 'web',
      lowCostMode: true,
      llmBypassed: lowCostAssistant.llmBypassed,
      llmExtractionBypassed,
      fallbackModelUsed: lowCostAssistant.fallbackModelUsed,
      gracefulFailUsed: lowCostAssistant.gracefulFailUsed,
      rephraseUsed: lowCostAssistant.rephraseUsed,
      templateBlockTriggered: lowCostAssistant.templateBlockTriggered,
      repetitionScore: lowCostAssistant.repetitionScore,
      llmReplyDeferred: lowCostAssistant.llmReplyDeferred,
      deferReason: lowCostAssistant.deferReason ?? null,
      chatMode,
      chatLocked,
      cooldownUntil: cooldownUntil ?? null,
      retryAfterSeconds: retryAfterSeconds || null,
      remainingLowCostMessages
    }
  });

  return {
    sessionId: params.conversation.id,
    answer,
    topic: 'allowed' as const,
    leadIntentScore: Number(params.conversation.lead_intent_score ?? 80),
    nextQuestion: '',
    requiresLeadCapture: false,
    conversationStage: 'handoff_ready' as const,
    missingFields: briefComputed.missingFields,
    handoffReady: true,
    identityState: params.conversation.identity_state ?? 'unverified',
    memoryAccess: params.conversation.memory_access ?? 'session_only',
    memoryLoaded: false,
    dialogMode: 'context_continuation' as const,
    chatLocked,
    chatMode,
    cooldownUntil,
    retryAfterSeconds: retryAfterSeconds || undefined,
    remainingLowCostMessages,
    llmExtractionBypassed,
    llmBypassed: lowCostAssistant.llmBypassed,
    fallbackModelUsed: lowCostAssistant.fallbackModelUsed,
    gracefulFailUsed: lowCostAssistant.gracefulFailUsed,
    rephraseUsed: lowCostAssistant.rephraseUsed,
    templateBlockTriggered: lowCostAssistant.templateBlockTriggered,
    repetitionScore: lowCostAssistant.repetitionScore,
    llmReplyDeferred: lowCostAssistant.llmReplyDeferred,
    deferReason: lowCostAssistant.deferReason ?? null
  };
}

export async function POST(request: NextRequest) {
  const payload = chatMessageSchema.safeParse(await request.json());
  if (!payload.success) {
    return NextResponse.json({error: 'Invalid payload'}, {status: 400});
  }

  if (payload.data.honeypot) {
    return NextResponse.json({error: 'Blocked'}, {status: 400});
  }

  const resolvedConversation = await getConversationById(payload.data.sessionId);
  if (!resolvedConversation) {
    return NextResponse.json({error: 'Session not found'}, {status: 404});
  }
  let conversation = resolvedConversation;

  const webEnabled = await isChannelEnabled('web');
  if (!webEnabled) {
    return NextResponse.json({error: 'Web chat is disabled'}, {status: 503});
  }

  const ip = getClientIp(request);
  const rateKey = `chat:message:${ip}`;
  if (!enforceRateLimit(rateKey, 45, 60_000)) {
    return NextResponse.json({error: 'Too many requests'}, {status: 429});
  }

  const verifyEachMessage = process.env.TURNSTILE_VERIFY_EACH_MESSAGE === 'true';
  if (verifyEachMessage && payload.data.turnstileToken) {
    const human = await verifyTurnstile(payload.data.turnstileToken, ip);
    if (!human) {
      return NextResponse.json({error: 'Verification failed'}, {status: 403});
    }
  }

  if (conversation.channel === 'web') {
    const snapshot = extractServerClientSignal({
      request,
      ip,
      locale: payload.data.locale,
      pagePath: extractPathFromReferer(request.headers.get('referer'))
    });
    const nextTelemetry = await upsertConversationClientTelemetry({
      conversationId: conversation.id,
      snapshot,
      eventType: 'message'
    });
    conversation = {
      ...conversation,
      metadata: {
        ...((((conversation.metadata ?? null) as Record<string, unknown> | null) ?? {})),
        clientTelemetry: nextTelemetry
      }
    };
  }

  if (conversation.channel === 'web') {
    const safetyState = readSafetyGuardState((conversation.metadata ?? null) as Record<string, unknown> | null);
    if (isSafetyLockActive(safetyState.lockUntil)) {
      const retryAfterSeconds = getSafetyRetryAfterSeconds(safetyState.lockUntil);
      const reason = safetyState.lockReason ?? 'exploit';
      const answer = getSafetyGoodbyeMessage(payload.data.locale, retryAfterSeconds, reason);
      const response = NextResponse.json(buildSafetyResponsePayload({
        answer,
        conversation,
        reason,
        chatLocked: true,
        chatMode: 'safety_locked',
        cooldownUntil: safetyState.lockUntil ?? undefined,
        retryAfterSeconds,
        remainingLowCostMessages: 0,
        sessionClosed: true
      }));
      setCooldownCookie(response, safetyState.lockUntil ?? undefined);
      return response;
    }

    const safetyDecision = evaluateSafetyInput({
      message: payload.data.message,
      currentInvalidStrikes: safetyState.invalidStrikes
    });

    if (safetyDecision.action === 'warn' || safetyDecision.action === 'lock') {
      const userPlatformMessageId = randomUUID();
      await appendConversationMessage({
        conversationId: conversation.id,
        role: 'user',
        content: payload.data.message,
        platformMessageId: userPlatformMessageId,
        metadata: {
          safetyViolation: safetyDecision.reason,
          safetyAction: safetyDecision.action
        }
      });
    }

    if (safetyDecision.action === 'warn') {
      let mergedWarningContext: Awaited<ReturnType<typeof persistSafetyWarningContext>> | null = null;
      try {
        mergedWarningContext = await persistSafetyWarningContext({
          conversation,
          locale: payload.data.locale,
          message: payload.data.message,
          reason: safetyDecision.reason
        });
      } catch (error) {
        console.warn('[chat:safety] failed to persist warning context', {
          conversationId: conversation.id,
          reason: safetyDecision.reason,
          error: error instanceof Error ? error.message : String(error)
        });
      }
      const answer = getSafetyWarningMessage(payload.data.locale, safetyDecision.reason, safetyDecision.attemptsLeft);
      await appendConversationMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
        metadata: {
          engineVersion: getConfiguredDialogEngineVersion(),
          dialogMode: 'context_continuation',
          dialogNextSlot: mergedWarningContext?.computed.nextSlot ?? null,
          llmExtractionBypassed: mergedWarningContext?.llmExtractionBypassed ?? null,
          safetyViolation: safetyDecision.reason,
          safetyAction: 'warn',
          invalidStrikes: safetyDecision.invalidStrikes,
          attemptsLeft: safetyDecision.attemptsLeft
        }
      });
      await setConversationSafetyState({
        conversationId: conversation.id,
        invalidStrikes: safetyDecision.invalidStrikes,
        lastViolationKind: safetyDecision.reason
      });
      const response = NextResponse.json(buildSafetyResponsePayload({
        answer,
        conversation,
        reason: safetyDecision.reason,
        chatLocked: false,
        chatMode: 'normal',
        sessionClosed: false,
        conversationStage: mergedWarningContext?.computed.conversationStage,
        missingFields: mergedWarningContext?.computed.missingFields,
        handoffReady: mergedWarningContext?.computed.handoffReady,
        dialogMode: 'context_continuation'
      }));
      setCooldownCookie(response);
      return response;
    }

    if (safetyDecision.action === 'lock') {
      const lockUntil = buildSafetyLockUntil();
      const retryAfterSeconds = getSafetyRetryAfterSeconds(lockUntil);
      const reason = safetyDecision.reason;
      const answer = getSafetyGoodbyeMessage(payload.data.locale, retryAfterSeconds, reason);
      await appendConversationMessage({
        conversationId: conversation.id,
        role: 'assistant',
        content: answer,
        metadata: {
          safetyViolation: reason,
          safetyAction: 'lock',
          invalidStrikes: safetyDecision.invalidStrikes,
          attemptsLeft: safetyDecision.attemptsLeft,
          cooldownUntil: lockUntil
        }
      });
      await setConversationSafetyState({
        conversationId: conversation.id,
        invalidStrikes: safetyDecision.invalidStrikes,
        lastViolationKind: reason,
        lockUntil,
        lockReason: reason,
        closeConversation: true
      });
      const response = NextResponse.json(buildSafetyResponsePayload({
        answer,
        conversation,
        reason,
        chatLocked: true,
        chatMode: 'safety_locked',
        cooldownUntil: lockUntil,
        retryAfterSeconds,
        remainingLowCostMessages: 0,
        sessionClosed: true
      }));
      setCooldownCookie(response, lockUntil);
      return response;
    }
  }

  if (conversation.channel === 'web' && conversation.status === 'handoff') {
    let lifecycle = readWebChatLifecycle((conversation.metadata ?? null) as Record<string, unknown> | null);
    if (lifecycle.mode === 'normal') {
      lifecycle = buildLockedLifecycle(new Date(), lifecycle);
      await updateConversationMetadata({
        conversationId: conversation.id,
        metadata: mergeWebChatLifecycleMetadata((conversation.metadata ?? null) as Record<string, unknown> | null, lifecycle)
      });
    }

    if (lifecycle.mode === 'handoff_locked' && isLifecycleLocked(lifecycle)) {
      const retryAfterSeconds = getRetryAfterSeconds(lifecycle.cooldownUntil);
      const answer = getLockedMessage(payload.data.locale, retryAfterSeconds);
      const response = NextResponse.json({
        sessionId: conversation.id,
        answer,
        topic: 'allowed',
        leadIntentScore: Number(conversation.lead_intent_score ?? 80),
        nextQuestion: '',
        requiresLeadCapture: false,
        conversationStage: 'handoff_ready',
        missingFields: [],
        handoffReady: true,
        identityState: String(conversation.identity_state ?? 'unverified'),
        memoryAccess: String(conversation.memory_access ?? 'session_only'),
        memoryLoaded: false,
        dialogMode: 'context_continuation',
        chatLocked: true,
        chatMode: 'handoff_locked',
        cooldownUntil: lifecycle.cooldownUntil,
        retryAfterSeconds,
        remainingLowCostMessages: lifecycle.windowLimit
      });
      setCooldownCookie(response, lifecycle.cooldownUntil ?? undefined);
      return response;
    }

    const lowCostResult = await handleLowCostWebMessage({
      conversation,
      message: payload.data.message,
      locale: payload.data.locale,
      lifecycle
    });
    const response = NextResponse.json(lowCostResult);
    setCooldownCookie(response, lowCostResult.chatLocked ? lowCostResult.cooldownUntil : undefined);
    return response;
  }

  const result = await handleInboundEvent({
    channel: 'web',
    channelUserId: conversation.channel_user_id ?? conversation.id,
    platformMessageId: randomUUID(),
    locale: payload.data.locale,
    text: payload.data.message,
    metadata: {
      conversationId: conversation.id
    }
  });

  const response = NextResponse.json({
    sessionId: result.conversationId,
    history: Array.isArray(result.metadata?.history)
      ? result.metadata?.history
        .filter((item): item is {role: 'user' | 'assistant'; content: string} => (
          Boolean(item)
          && typeof item === 'object'
          && 'role' in item
          && 'content' in item
          && ((item as {role?: unknown}).role === 'user' || (item as {role?: unknown}).role === 'assistant')
          && typeof (item as {content?: unknown}).content === 'string'
        ))
        .map((item) => ({role: item.role, content: item.content}))
      : undefined,
    sessionMerged: Boolean(result.metadata?.sessionMerged),
    mergedFromConversationId: typeof result.metadata?.mergedFromConversationId === 'string'
      ? result.metadata?.mergedFromConversationId
      : undefined,
    answer: result.text,
    topic: String(result.metadata?.topic ?? 'allowed'),
    leadIntentScore: Number(result.metadata?.leadIntentScore ?? 0),
    nextQuestion: String(result.metadata?.nextQuestion ?? ''),
    requiresLeadCapture: Boolean(result.metadata?.requiresLeadCapture),
    conversationStage: String(result.metadata?.conversationStage ?? 'discovery'),
    missingFields: Array.isArray(result.metadata?.missingFields) ? result.metadata?.missingFields : [],
    handoffReady: Boolean(result.metadata?.handoffReady),
    identityState: String(result.metadata?.identityState ?? 'unverified'),
    memoryAccess: String(result.metadata?.memoryAccess ?? 'session_only'),
    memoryLoaded: Boolean(result.metadata?.memoryLoaded),
    verificationHint: result.metadata?.verificationHint ? String(result.metadata?.verificationHint) : undefined,
    dialogMode: result.metadata?.dialogMode ? String(result.metadata?.dialogMode) : undefined,
    chatLocked: Boolean(result.metadata?.chatLocked),
    chatMode: String(result.metadata?.chatMode ?? 'normal'),
    cooldownUntil: result.metadata?.cooldownUntil ? String(result.metadata?.cooldownUntil) : undefined,
    retryAfterSeconds: typeof result.metadata?.retryAfterSeconds === 'number' ? Number(result.metadata?.retryAfterSeconds) : undefined,
    remainingLowCostMessages: typeof result.metadata?.remainingLowCostMessages === 'number'
      ? Number(result.metadata?.remainingLowCostMessages)
      : undefined,
    fallbackModelUsed: typeof result.metadata?.fallbackModelUsed === 'boolean'
      ? Boolean(result.metadata?.fallbackModelUsed)
      : undefined,
    gracefulFailUsed: typeof result.metadata?.gracefulFailUsed === 'boolean'
      ? Boolean(result.metadata?.gracefulFailUsed)
      : undefined,
    rephraseUsed: typeof result.metadata?.rephraseUsed === 'boolean'
      ? Boolean(result.metadata?.rephraseUsed)
      : undefined,
    templateBlockTriggered: typeof result.metadata?.templateBlockTriggered === 'boolean'
      ? Boolean(result.metadata?.templateBlockTriggered)
      : undefined,
    repetitionScore: typeof result.metadata?.repetitionScore === 'number'
      ? Number(result.metadata?.repetitionScore)
      : undefined,
    topicGuard: typeof result.metadata?.topicGuard === 'string'
      ? String(result.metadata?.topicGuard)
      : undefined,
    llmReplyDeferred: typeof result.metadata?.llmReplyDeferred === 'boolean'
      ? Boolean(result.metadata?.llmReplyDeferred)
      : undefined,
    deferReason: typeof result.metadata?.deferReason === 'string'
      ? String(result.metadata?.deferReason)
      : undefined,
    llmCallsCount: typeof result.metadata?.llmCallsCount === 'number'
      ? Number(result.metadata?.llmCallsCount)
      : undefined,
    jsonRepairUsed: typeof result.metadata?.jsonRepairUsed === 'boolean'
      ? Boolean(result.metadata?.jsonRepairUsed)
      : undefined,
    sameModelFallbackSkipped: typeof result.metadata?.sameModelFallbackSkipped === 'boolean'
      ? Boolean(result.metadata?.sameModelFallbackSkipped)
      : undefined,
    parseFailReason: typeof result.metadata?.parseFailReason === 'string'
      ? String(result.metadata?.parseFailReason)
      : undefined,
    dialogTurnMode: typeof result.metadata?.dialogTurnMode === 'string'
      ? String(result.metadata?.dialogTurnMode)
      : undefined,
    questionsCount: typeof result.metadata?.questionsCount === 'number'
      ? Number(result.metadata?.questionsCount)
      : undefined,
    fallbackPath: typeof result.metadata?.fallbackPath === 'string'
      ? String(result.metadata?.fallbackPath)
      : undefined,
    validatorAdjusted: typeof result.metadata?.validatorAdjusted === 'boolean'
      ? Boolean(result.metadata?.validatorAdjusted)
      : undefined,
    extractLatencyMs: typeof result.metadata?.extractLatencyMs === 'number'
      ? Number(result.metadata?.extractLatencyMs)
      : undefined,
    replyLatencyMs: typeof result.metadata?.replyLatencyMs === 'number'
      ? Number(result.metadata?.replyLatencyMs)
      : undefined,
    turnLatencyMsTotal: typeof result.metadata?.turnLatencyMsTotal === 'number'
      ? Number(result.metadata?.turnLatencyMsTotal)
      : undefined
  });
  if (result.metadata?.chatLocked && result.metadata?.cooldownUntil) {
    setCooldownCookie(response, String(result.metadata.cooldownUntil));
  } else {
    setCooldownCookie(response);
  }
  return response;
}
