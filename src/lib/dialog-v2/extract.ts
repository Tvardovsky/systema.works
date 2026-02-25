import {
  extractLeadSignals,
  hasExplicitBudgetSignal,
  wasReferralQuestionAsked
} from '@/lib/lead-signals';
import type {BriefContext} from '@/types/lead';
import type {
  ContactCandidates,
  DialogTopic,
  ExtractedBriefFields,
  SlotCandidate
} from './types';

function clean(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function makeUnknownCandidate(): SlotCandidate {
  return {
    value: null,
    confidence: 0,
    evidence: null,
    source: null,
    explicit: false,
    updatedThisTurn: false
  };
}

function pickCandidate(params: {
  current: string | null;
  history: string | null;
  context: string | null;
  currentConfidence: number;
  historyConfidence: number;
  explicitCurrent?: boolean;
  explicitHistory?: boolean;
  currentEvidence?: string | null;
  historyEvidence?: string | null;
}): SlotCandidate {
  const current = clean(params.current);
  const history = clean(params.history);
  const context = clean(params.context);
  if (current) {
    return {
      value: current,
      confidence: clampConfidence(params.currentConfidence),
      evidence: clean(params.currentEvidence ?? current),
      source: 'regex',
      explicit: Boolean(params.explicitCurrent),
      updatedThisTurn: true
    };
  }
  if (history) {
    return {
      value: history,
      confidence: clampConfidence(params.historyConfidence),
      evidence: clean(params.historyEvidence ?? history),
      source: 'history',
      explicit: Boolean(params.explicitHistory),
      updatedThisTurn: false
    };
  }
  if (context) {
    return {
      value: context,
      confidence: 1,
      evidence: context,
      source: 'history',
      explicit: true,
      updatedThisTurn: false
    };
  }
  return makeUnknownCandidate();
}

function pickStickyCandidate(params: {
  current: string | null;
  history: string | null;
  context: string | null;
  currentConfidence: number;
  historyConfidence: number;
  explicitCurrent: boolean;
  explicitHistory: boolean;
  contextConfirmed: boolean;
  currentEvidence?: string | null;
  historyEvidence?: string | null;
}): SlotCandidate {
  const current = clean(params.current);
  const history = clean(params.history);
  const context = clean(params.context);

  if (current && params.explicitCurrent) {
    return {
      value: current,
      confidence: clampConfidence(params.currentConfidence),
      evidence: clean(params.currentEvidence ?? current),
      source: 'regex',
      explicit: true,
      updatedThisTurn: true
    };
  }

  if (context && params.contextConfirmed) {
    return {
      value: context,
      confidence: 1,
      evidence: context,
      source: 'history',
      explicit: true,
      updatedThisTurn: false
    };
  }

  if (history && params.explicitHistory) {
    return {
      value: history,
      confidence: clampConfidence(params.historyConfidence),
      evidence: clean(params.historyEvidence ?? history),
      source: 'history',
      explicit: true,
      updatedThisTurn: false
    };
  }

  if (current) {
    return {
      value: current,
      confidence: clampConfidence(Math.min(params.currentConfidence, 0.7)),
      evidence: clean(params.currentEvidence ?? current),
      source: 'regex',
      explicit: false,
      updatedThisTurn: true
    };
  }

  if (history) {
    return {
      value: history,
      confidence: clampConfidence(Math.min(params.historyConfidence, 0.64)),
      evidence: clean(params.historyEvidence ?? history),
      source: 'history',
      explicit: false,
      updatedThisTurn: false
    };
  }

  if (context) {
    return {
      value: context,
      confidence: 0.7,
      evidence: context,
      source: 'history',
      explicit: false,
      updatedThisTurn: false
    };
  }

  return makeUnknownCandidate();
}

function hasTimelineMarker(message: string): boolean {
  return /(deadline|timeline|launch|asap|week|weeks|month|months|срок|дедлайн|запуск|срочно|термін|тиж|місяц|rok|hitno|nedelj|sedmic)/i.test(message);
}

function wasPrimaryGoalQuestionAsked(history: Array<{role: 'user' | 'assistant'; content: string}>): boolean {
  for (let index = history.length - 1; index >= 0 && index >= history.length - 4; index -= 1) {
    const item = history[index];
    if (!item || item.role !== 'assistant') {
      continue;
    }
    const lower = item.content.toLowerCase();
    if (
      lower.includes('бизнес-результат')
      || lower.includes('бізнес-результат')
      || lower.includes('business outcome')
      || lower.includes('poslovni rezultat')
      || lower.includes('главный в этом проекте')
      || lower.includes('primary goal')
      || lower.includes('glavni cilj')
    ) {
      return true;
    }
  }
  return false;
}

function isLikelyContactReply(message: string): boolean {
  return (
    /@/.test(message)
    || /(?:^|\s)(?:email|e-mail|mail|телефон|phone|telegram|телеграм|t\.me\/|tg[:\s])/i.test(message)
    || /^\+?\d[\d\s\-()]{7,}$/.test(message)
  );
}

function isLikelyFillerReply(message: string): boolean {
  const lower = message.toLowerCase();
  return /^(ok|okay|thanks|thank you|да|нет|ок|понял|понятно|спасибо|угу|ясно|хорошо|ага|добре|razumijem|hvala)[.!?]*$/.test(lower);
}

function isLikelyGoalReplyAfterPrompt(message: string): boolean {
  const cleaned = clean(message);
  if (!cleaned) {
    return false;
  }
  if (cleaned.length < 8) {
    return false;
  }
  if (isLikelyFillerReply(cleaned) || isLikelyContactReply(cleaned)) {
    return false;
  }
  return true;
}

function hasGoalLikeContent(message: string): boolean {
  const cleaned = clean(message);
  if (!cleaned) {
    return false;
  }
  if (cleaned.length < 10) {
    return false;
  }
  return /(goal|result|outcome|kpi|conversion|leads|sales|sell|revenue|growth|чтобы|цель|результат|конверси|лид|продаж|продат|выручк|рост|щоб|ціль|результат|конверс|лід|продат|виручк|prodaj|prodati|rezultat|cilj|konverzij|prihod|rast)/i.test(cleaned);
}

const IN_SCOPE_HINTS = [
  'website', 'landing', 'web app', 'mobile', 'app', 'automation', 'ai', 'assistant', 'ui', 'ux',
  'сайт', 'лендинг', 'прилож', 'разработ', 'автоматизац', 'бот',
  'додаток', 'розроб', 'автоматизац',
  'sajt', 'aplikac', 'automatiz'
];

const OUT_OF_SCOPE_HINTS = [
  'weather', 'forecast', 'recipe', 'horoscope', 'lottery', 'sports score',
  'погода', 'гороскоп', 'рецепт', 'лотерея',
  'време', 'horoskop', 'recept'
];

function detectTopic(message: string, hasStructuredSignals: boolean, contextHasService: boolean): DialogTopic {
  const lower = message.toLowerCase();
  const inScope = IN_SCOPE_HINTS.some((hint) => lower.includes(hint));
  const outOfScope = OUT_OF_SCOPE_HINTS.some((hint) => lower.includes(hint));
  if (hasStructuredSignals || contextHasService || inScope) {
    return 'allowed';
  }
  if (outOfScope) {
    return 'disallowed';
  }
  return 'unclear';
}

export type DialogV2ExtractResult = {
  topic: DialogTopic;
  askedReferralBeforeTurn: boolean;
  fields: {
    serviceType: SlotCandidate;
    primaryGoal: SlotCandidate;
    firstDeliverable: SlotCandidate;
    timeline: SlotCandidate;
    budget: SlotCandidate;
    fullName: SlotCandidate;
    referralSource: SlotCandidate;
    constraints: SlotCandidate;
    contact: ContactCandidates;
  };
  extractedFields: ExtractedBriefFields;
};

export function extractDialogV2Candidates(params: {
  message: string;
  history: Array<{role: 'user' | 'assistant'; content: string}>;
  briefContext?: BriefContext;
}): DialogV2ExtractResult {
  const deterministic = extractLeadSignals({
    history: params.history,
    message: params.message
  });
  const currentTurn = extractLeadSignals({
    history: [],
    message: params.message
  });

  const serviceType = pickCandidate({
    current: currentTurn.serviceType,
    history: deterministic.serviceType,
    context: params.briefContext?.serviceType ?? null,
    currentConfidence: 0.88,
    historyConfidence: 0.81,
    explicitCurrent: Boolean(currentTurn.serviceType),
    explicitHistory: Boolean(deterministic.serviceType)
  });

  const askedGoalBeforeTurn = wasPrimaryGoalQuestionAsked(params.history);
  const explicitGoalInCurrentMessage = hasGoalLikeContent(params.message)
    || (askedGoalBeforeTurn && isLikelyGoalReplyAfterPrompt(params.message));
  const explicitGoalCurrentValue = explicitGoalInCurrentMessage
    ? (currentTurn.primaryGoal ?? clean(params.message))
    : null;
  const currentGoalNormalized = clean(currentTurn.primaryGoal);
  const deterministicGoalNormalized = clean(deterministic.primaryGoal);
  const goalHistoryCandidate = !explicitGoalInCurrentMessage
    && currentGoalNormalized
    && deterministicGoalNormalized
    && currentGoalNormalized === deterministicGoalNormalized
    ? null
    : deterministic.primaryGoal;
  const primaryGoal = pickCandidate({
    current: explicitGoalCurrentValue,
    history: goalHistoryCandidate,
    context: params.briefContext?.primaryGoal ?? null,
    currentConfidence: 0.84,
    historyConfidence: 0.78,
    explicitCurrent: explicitGoalInCurrentMessage,
    explicitHistory: Boolean(goalHistoryCandidate)
  });

  const firstDeliverable = pickCandidate({
    current: currentTurn.firstDeliverable,
    history: deterministic.firstDeliverable,
    context: params.briefContext?.firstDeliverable ?? null,
    currentConfidence: 0.84,
    historyConfidence: 0.78,
    explicitCurrent: Boolean(currentTurn.firstDeliverable),
    explicitHistory: Boolean(deterministic.firstDeliverable)
  });

  const contextTimeline = clean(params.briefContext?.timelineHint ?? null);
  const contextTimelineConfirmed = Boolean(contextTimeline && !contextTimeline.startsWith('free_text:'));
  const timelineNormalized = currentTurn.timelineNormalized ?? deterministic.timelineNormalized;
  const explicitTimeline = Boolean(timelineNormalized && !timelineNormalized.startsWith('free_text:')) || hasTimelineMarker(params.message);
  const timeline = pickStickyCandidate({
    current: currentTurn.timelineHint,
    history: deterministic.timelineHint,
    context: contextTimeline,
    currentConfidence: explicitTimeline ? 0.9 : 0.66,
    historyConfidence: 0.72,
    explicitCurrent: explicitTimeline,
    explicitHistory: Boolean(deterministic.timelineNormalized && !deterministic.timelineNormalized.startsWith('free_text:')),
    contextConfirmed: contextTimelineConfirmed
  });

  const explicitBudgetCurrent = hasExplicitBudgetSignal(params.message) || Boolean(currentTurn.budgetNormalized);
  const explicitBudgetHistory = Boolean(deterministic.budgetNormalized);
  const budget = pickStickyCandidate({
    current: currentTurn.budgetHint,
    history: deterministic.budgetHint,
    context: params.briefContext?.budgetHint ?? null,
    currentConfidence: explicitBudgetCurrent ? 0.92 : 0.64,
    historyConfidence: explicitBudgetHistory ? 0.8 : 0.68,
    explicitCurrent: explicitBudgetCurrent,
    explicitHistory: explicitBudgetHistory,
    contextConfirmed: Boolean(clean(params.briefContext?.budgetHint ?? null))
  });

  const fullName = pickCandidate({
    current: currentTurn.name,
    history: deterministic.name,
    context: params.briefContext?.fullName ?? null,
    currentConfidence: 0.9,
    historyConfidence: 0.76,
    explicitCurrent: Boolean(currentTurn.name),
    explicitHistory: Boolean(deterministic.name)
  });

  const referralSource = pickCandidate({
    current: currentTurn.referralSource,
    history: deterministic.referralSource,
    context: params.briefContext?.referralSource ?? null,
    currentConfidence: 0.84,
    historyConfidence: 0.76,
    explicitCurrent: Boolean(currentTurn.referralSource),
    explicitHistory: Boolean(deterministic.referralSource)
  });

  const constraints = pickCandidate({
    current: currentTurn.constraints,
    history: deterministic.constraints,
    context: params.briefContext?.constraints ?? null,
    currentConfidence: 0.76,
    historyConfidence: 0.72,
    explicitCurrent: Boolean(currentTurn.constraints),
    explicitHistory: Boolean(deterministic.constraints)
  });

  const email = pickCandidate({
    current: currentTurn.normalizedEmail ?? currentTurn.email,
    history: deterministic.normalizedEmail ?? deterministic.email,
    context: params.briefContext?.email ?? null,
    currentConfidence: 0.98,
    historyConfidence: 0.95,
    explicitCurrent: Boolean(currentTurn.normalizedEmail),
    explicitHistory: Boolean(deterministic.normalizedEmail)
  });

  const phone = pickCandidate({
    current: currentTurn.normalizedPhone ?? currentTurn.phone,
    history: deterministic.normalizedPhone ?? deterministic.phone,
    context: params.briefContext?.phone ?? null,
    currentConfidence: 0.98,
    historyConfidence: 0.94,
    explicitCurrent: Boolean(currentTurn.normalizedPhone),
    explicitHistory: Boolean(deterministic.normalizedPhone)
  });

  const telegramHandle = pickCandidate({
    current: currentTurn.telegramHandle,
    history: deterministic.telegramHandle,
    context: params.briefContext?.telegramHandle ?? null,
    currentConfidence: 0.97,
    historyConfidence: 0.9,
    explicitCurrent: Boolean(currentTurn.telegramHandle),
    explicitHistory: Boolean(deterministic.telegramHandle)
  });

  const askedReferralBeforeTurn = wasReferralQuestionAsked(params.history);
  const topic = detectTopic(
    params.message,
    Boolean(serviceType.value || primaryGoal.value || firstDeliverable.value),
    Boolean(params.briefContext?.serviceType)
  );

  return {
    topic,
    askedReferralBeforeTurn,
    fields: {
      serviceType,
      primaryGoal,
      firstDeliverable,
      timeline,
      budget,
      fullName,
      referralSource,
      constraints,
      contact: {
        email,
        phone,
        telegramHandle
      }
    },
    extractedFields: {
      fullName: fullName.value,
      email: email.value,
      phone: phone.value,
      telegramHandle: telegramHandle.value,
      serviceType: serviceType.value,
      primaryGoal: primaryGoal.value,
      firstDeliverable: firstDeliverable.value,
      timelineHint: timeline.value,
      budgetHint: budget.value,
      referralSource: referralSource.value,
      constraints: constraints.value
    }
  };
}
