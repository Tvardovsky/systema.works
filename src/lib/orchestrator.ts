import {randomUUID} from 'crypto';
import {generateAgencyReply} from '@/lib/ai';
import {computeLeadBriefState, isHighIntentMessage} from '@/lib/lead-brief';
import {resolveLeadPriority} from '@/lib/lead';
import {extractLeadSignals, getQualificationPrompt} from '@/lib/lead-signals';
import {extractBriefSignals} from '@/lib/brief-extractor';
import {
  appendLeadBriefRevision,
  appendConversationMessage,
  appendDeadLetter,
  captureIdentityClaims,
  createCommunication,
  findCandidateCustomerByContact,
  findCustomerByAnyContact,
  findOpenWebMergeCandidates,
  getConversationById,
  getConversationMessages,
  getLeadBriefByConversation,
  getMemorySnapshot,
  isChannelEnabled,
  markWebhookProcessed,
  resolveInboundIdentity,
  saveLeadEvent,
  setConversationPendingMatch,
  touchIdentityContacts,
  touchCustomerContacts,
  updateConversationMetadata,
  mergeWebConversationsIntoTarget,
  rankMergeCandidatesByActivity,
  upsertLeadBrief,
  updateConversationStatus,
  upsertMemorySnapshot
} from '@/lib/repositories/omnichannel';
import {sendManagerAlert} from '@/lib/telegram';
import {readClientTelemetry} from '@/lib/client-telemetry';
import {
  buildLockedLifecycle,
  getHandoffTerminalMessage,
  getRetryAfterSeconds,
  mergeWebChatLifecycleMetadata,
  readWebChatLifecycle
} from '@/lib/web-chat-lifecycle';
import type {ConversationStatus, InboundEvent, LeadBriefField, OutboundAction} from '@/types/omnichannel';
import type {Locale} from '@/types/lead';

function pickLocale(input?: Locale): Locale {
  if (input === 'en' || input === 'sr-ME' || input === 'ru' || input === 'uk') {
    return input;
  }
  return 'en';
}

function summarizeMemory(history: Array<{role: 'user' | 'assistant' | 'manager' | 'system'; content: string}>): string {
  const userLines = history.filter((item) => item.role === 'user').map((item) => item.content.trim()).filter(Boolean);
  return userLines.slice(-4).join(' | ').slice(0, 1200);
}

function computeStatus(score: number): 'open' | 'qualified' | 'hot' {
  if (score >= 75) {
    return 'hot';
  }
  if (score >= 60) {
    return 'qualified';
  }
  return 'open';
}

function getVerificationHint(locale: Locale, channel: InboundEvent['channel'], pending: boolean): string | undefined {
  if (!pending) {
    return undefined;
  }
  if (locale === 'ru') {
    return channel === 'web'
      ? 'Чтобы связать историю между каналами, подтвердите профиль через Telegram/Meta.'
      : 'Подтвердите, что хотите связать этот чат с предыдущим профилем (YES/NO).';
  }
  if (locale === 'uk') {
    return channel === 'web'
      ? 'Щоб обʼєднати історію між каналами, підтвердьте профіль через Telegram/Meta.'
      : 'Підтвердьте, що хочете звʼязати цей чат із попереднім профілем (YES/NO).';
  }
  if (locale === 'sr-ME') {
    return channel === 'web'
      ? 'Da spojimo istoriju između kanala, potvrdite profil kroz Telegram/Meta.'
      : 'Potvrdite da želite povezati ovaj chat sa prethodnim profilom (YES/NO).';
  }
  return channel === 'web'
    ? 'To link history across channels, verify your profile via Telegram/Meta.'
    : 'Confirm you want to link this chat with an existing profile (YES/NO).';
}

function cleanText(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

export function hasBriefConversationContact(brief: {
  email?: string | null;
  phone?: string | null;
  telegramHandle?: string | null;
} | null | undefined): boolean {
  if (!brief) {
    return false;
  }
  return Boolean(cleanText(brief.email) || cleanText(brief.phone) || cleanText(brief.telegramHandle));
}

export function shouldDeferWebHandoffUntilBudget(params: {
  channel: InboundEvent['channel'];
  identityState: 'unverified' | 'pending_match' | 'verified';
  hasBudgetHint: boolean;
  highIntent: boolean;
}): boolean {
  if (params.channel !== 'web') {
    return false;
  }
  if (params.identityState === 'verified') {
    return false;
  }
  if (params.highIntent) {
    return false;
  }
  return !params.hasBudgetHint;
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

function hasVerificationIntent(text: string): boolean {
  const lower = text.toLowerCase();
  return [
    'telegram',
    'meta',
    'instagram',
    'facebook',
    'профил',
    'истори',
    'связат',
    'подтверд',
    'канал',
    'verify',
    'profile',
    'history',
    'link',
    'звʼяз',
    'підтверд',
    'istorij',
    'profil',
    'povez'
  ].some((hint) => lower.includes(hint));
}

function composeBudgetFollowUp(params: {
  currentAnswer: string;
  budgetQuestion: string;
}): string {
  const cleanedCurrent = params.currentAnswer.trim();
  const lower = cleanedCurrent.toLowerCase();
  const handoffMentions = [
    'передаю', 'менеджер', 'manager', 'handoff', 'predajem', 'prosleđujem', 'передаючи', 'передам'
  ];
  const budgetMentions = ['budget', 'бюдж', 'budž', 'budzet', 'кошторис', 'орієнтир'];

  const safeCurrent = handoffMentions.some((token) => lower.includes(token)) ? '' : cleanedCurrent;
  if (budgetMentions.some((token) => lower.includes(token)) && safeCurrent.endsWith('?')) {
    return safeCurrent;
  }
  if (!safeCurrent) {
    return params.budgetQuestion;
  }
  const withPunctuation = /[.?!]$/.test(safeCurrent) ? safeCurrent : `${safeCurrent}.`;
  return `${withPunctuation} ${params.budgetQuestion}`;
}

export function getAreaBudgetClarification(locale: Locale): string {
  if (locale === 'ru') {
    return 'Понял про площадь проекта.';
  }
  if (locale === 'uk') {
    return 'Зрозумів щодо площі проєкту.';
  }
  if (locale === 'sr-ME') {
    return 'Razumijem površinu projekta.';
  }
  return 'Understood regarding the project area.';
}

type WebAutoMergeResult = {
  conversationId: string;
  customerId: string;
  identityState: 'unverified' | 'pending_match' | 'verified';
  memoryAccess: 'none' | 'session_only' | 'full_customer';
  sessionMerged: boolean;
  mergedFromConversationId?: string;
  history?: Array<{role: 'user' | 'assistant'; content: string}>;
};

function isWebAutoMergeEnabled(): boolean {
  const raw = process.env.WEB_AUTO_MERGE_BY_IP_CONTACT;
  if (!raw) {
    return true;
  }
  return raw.toLowerCase() === 'true';
}

function getWebAutoMergeWindowMinutes(): number {
  const raw = process.env.WEB_AUTO_MERGE_WINDOW_MINUTES;
  const parsed = raw ? Number.parseInt(raw, 10) : 60;
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 60;
  }
  return Math.max(1, Math.min(24 * 60, parsed));
}

function normalizeTelegramHandle(input?: string | null): string | null {
  const cleaned = cleanText(input);
  if (!cleaned) {
    return null;
  }
  return cleaned.replace(/^@/, '').toLowerCase();
}

function mapDialogHistory(rows: Array<{role: 'user' | 'assistant' | 'manager' | 'system'; content: string}>) {
  return rows
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({role: item.role as 'user' | 'assistant', content: item.content}));
}

function logAutoMerge(event: string, payload: Record<string, unknown>) {
  console.info('[web_auto_merge]', JSON.stringify({event, ...payload}));
}

async function tryAutoMergeWebSessionByIpContact(params: {
  conversationId: string;
  customerId: string;
  message: string;
}): Promise<WebAutoMergeResult> {
  const baseResult: WebAutoMergeResult = {
    conversationId: params.conversationId,
    customerId: params.customerId,
    identityState: 'unverified',
    memoryAccess: 'session_only',
    sessionMerged: false
  };

  const currentConversation = await getConversationById(params.conversationId);
  if (!currentConversation || currentConversation.channel !== 'web' || currentConversation.status === 'closed') {
    return baseResult;
  }
  if (!isWebAutoMergeEnabled()) {
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const currentTelemetry = readClientTelemetry((currentConversation.metadata ?? null) as Record<string, unknown> | null);
  const currentIpHash = cleanText(currentTelemetry?.latest.ipHash ?? null);
  if (!currentIpHash) {
    logAutoMerge('auto_merge_skipped_reason', {
      reason: 'ip_mismatch',
      conversationId: params.conversationId
    });
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const existingBrief = await getLeadBriefByConversation(currentConversation.id);
  const capturedSignals = extractLeadSignals({
    history: [],
    message: params.message
  });

  const contact = {
    email: capturedSignals.normalizedEmail ?? cleanText(existingBrief?.email),
    phone: capturedSignals.normalizedPhone ?? cleanText(existingBrief?.phone),
    telegramHandle: normalizeTelegramHandle(capturedSignals.telegramHandle ?? existingBrief?.telegramHandle)
  };

  if (!contact.email && !contact.phone && !contact.telegramHandle) {
    logAutoMerge('auto_merge_skipped_reason', {
      reason: 'no_contact',
      conversationId: params.conversationId,
      ipHashPrefix: currentIpHash.slice(0, 8)
    });
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const candidateCustomerId = await findCustomerByAnyContact({
    email: contact.email,
    phone: contact.phone,
    telegramHandle: contact.telegramHandle
  });
  if (!candidateCustomerId) {
    logAutoMerge('auto_merge_skipped_reason', {
      reason: 'no_candidate',
      conversationId: params.conversationId,
      ipHashPrefix: currentIpHash.slice(0, 8)
    });
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const candidates = await findOpenWebMergeCandidates({
    customerId: candidateCustomerId,
    ipHash: currentIpHash,
    excludeConversationId: currentConversation.id,
    windowMinutes: getWebAutoMergeWindowMinutes()
  });

  if (!candidates.length) {
    logAutoMerge('auto_merge_skipped_reason', {
      reason: 'window_expired',
      conversationId: params.conversationId,
      ipHashPrefix: currentIpHash.slice(0, 8)
    });
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const ranked = await rankMergeCandidatesByActivity({
    conversations: [currentConversation, ...candidates],
    windowMessages: 30
  });
  if (ranked.length <= 1) {
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const canonical = ranked[0];
  if (!canonical) {
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const mergeSources = ranked
    .slice(1)
    .map((item) => item.id)
    .filter((conversationId) => conversationId !== canonical.id);

  if (!mergeSources.length) {
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const matchedContactType = contact.email ? 'email' : (contact.phone ? 'phone' : 'telegram');
  logAutoMerge('auto_merge_attempted', {
    fromConversationId: params.conversationId,
    toConversationId: canonical.id,
    ipHashPrefix: currentIpHash.slice(0, 8),
    matchedContactType,
    mergeSourcesCount: mergeSources.length
  });

  for (const sourceConversationId of mergeSources) {
    try {
      await mergeWebConversationsIntoTarget({
        fromConversationId: sourceConversationId,
        toConversationId: canonical.id,
        reason: 'auto_merge_ip_contact',
        performedBy: 'system'
      });
    } catch (error) {
      logAutoMerge('auto_merge_skipped_reason', {
        reason: 'merge_error',
        fromConversationId: sourceConversationId,
        toConversationId: canonical.id,
        error: error instanceof Error ? error.message : 'unknown merge error'
      });
      return {
        ...baseResult,
        identityState: currentConversation.identity_state ?? 'unverified',
        memoryAccess: currentConversation.memory_access ?? 'session_only'
      };
    }
  }

  const canonicalConversation = await getConversationById(canonical.id);
  if (!canonicalConversation) {
    return {
      ...baseResult,
      identityState: currentConversation.identity_state ?? 'unverified',
      memoryAccess: currentConversation.memory_access ?? 'session_only'
    };
  }

  const historyRows = await getConversationMessages(canonicalConversation.id, 60);
  const history = mapDialogHistory(historyRows);
  logAutoMerge('auto_merge_success', {
    fromConversationId: params.conversationId,
    toConversationId: canonicalConversation.id,
    ipHashPrefix: currentIpHash.slice(0, 8),
    matchedContactType
  });

  return {
    conversationId: canonicalConversation.id,
    customerId: canonicalConversation.customer_id,
    identityState: canonicalConversation.identity_state ?? 'unverified',
    memoryAccess: canonicalConversation.memory_access ?? 'session_only',
    sessionMerged: true,
    mergedFromConversationId: canonicalConversation.id === params.conversationId ? undefined : params.conversationId,
    history
  };
}

export async function handleInboundEvent(event: InboundEvent): Promise<OutboundAction> {
  const safeEvent = {
    ...event,
    platformMessageId: event.platformMessageId || randomUUID()
  };

  try {
    const enabled = await isChannelEnabled(safeEvent.channel);
    if (!enabled) {
      return {
        channel: safeEvent.channel,
        recipientId: safeEvent.channelUserId,
        text: '',
        conversationId: '',
        metadata: {disabled: true}
      };
    }

    if (safeEvent.channel !== 'web') {
      const fresh = await markWebhookProcessed({
        channel: safeEvent.channel,
        platformMessageId: safeEvent.platformMessageId
      });
      if (!fresh) {
        return {
          channel: safeEvent.channel,
          recipientId: safeEvent.channelUserId,
          text: '',
          conversationId: '',
          metadata: {duplicate: true}
        };
      }
    }

    let match = await resolveInboundIdentity(safeEvent);
    const locale = pickLocale(safeEvent.locale);
    let pendingCustomerId: string | null = match.pendingCustomerId ?? null;
    let effectiveIdentityState = match.identityState;
    let effectiveMemoryAccess = match.memoryAccess;
    let activeConversationId = match.conversationId;
    let activeCustomerId = match.customerId;
    let sessionMerged = false;
    let mergedSessionHistory: Array<{role: 'user' | 'assistant'; content: string}> | undefined;
    let mergedFromConversationId: string | undefined;
    if (match.requiresConfirmation) {
      await appendConversationMessage({
        conversationId: match.conversationId,
        role: 'system',
        content: `Pending identity confirmation for channel user ${safeEvent.channelUserId}.`,
        platformMessageId: safeEvent.platformMessageId,
        metadata: {confirmRequired: true, confidence: match.confidence}
      });

      const confirmationPrompt = getVerificationHint(locale, safeEvent.channel, true)
        ?? 'I found a possible existing profile. Reply YES to merge your previous context, or NO to keep this as a new thread.';
      await appendConversationMessage({
        conversationId: match.conversationId,
        role: 'assistant',
        content: confirmationPrompt
      });

      return {
        channel: safeEvent.channel,
        recipientId: safeEvent.channelUserId,
        text: confirmationPrompt,
        conversationId: match.conversationId,
        metadata: {
          confirmRequired: true,
          identityState: match.identityState,
          memoryAccess: match.memoryAccess,
          memoryLoaded: false,
          verificationHint: confirmationPrompt
        }
      };
    }

    if (safeEvent.channel === 'web') {
      const autoMerge = await tryAutoMergeWebSessionByIpContact({
        conversationId: activeConversationId,
        customerId: activeCustomerId,
        message: safeEvent.text
      });
      if (autoMerge.sessionMerged) {
        sessionMerged = true;
        activeConversationId = autoMerge.conversationId;
        activeCustomerId = autoMerge.customerId;
        effectiveIdentityState = autoMerge.identityState;
        effectiveMemoryAccess = autoMerge.memoryAccess;
        pendingCustomerId = null;
        mergedSessionHistory = autoMerge.history;
        mergedFromConversationId = autoMerge.mergedFromConversationId;
        match = {
          ...match,
          conversationId: autoMerge.conversationId,
          customerId: autoMerge.customerId,
          identityState: autoMerge.identityState,
          memoryAccess: autoMerge.memoryAccess,
          pendingCustomerId: null
        };
      }
    }

    await appendConversationMessage({
      conversationId: activeConversationId,
      role: 'user',
      content: safeEvent.text,
      platformMessageId: safeEvent.platformMessageId,
      metadata: safeEvent.metadata
    });

    let memoryAllowed = effectiveIdentityState === 'verified' && effectiveMemoryAccess === 'full_customer';
    const [history, memory, conversationRow, existingBrief] = await Promise.all([
      getConversationMessages(activeConversationId, 40),
      memoryAllowed ? getMemorySnapshot(activeCustomerId) : Promise.resolve(null),
      getConversationById(activeConversationId),
      getLeadBriefByConversation(activeConversationId)
    ]);

    const syntheticHistory = history
      .filter((item) => item.role === 'user' || item.role === 'assistant')
      .map((item) => ({role: item.role as 'user' | 'assistant', content: item.content}));

    const briefExtraction = await extractBriefSignals({
      locale,
      message: safeEvent.text,
      history: syntheticHistory,
      conversationId: activeConversationId
    });
    const extractedSignals = briefExtraction.fields;
    if (
      extractedSignals.fullName ||
      extractedSignals.email ||
      extractedSignals.phone ||
      extractedSignals.telegramHandle
    ) {
      const candidateByContact = await findCandidateCustomerByContact({
        email: extractedSignals.email ?? null,
        phone: extractedSignals.phone ?? null,
        excludeCustomerId: activeCustomerId
      });
      if (candidateByContact) {
        pendingCustomerId = candidateByContact;
        effectiveIdentityState = 'pending_match';
        effectiveMemoryAccess = 'session_only';
        memoryAllowed = false;
        await setConversationPendingMatch({
          conversationId: activeConversationId,
          pendingCustomerId: candidateByContact,
          channel: safeEvent.channel,
          channelUserId: safeEvent.channelUserId,
          customerId: activeCustomerId
        });
      }
      const claimStatus = effectiveIdentityState === 'verified'
        ? 'verified'
        : (pendingCustomerId ? 'candidate_match' : 'captured');
      try {
        await touchCustomerContacts({
          customerId: activeCustomerId,
          fullName: extractedSignals.fullName ?? undefined,
          email: extractedSignals.email ?? undefined,
          phone: extractedSignals.phone ?? undefined,
          locale
        });
        await touchIdentityContacts({
          customerId: activeCustomerId,
          channel: safeEvent.channel,
          channelUserId: safeEvent.channelUserId,
          username: safeEvent.username,
          email: extractedSignals.email ?? undefined,
          phone: extractedSignals.phone ?? undefined,
          telegramHandle: extractedSignals.telegramHandle ?? undefined
        });
        await captureIdentityClaims({
          conversationId: activeConversationId,
          customerId: activeCustomerId,
          sourceChannel: safeEvent.channel,
          email: extractedSignals.email ?? null,
          phone: extractedSignals.phone ?? null,
          telegramHandle: extractedSignals.telegramHandle ?? null,
          status: claimStatus,
          matchedCustomerId: pendingCustomerId
        });
      } catch {
        // Contact enrichment should not block assistant response.
      }
    }
    const verificationHint = effectiveIdentityState === 'pending_match' && hasVerificationIntent(safeEvent.text)
      ? getVerificationHint(locale, safeEvent.channel, true)
      : undefined;

    const mergedBrief = {
      fullName: extractedSignals.fullName ?? existingBrief?.fullName ?? null,
      email: extractedSignals.email ?? existingBrief?.email ?? null,
      phone: extractedSignals.phone ?? existingBrief?.phone ?? null,
      telegramHandle: extractedSignals.telegramHandle ?? existingBrief?.telegramHandle ?? null,
      serviceType: extractedSignals.serviceType ?? existingBrief?.serviceType ?? null,
      primaryGoal: preferRichText(existingBrief?.primaryGoal ?? null, extractedSignals.primaryGoal, 16),
      firstDeliverable: preferRichText(existingBrief?.firstDeliverable ?? null, extractedSignals.firstDeliverable, 14),
      timelineHint: extractedSignals.timelineHint ?? existingBrief?.timelineHint ?? null,
      budgetHint: extractedSignals.budgetHint ?? existingBrief?.budgetHint ?? null,
      referralSource: preferRichText(existingBrief?.referralSource ?? null, extractedSignals.referralSource, 6),
      constraints: preferRichText(existingBrief?.constraints ?? null, extractedSignals.constraints, 12)
    };
    const briefComputed = computeLeadBriefState(mergedBrief, {
      highIntent: isHighIntentMessage(safeEvent.text)
    });
    const hasConversationContactAfterMerge = hasBriefConversationContact(mergedBrief);
    const requiresFreshWebContact = safeEvent.channel === 'web' && effectiveIdentityState !== 'verified';
    const forcedMissingFields = requiresFreshWebContact && !hasConversationContactAfterMerge && !briefComputed.missingFields.includes('contact')
      ? (['contact', ...briefComputed.missingFields] as LeadBriefField[])
      : briefComputed.missingFields;
    const forcedHandoffReady = briefComputed.handoffReady && (!requiresFreshWebContact || hasConversationContactAfterMerge);
    const forcedCompletenessScore = Math.max(0, Math.min(100, Math.round(((5 - forcedMissingFields.length) / 5) * 100)));
    const forcedStatus = forcedHandoffReady ? briefComputed.status : 'collecting';

    const updatedBrief = await upsertLeadBrief({
      conversationId: activeConversationId,
      customerId: activeCustomerId,
      sourceChannel: safeEvent.channel,
      updatedBy: 'ai',
      status: forcedStatus,
      missingFields: forcedMissingFields,
      completenessScore: forcedCompletenessScore,
      patch: mergedBrief
    });
    const hasConversationContact = hasBriefConversationContact(updatedBrief);

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
          changedByType: 'ai',
          beforeState: {brief: existingBrief},
          afterState: {brief: updatedBrief},
          note: 'Auto update from conversation signals'
        });
      }
    } else {
      await appendLeadBriefRevision({
        leadBriefId: updatedBrief.id,
        changedByType: 'ai',
        beforeState: {},
        afterState: {brief: updatedBrief},
        note: 'Initial brief created by assistant'
      });
    }

    if (memoryAllowed && memory?.summary) {
      syntheticHistory.unshift({
        role: 'assistant',
        content: `Customer memory summary: ${String(memory.summary)}`
      });
    }

    let reply = await generateAgencyReply({
      locale,
      message: safeEvent.text,
      history: syntheticHistory.slice(-12),
      conversationId: activeConversationId,
      identityState: effectiveIdentityState,
      memoryLoaded: memoryAllowed && Boolean(memory?.summary),
      verificationHint,
      channel: safeEvent.channel,
      briefContext: {
        fullName: updatedBrief.fullName,
        email: updatedBrief.email,
        phone: updatedBrief.phone,
        telegramHandle: updatedBrief.telegramHandle,
        serviceType: updatedBrief.serviceType,
        primaryGoal: updatedBrief.primaryGoal,
        firstDeliverable: updatedBrief.firstDeliverable,
        timelineHint: updatedBrief.timelineHint,
        budgetHint: updatedBrief.budgetHint,
        referralSource: updatedBrief.referralSource,
        constraints: updatedBrief.constraints,
        missingFields: forcedMissingFields,
        completenessScore: forcedCompletenessScore,
        hasConversationContact
      }
    });

    if (requiresFreshWebContact && !hasConversationContact) {
      const dedupedMissing = reply.missingFields.includes('contact')
        ? reply.missingFields
        : (['contact', ...reply.missingFields] as string[]);
      reply = {
        ...reply,
        handoffReady: false,
        missingFields: dedupedMissing,
        conversationStage: 'contact_capture'
      };
    }

    const shouldClarifyAreaBudget = briefExtraction.shouldAskClarification
      && briefExtraction.clarificationType === 'budget'
      && !updatedBrief.budgetHint;
    if (shouldClarifyAreaBudget) {
      const dedupedMissing = reply.missingFields.includes('timeline_or_budget')
        ? reply.missingFields
        : (['timeline_or_budget', ...reply.missingFields] as string[]);
      const budgetQuestion = getQualificationPrompt({
        locale,
        hasScope: true,
        hasBudget: false,
        hasTimeline: Boolean(updatedBrief.timelineHint)
      });
      reply = {
        ...reply,
        answer: composeBudgetFollowUp({
          currentAnswer: getAreaBudgetClarification(locale),
          budgetQuestion
        }),
        nextQuestion: budgetQuestion,
        handoffReady: false,
        missingFields: dedupedMissing,
        conversationStage: 'briefing',
        leadIntentScore: Math.min(reply.leadIntentScore, 70)
      };
    }

    const shouldDeferHandoffForBudget = reply.handoffReady && shouldDeferWebHandoffUntilBudget({
      channel: safeEvent.channel,
      identityState: effectiveIdentityState,
      hasBudgetHint: Boolean(updatedBrief.budgetHint),
      highIntent: isHighIntentMessage(safeEvent.text)
    });
    if (shouldDeferHandoffForBudget) {
      const dedupedMissing = reply.missingFields.includes('timeline_or_budget')
        ? reply.missingFields
        : (['timeline_or_budget', ...reply.missingFields] as string[]);
      const budgetQuestion = getQualificationPrompt({
        locale,
        hasScope: true,
        hasBudget: false,
        hasTimeline: Boolean(updatedBrief.timelineHint)
      });
      reply = {
        ...reply,
        answer: composeBudgetFollowUp({
          currentAnswer: reply.answer,
          budgetQuestion
        }),
        nextQuestion: budgetQuestion,
        handoffReady: false,
        missingFields: dedupedMissing,
        conversationStage: 'briefing',
        leadIntentScore: Math.min(reply.leadIntentScore, 74)
      };
    }

    const previousStatus = conversationRow?.status ?? 'open';
    const preservedTerminal = previousStatus === 'handoff' || previousStatus === 'closed';
    let status: ConversationStatus = preservedTerminal ? previousStatus : computeStatus(reply.leadIntentScore);
    if (status === 'hot' && !reply.handoffReady && !isHighIntentMessage(safeEvent.text)) {
      status = 'qualified';
    }
    if (reply.handoffReady) {
      status = 'handoff';
    }
    const enteringHandoff = status === 'handoff' && previousStatus !== 'handoff';
    let chatLocked = false;
    let chatMode: 'normal' | 'handoff_locked' | 'handoff_low_cost' = 'normal';
    let cooldownUntil: string | undefined;
    let retryAfterSeconds: number | undefined;
    let remainingLowCostMessages: number | undefined;
    if (safeEvent.channel === 'web' && enteringHandoff && reply.handoffReady) {
      const existingLifecycle = readWebChatLifecycle((conversationRow?.metadata ?? null) as Record<string, unknown> | null);
      const lockedLifecycle = buildLockedLifecycle(new Date(), existingLifecycle);
      await updateConversationMetadata({
        conversationId: activeConversationId,
        metadata: mergeWebChatLifecycleMetadata((conversationRow?.metadata ?? null) as Record<string, unknown> | null, lockedLifecycle)
      });
      reply = {
        ...reply,
        answer: getHandoffTerminalMessage(locale)
      };
      chatLocked = true;
      chatMode = 'handoff_locked';
      cooldownUntil = lockedLifecycle.cooldownUntil ?? undefined;
      retryAfterSeconds = getRetryAfterSeconds(lockedLifecycle.cooldownUntil);
      remainingLowCostMessages = lockedLifecycle.windowLimit;
    }

    await appendConversationMessage({
      conversationId: activeConversationId,
      role: 'assistant',
      content: reply.answer
    });

    await updateConversationStatus({
      conversationId: activeConversationId,
      status,
      leadIntentScore: reply.leadIntentScore
    });

    if ((status === 'qualified' || status === 'hot') && previousStatus === 'open') {
      await saveLeadEvent({
        conversationId: activeConversationId,
        customerId: activeCustomerId,
        eventType: status,
        priority: resolveLeadPriority(reply.leadIntentScore),
        intentScore: reply.leadIntentScore,
        payload: {
          channel: safeEvent.channel,
          requiresLeadCapture: reply.requiresLeadCapture
        }
      });

      if (status === 'hot') {
        await saveLeadEvent({
          conversationId: activeConversationId,
          customerId: activeCustomerId,
          eventType: 'handoff',
          priority: 'high',
          intentScore: reply.leadIntentScore,
          payload: {
            channel: safeEvent.channel,
            reason: 'auto_hot_lead'
          }
        });

        await updateConversationStatus({
          conversationId: activeConversationId,
          status: 'handoff',
          leadIntentScore: reply.leadIntentScore
        });
        status = 'handoff';

        await sendManagerAlert(
          `Hot lead detected\nChannel: ${safeEvent.channel}\nConversation: ${activeConversationId}\nCustomer: ${activeCustomerId}\nScore: ${reply.leadIntentScore}`
        );
      }
    }

    if (status === 'handoff' && previousStatus !== 'handoff') {
      await upsertLeadBrief({
        conversationId: activeConversationId,
        customerId: activeCustomerId,
        sourceChannel: safeEvent.channel,
        updatedBy: 'system',
        status: 'handoff',
        missingFields: reply.missingFields as LeadBriefField[],
        completenessScore: updatedBrief.completenessScore,
        patch: {
          fullName: updatedBrief.fullName,
          email: updatedBrief.email,
          phone: updatedBrief.phone,
          telegramHandle: updatedBrief.telegramHandle,
          serviceType: updatedBrief.serviceType,
          primaryGoal: updatedBrief.primaryGoal,
          firstDeliverable: updatedBrief.firstDeliverable,
          timelineHint: updatedBrief.timelineHint,
          budgetHint: updatedBrief.budgetHint,
          referralSource: updatedBrief.referralSource,
          constraints: updatedBrief.constraints
        }
      });

      const mode = reply.missingFields.length > 0 ? 'expedite' : 'normal';
      await saveLeadEvent({
        conversationId: activeConversationId,
        customerId: activeCustomerId,
        eventType: 'handoff',
        priority: 'high',
        intentScore: reply.leadIntentScore,
        payload: {
          channel: safeEvent.channel,
          mode,
          missingFields: reply.missingFields
        }
      });
      await sendManagerAlert(
        `Lead handoff ready\nMode: ${mode}\nChannel: ${safeEvent.channel}\nConversation: ${activeConversationId}\nCustomer: ${activeCustomerId}\nMissing fields: ${reply.missingFields.join(', ') || 'none'}`
      );
    }

    const memoryLines: Array<{role: 'user' | 'assistant' | 'manager' | 'system'; content: string}> = [
      ...history.map((item) => ({role: item.role, content: item.content})),
      {role: 'assistant', content: reply.answer}
    ];

    await upsertMemorySnapshot({
      customerId: activeCustomerId,
      summary: summarizeMemory(memoryLines),
      openNeeds: reply.missingFields,
      timelineHint: mergedBrief.timelineHint,
      budgetHint: mergedBrief.budgetHint,
      serviceInterest: mergedBrief.serviceType ? [mergedBrief.serviceType] : []
    });

    await createCommunication({
      customerId: activeCustomerId,
      conversationId: activeConversationId,
      type: 'bot',
      visibility: 'client_visible',
      body: reply.answer,
      payload: {
        channel: safeEvent.channel,
        conversationStage: reply.conversationStage,
        missingFields: reply.missingFields,
        identityState: effectiveIdentityState,
        memoryAccess: effectiveMemoryAccess,
        memoryLoaded: memoryAllowed && Boolean(memory?.summary),
        dialogMode: reply.dialogMode,
        extractorUsed: briefExtraction.extractorUsed,
        extractorModel: briefExtraction.extractorModel,
        extractorDeterministicFallback: briefExtraction.deterministicFallback,
        extractorAmbiguities: briefExtraction.ambiguities,
        extractorFilledFields: Object.entries(briefExtraction.fields)
          .filter(([, value]) => Boolean(cleanText(value)))
          .map(([key]) => key),
        chatLocked,
        chatMode,
        cooldownUntil: cooldownUntil ?? null,
        retryAfterSeconds: retryAfterSeconds ?? null,
        remainingLowCostMessages: remainingLowCostMessages ?? null
      }
    });
    const finalMergedHistory = sessionMerged
      ? mapDialogHistory(await getConversationMessages(activeConversationId, 60))
      : mergedSessionHistory ?? null;

    return {
      channel: safeEvent.channel,
      recipientId: safeEvent.channelUserId,
      text: reply.answer,
      conversationId: activeConversationId,
      metadata: {
        leadIntentScore: reply.leadIntentScore,
        requiresLeadCapture: reply.requiresLeadCapture,
        status,
        topic: reply.topic,
        nextQuestion: reply.nextQuestion,
        conversationStage: reply.conversationStage,
        missingFields: reply.missingFields,
        handoffReady: reply.handoffReady,
        identityState: effectiveIdentityState,
        memoryAccess: effectiveMemoryAccess,
        memoryLoaded: memoryAllowed && Boolean(memory?.summary),
        verificationHint,
        dialogMode: reply.dialogMode,
        extractorUsed: briefExtraction.extractorUsed,
        extractorModel: briefExtraction.extractorModel,
        extractorDeterministicFallback: briefExtraction.deterministicFallback,
        extractorAmbiguities: briefExtraction.ambiguities,
        extractorFilledFields: Object.entries(briefExtraction.fields)
          .filter(([, value]) => Boolean(cleanText(value)))
          .map(([key]) => key),
        chatLocked,
        chatMode,
        cooldownUntil: cooldownUntil ?? null,
        retryAfterSeconds: retryAfterSeconds ?? null,
        remainingLowCostMessages: remainingLowCostMessages ?? null,
        sessionMerged,
        mergedFromConversationId: mergedFromConversationId ?? null,
        history: finalMergedHistory
      }
    };
  } catch (error) {
    await appendDeadLetter({
      channel: safeEvent.channel,
      platformMessageId: safeEvent.platformMessageId,
      payload: safeEvent as unknown as Record<string, unknown>,
      errorMessage: error instanceof Error ? error.message : 'Unknown orchestration error'
    });

    throw error;
  }
}
