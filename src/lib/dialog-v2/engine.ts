import type {ChatResponse} from '@/types/lead';
import {composeDialogV2Answer} from './compose';
import {runDialogV3Director} from './director';
import {extractDialogV2Candidates} from './extract';
import {planDialogV2} from './planner';
import {resolveDialogV2} from './resolve';
import {detectUserIntent} from './user-intent';
import {validateDialogV3Draft} from './validator';
import type {
  DialogFallbackPath,
  DialogBlockingField,
  DialogPlannerRuntimeState,
  DialogRuntimeMode,
  DialogSlotKey,
  DialogTurnMode,
  DialogV2Input,
  DialogV2TurnDecision,
  SlotState
} from './types';

function isHighIntentMessage(message: string): boolean {
  return /(созвон|meeting|call|proposal|contract|срочно|urgent|asap|start now|быстрый старт)/i.test(message);
}

function computeLeadIntentScore(params: {
  topic: 'allowed' | 'unclear' | 'disallowed';
  missingBlocking: DialogBlockingField[];
  handoffReady: boolean;
  highIntent: boolean;
}): number {
  if (params.topic === 'disallowed') {
    return 0;
  }
  if (params.topic === 'unclear') {
    return 20;
  }
  const completenessScore = Math.max(0, Math.min(100, Math.round(((4 - params.missingBlocking.length) / 4) * 100)));
  if (params.handoffReady) {
    return Math.max(85, completenessScore);
  }
  if (params.highIntent) {
    return Math.max(72, Math.min(84, completenessScore));
  }
  return Math.max(30, Math.min(78, completenessScore));
}

function stateAllowsPersist(state: SlotState): boolean {
  return state === 'confirmed' || state === 'candidate';
}

function countQuestions(text: string): number {
  return (text.match(/\?/g) ?? []).length;
}

function clean(input?: string | null): string {
  return (input ?? '').trim().replace(/\s+/g, ' ');
}

function ensureQuestionIncluded(answer: string, nextQuestion: string): string {
  const normalizedAnswer = clean(answer);
  const normalizedQuestion = clean(nextQuestion);
  if (!normalizedQuestion) {
    return normalizedAnswer;
  }
  if (normalizedAnswer.toLowerCase().includes(normalizedQuestion.toLowerCase())) {
    return normalizedAnswer;
  }
  return `${normalizedAnswer} ${normalizedQuestion}`.trim();
}

function getRuntimeMode(input?: DialogRuntimeMode): DialogRuntimeMode {
  if (input === 'v2_deterministic' || input === 'v3_llm_first') {
    return input;
  }
  const configured = process.env.CHAT_DIALOG_MODE?.toLowerCase();
  if (configured === 'v2_deterministic' || configured === 'v3_llm_first') {
    return configured;
  }
  return 'v3_llm_first';
}

function getAnswerOnlyFallback(locale: DialogV2Input['locale']): string {
  if (locale === 'ru') {
    return 'Принял ваш вопрос. Продолжаем по проекту.';
  }
  if (locale === 'uk') {
    return 'Прийняв ваше питання. Продовжуємо по проєкту.';
  }
  if (locale === 'sr-ME') {
    return 'Primio sam vaše pitanje. Nastavljamo po projektu.';
  }
  return 'I got your question. Let us continue with your project.';
}

function readPlannerRuntimeState(
  structuredBrief: Record<string, unknown> | null | undefined
): DialogPlannerRuntimeState | null {
  if (!structuredBrief || typeof structuredBrief !== 'object') {
    return null;
  }
  const raw = structuredBrief as Record<string, unknown>;
  const rawPreviousNextSlot = typeof raw.previousNextSlot === 'string'
    ? raw.previousNextSlot
    : (typeof raw.nextSlot === 'string' ? raw.nextSlot : null);
  const previousNextSlot = (
    rawPreviousNextSlot === 'serviceType'
    || rawPreviousNextSlot === 'primaryGoal'
    || rawPreviousNextSlot === 'firstDeliverable'
    || rawPreviousNextSlot === 'timeline'
    || rawPreviousNextSlot === 'budget'
    || rawPreviousNextSlot === 'contact'
    || rawPreviousNextSlot === 'fullName'
    || rawPreviousNextSlot === 'referralSource'
    || rawPreviousNextSlot === 'handoff'
    || rawPreviousNextSlot === 'scope'
  )
    ? rawPreviousNextSlot
    : null;
  const rawDeferredSlot = typeof raw.deferredSlot === 'string' ? raw.deferredSlot : null;
  const deferredSlot = (
    rawDeferredSlot === 'serviceType'
    || rawDeferredSlot === 'primaryGoal'
    || rawDeferredSlot === 'firstDeliverable'
    || rawDeferredSlot === 'timeline'
    || rawDeferredSlot === 'budget'
    || rawDeferredSlot === 'contact'
    || rawDeferredSlot === 'fullName'
    || rawDeferredSlot === 'referralSource'
  )
    ? rawDeferredSlot
    : null;
  const rawTurns = Number(raw.deferTurnsRemaining ?? 0);
  const deferTurnsRemaining = Number.isFinite(rawTurns) ? Math.max(0, Math.floor(rawTurns)) : 0;
  return {
    previousNextSlot,
    deferredSlot,
    deferTurnsRemaining
  };
}

export async function runDialogV2Turn(input: DialogV2Input): Promise<DialogV2TurnDecision> {
  const runtimeMode = getRuntimeMode(input.runtimeMode);
  const extracted = extractDialogV2Candidates({
    message: input.message,
    history: input.history,
    briefContext: input.briefContext
  });

  const resolved = resolveDialogV2({extracted});
  const plannerRuntimeState = readPlannerRuntimeState((input.briefContext?.briefStructured as Record<string, unknown> | null | undefined) ?? null);
  const plan = planDialogV2({
    locale: input.locale,
    resolved,
    message: input.message,
    previous: plannerRuntimeState
  });

  const deterministicAnswer = composeDialogV2Answer({
    locale: input.locale,
    plan,
    resolved,
    history: input.history
  });
  let answer = deterministicAnswer;
  let nextQuestion = plan.nextQuestion;
  let nextSlot = plan.nextSlot;
  let turnMode: DialogTurnMode = plan.topic === 'allowed' ? 'progress' : 'scope_clarify';
  let questionsCount = countQuestions(answer);
  let fallbackPath: DialogFallbackPath = 'deterministic';
  let llmCallsCount = 0;
  let sameModelFallbackSkipped = false;
  let validatorAdjusted = false;

  if (runtimeMode === 'v3_llm_first') {
    const userIntent = detectUserIntent({
      message: input.message,
      topic: plan.topic
    });
    const forcedTurnMode = userIntent.turnModeSuggestion;
    const director = await runDialogV3Director({
      locale: input.locale,
      topic: plan.topic,
      message: input.message,
      recentHistory: input.history,
      deterministicNextSlot: plan.nextSlot,
      deterministicNextQuestion: plan.nextQuestion,
      missingBlocking: plan.missingBlocking,
      forcedTurnMode,
      conversationId: input.conversationId
    });
    llmCallsCount = director.llmCallsCount;
    fallbackPath = director.fallbackPath;
    sameModelFallbackSkipped = director.sameModelFallbackSkipped;

    const validated = validateDialogV3Draft({
      locale: input.locale,
      topic: plan.topic,
      history: input.history,
      draft: director.draft,
      deterministicNextSlot: plan.nextSlot,
      deterministicNextQuestion: plan.nextQuestion,
      handoffReady: plan.handoffReady,
      forcedTurnMode
    });

    if (validated.forceDeterministic) {
      if (forcedTurnMode === 'answer_only') {
        answer = getAnswerOnlyFallback(input.locale);
        nextQuestion = '';
        nextSlot = plan.nextSlot;
        turnMode = 'answer_only';
        questionsCount = countQuestions(answer);
        validatorAdjusted = true;
      } else {
        answer = deterministicAnswer;
        nextQuestion = plan.nextQuestion;
        nextSlot = plan.nextSlot;
        turnMode = plan.topic === 'allowed' ? 'progress' : 'scope_clarify';
        questionsCount = countQuestions(answer);
      }
      fallbackPath = 'deterministic';
    } else {
      turnMode = validated.turnMode;
      nextSlot = validated.nextSlot;
      nextQuestion = validated.nextQuestion;
      answer = validated.turnMode === 'progress'
        ? ensureQuestionIncluded(validated.answer, validated.nextQuestion)
        : clean(validated.answer);
      questionsCount = validated.questionsCount;
      validatorAdjusted = validated.validatorAdjusted;
    }
  }

  const leadIntentScore = computeLeadIntentScore({
    topic: plan.topic,
    missingBlocking: plan.missingBlocking,
    handoffReady: plan.handoffReady,
    highIntent: isHighIntentMessage(input.message)
  });

  const topic = plan.topic;
  const dialogMode: ChatResponse['dialogMode'] = turnMode === 'scope_clarify'
    ? 'scope_clarify'
    : (topic === 'disallowed'
    ? 'disallowed'
    : (topic === 'unclear' ? 'scope_clarify' : 'context_continuation'));

  const extractedFields = {
    fullName: resolved.slots.fullName.state === 'confirmed' ? resolved.slots.fullName.value : null,
    email: resolved.slots.contact.email.state === 'confirmed' ? resolved.slots.contact.email.value : null,
    phone: resolved.slots.contact.phone.state === 'confirmed' ? resolved.slots.contact.phone.value : null,
    telegramHandle: resolved.slots.contact.telegramHandle.state === 'confirmed' ? resolved.slots.contact.telegramHandle.value : null,
    serviceType: stateAllowsPersist(resolved.slots.serviceType.state) ? resolved.slots.serviceType.value : null,
    primaryGoal: stateAllowsPersist(resolved.slots.primaryGoal.state) ? resolved.slots.primaryGoal.value : null,
    firstDeliverable: stateAllowsPersist(resolved.slots.firstDeliverable.state) ? resolved.slots.firstDeliverable.value : null,
    timelineHint: resolved.slots.timeline.state === 'confirmed' ? resolved.slots.timeline.value : null,
    budgetHint: resolved.slots.budget.state === 'confirmed' ? resolved.slots.budget.value : null,
    referralSource: stateAllowsPersist(resolved.slots.referralSource.state) ? resolved.slots.referralSource.value : null,
    constraints: stateAllowsPersist(resolved.slots.constraints.state) ? resolved.slots.constraints.value : null
  };

  const structuredBrief = {
    engineVersion: runtimeMode === 'v3_llm_first' ? 'v3' as const : 'v2' as const,
    topic,
    slots: {
      serviceType: resolved.slots.serviceType,
      primaryGoal: resolved.slots.primaryGoal,
      firstDeliverable: resolved.slots.firstDeliverable,
      timeline: resolved.slots.timeline,
      budget: resolved.slots.budget,
      contact: resolved.slots.contact,
      fullName: resolved.slots.fullName,
      referralSource: resolved.slots.referralSource
    },
    missingBlocking: plan.missingBlocking,
    nextSlot: turnMode === 'answer_only' ? plan.nextSlot : nextSlot,
    nextQuestion: turnMode === 'answer_only' ? plan.nextQuestion : nextQuestion,
    handoffReady: plan.handoffReady,
    conversationStage: plan.conversationStage,
    referralAskedBeforeTurn: resolved.askedReferralBeforeTurn,
    referralAskedNow: plan.referralAskedNow,
    previousNextSlot: turnMode === 'answer_only' ? null : nextSlot,
    deferredSlot: plan.deferredSlot,
    deferTurnsRemaining: plan.deferTurnsRemaining,
    repeatGuardTriggered: plan.repeatGuardTriggered,
    turnMode,
    questionsCount,
    fallbackPath,
    validatorAdjusted
  };

  const response: ChatResponse = {
    answer,
    topic,
    leadIntentScore,
    nextQuestion,
    requiresLeadCapture: false,
    conversationStage: plan.conversationStage,
    missingFields: plan.missingBlocking,
    handoffReady: plan.handoffReady,
    identityState: input.identityState ?? 'unverified',
    memoryLoaded: false,
    dialogMode,
    llmReplyDeferred: false,
    deferReason: null,
    fallbackModelUsed: runtimeMode === 'v3_llm_first' ? fallbackPath === 'retry' : false,
    gracefulFailUsed: runtimeMode === 'v3_llm_first' ? (fallbackPath === 'deterministic' && llmCallsCount > 0) : false,
    rephraseUsed: false,
    templateBlockTriggered: false,
    repetitionScore: null,
    topicGuard: topic,
    llmCallsCount,
    jsonRepairUsed: false,
    sameModelFallbackSkipped,
    parseFailReason: null,
    replyLatencyMs: null,
    dialogTurnMode: turnMode,
    questionsCount,
    fallbackPath,
    validatorAdjusted
  };

  const updatedSlots = (
    [
      ['serviceType', resolved.slots.serviceType.updatedThisTurn] as const,
      ['primaryGoal', resolved.slots.primaryGoal.updatedThisTurn] as const,
      ['firstDeliverable', resolved.slots.firstDeliverable.updatedThisTurn] as const,
      ['timeline', resolved.slots.timeline.updatedThisTurn] as const,
      ['budget', resolved.slots.budget.updatedThisTurn] as const,
      ['contact', resolved.slots.contact.aggregate.updatedThisTurn] as const,
      ['fullName', resolved.slots.fullName.updatedThisTurn] as const,
      ['referralSource', resolved.slots.referralSource.updatedThisTurn] as const
    ]
      .filter(([, updated]) => updated)
      .map(([slot]) => slot)
  ) as DialogSlotKey[];

  return {
    extractedFields,
    structuredBrief,
    response,
    leadIntentScore,
    nextQuestion,
    diagnostics: {
      engineVersion: runtimeMode === 'v3_llm_first' ? 'v3' : 'v2',
      topic,
      nextSlot: turnMode === 'answer_only' ? plan.nextSlot : nextSlot,
      deferredSlot: plan.deferredSlot,
      deferTurnsRemaining: plan.deferTurnsRemaining,
      repeatGuardTriggered: plan.repeatGuardTriggered,
      updatedSlots,
      turnMode,
      questionsCount,
      fallbackPath,
      validatorAdjusted
    }
  };
}
