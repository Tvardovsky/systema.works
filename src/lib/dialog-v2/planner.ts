import {
  getContactOnlyPrompt,
  getIdentityRequestPrompt,
  getNameOnlyPrompt,
  getQualificationPrompt,
  getReferralSourcePrompt
} from '@/lib/lead-signals';
import type {Locale} from '@/types/lead';
import type {
  DialogBlockingField,
  DialogPlannerRuntimeState,
  DialogSlotKey,
  DialogTopic
} from './types';
import type {DialogV2ResolveResult} from './resolve';

const SERVICE_TYPE_PROMPT: Record<Locale, string> = {
  ru: 'Какая услуга нужна в первую очередь: сайт/приложение, автоматизация, AI-ассистент, UI/UX или SMM?',
  uk: 'Яка послуга потрібна в першу чергу: сайт/застосунок, автоматизація, AI-асистент, UI/UX чи SMM?',
  en: 'Which service is first priority: website/app, automation, AI assistant, UI/UX, or SMM?',
  'sr-ME': 'Koja usluga je prvi prioritet: sajt/aplikacija, automatizacija, AI asistent, UI/UX ili SMM?'
};

const PRIMARY_GOAL_PROMPT: Record<Locale, string> = {
  ru: 'Какой бизнес-результат для вас главный в этом проекте?',
  uk: 'Який бізнес-результат для вас головний у цьому проєкті?',
  en: 'What business outcome is the primary goal for this project?',
  'sr-ME': 'Koji poslovni rezultat je glavni cilj ovog projekta?'
};

const SCOPE_CLARIFY_PROMPT: Record<Locale, string> = {
  ru: 'Уточните задачу одной фразой: какой цифровой продукт или услугу нужно сделать в первую очередь?',
  uk: 'Уточніть запит однією фразою: який цифровий продукт або послугу потрібно зробити в першу чергу?',
  en: 'Please clarify in one sentence: what digital product or service should we build first?',
  'sr-ME': 'Pojasnite u jednoj rečenici: koji digitalni proizvod ili uslugu treba prvo da uradimo?'
};

const FIRST_DELIVERABLE_PROMPT: Record<Locale, string> = {
  ru: 'Какой первый deliverable приоритетен: структура блоков, прототип или сразу контент?',
  uk: 'Який перший deliverable пріоритетний: структура блоків, прототип чи одразу контент?',
  en: 'Which first deliverable is priority: block structure, prototype, or content first?',
  'sr-ME': 'Koji je prvi deliverable prioritet: struktura blokova, prototip ili odmah sadržaj?'
};

const PROJECT_STRUCTURE_PROMPT: Record<Locale, string> = {
  ru: 'Отлично, обсудим структуру. Какие блоки на лендинге обязательны в первой версии?',
  uk: 'Чудово, обговоримо структуру. Які блоки на лендингу обовʼязкові у першій версії?',
  en: 'Great, let us discuss structure. Which blocks are mandatory on the first landing version?',
  'sr-ME': 'Odlično, hajde o strukturi. Koji blokovi su obavezni na prvoj verziji landing stranice?'
};

const DISCUSS_PROJECT_HINTS = [
  'давай обсуд', 'обсудим структ', 'обсудим проект', 'поговорим о структ', 'поговорим о проект',
  'давайте обсуд', 'давай разбер', 'хочу обсудить структуру',
  'давай обговор', 'обговоримо структ', 'обговоримо проєкт', 'поговоримо про структ',
  "let's discuss", 'let us discuss', 'discuss structure', 'talk about structure', 'talk about the project',
  'hajde da razgovaramo', 'pričajmo o strukturi', 'razgovarajmo o projektu'
];

const MAX_DEFER_TURNS = 3;

type ConversationStage = 'discovery' | 'briefing' | 'contact_capture' | 'handoff_ready';

export type DialogV2Plan = {
  topic: DialogTopic;
  nextSlot: DialogSlotKey | 'handoff' | 'scope';
  nextQuestion: string;
  missingBlocking: DialogBlockingField[];
  handoffReady: boolean;
  referralAskedNow: boolean;
  conversationStage: ConversationStage;
  deferredSlot: DialogSlotKey | null;
  deferTurnsRemaining: number;
  repeatGuardTriggered: boolean;
};

function getConversationStage(params: {
  topic: DialogTopic;
  missingBlocking: DialogBlockingField[];
  handoffReady: boolean;
}): ConversationStage {
  if (params.handoffReady) {
    return 'handoff_ready';
  }
  if (params.topic !== 'allowed') {
    return 'discovery';
  }
  if (params.missingBlocking.includes('service_type') && params.missingBlocking.includes('primary_goal')) {
    return 'discovery';
  }
  if (params.missingBlocking.includes('contact')) {
    return 'contact_capture';
  }
  return 'briefing';
}

function hasDiscussProjectIntent(message: string): boolean {
  const lower = message.toLowerCase();
  return DISCUSS_PROJECT_HINTS.some((hint) => lower.includes(hint));
}

function isDeferrableSlot(slot: DialogV2Plan['nextSlot']): slot is DialogSlotKey {
  return slot === 'timeline' || slot === 'budget' || slot === 'contact';
}

function normalizeRuntimeState(previous?: Partial<DialogPlannerRuntimeState> | null): DialogPlannerRuntimeState {
  const previousNextSlot = previous?.previousNextSlot ?? null;
  const deferredSlot = previous?.deferredSlot ?? null;
  const parsedTurns = Number(previous?.deferTurnsRemaining ?? 0);
  const deferTurnsRemaining = Number.isFinite(parsedTurns)
    ? Math.max(0, Math.min(MAX_DEFER_TURNS, Math.floor(parsedTurns)))
    : 0;
  return {
    previousNextSlot,
    deferredSlot,
    deferTurnsRemaining
  };
}

function getTimelinePrompt(locale: Locale, hasBudget: boolean): string {
  return getQualificationPrompt({
    locale,
    hasScope: true,
    hasBudget,
    hasTimeline: false
  });
}

function getBudgetPrompt(locale: Locale): string {
  return getQualificationPrompt({
    locale,
    hasScope: true,
    hasBudget: false,
    hasTimeline: true
  });
}

function getProjectDiscussionStep(params: {
  locale: Locale;
  resolved: DialogV2ResolveResult;
  blockedSlot?: DialogV2Plan['nextSlot'];
}): {nextSlot: DialogSlotKey; nextQuestion: string} | null {
  if (params.resolved.slots.serviceType.state !== 'confirmed' && params.blockedSlot !== 'serviceType') {
    return {nextSlot: 'serviceType', nextQuestion: SERVICE_TYPE_PROMPT[params.locale]};
  }
  if (params.resolved.slots.primaryGoal.state !== 'confirmed' && params.blockedSlot !== 'primaryGoal') {
    return {nextSlot: 'primaryGoal', nextQuestion: PRIMARY_GOAL_PROMPT[params.locale]};
  }
  if (params.resolved.slots.firstDeliverable.state !== 'confirmed' && params.blockedSlot !== 'firstDeliverable') {
    return {nextSlot: 'firstDeliverable', nextQuestion: FIRST_DELIVERABLE_PROMPT[params.locale]};
  }
  if (params.blockedSlot !== 'firstDeliverable') {
    return {nextSlot: 'firstDeliverable', nextQuestion: PROJECT_STRUCTURE_PROMPT[params.locale]};
  }
  return null;
}

function withDefaults(params: {
  plan: Omit<DialogV2Plan, 'deferredSlot' | 'deferTurnsRemaining' | 'repeatGuardTriggered'>;
}): DialogV2Plan {
  return {
    ...params.plan,
    deferredSlot: null,
    deferTurnsRemaining: 0,
    repeatGuardTriggered: false
  };
}

export function planDialogV2(params: {
  locale: Locale;
  resolved: DialogV2ResolveResult;
  message?: string;
  previous?: Partial<DialogPlannerRuntimeState> | null;
}): DialogV2Plan {
  const {resolved} = params;
  const runtimeState = normalizeRuntimeState(params.previous);
  const discussProjectIntent = hasDiscussProjectIntent(params.message ?? '');

  if (resolved.topic !== 'allowed') {
    return withDefaults({
      plan: {
        topic: resolved.topic,
        nextSlot: 'scope',
        nextQuestion: SCOPE_CLARIFY_PROMPT[params.locale],
        missingBlocking: ['service_type', 'primary_goal'],
        handoffReady: false,
        referralAskedNow: false,
        conversationStage: 'discovery'
      }
    });
  }

  const missingBlocking = [...resolved.missingBlocking];
  const handoffReadyCore = missingBlocking.length === 0;
  let basePlan: DialogV2Plan;

  if (missingBlocking.includes('service_type')) {
    basePlan = withDefaults({
      plan: {
        topic: resolved.topic,
        nextSlot: 'serviceType',
        nextQuestion: SERVICE_TYPE_PROMPT[params.locale],
        missingBlocking,
        handoffReady: false,
        referralAskedNow: false,
        conversationStage: getConversationStage({topic: resolved.topic, missingBlocking, handoffReady: false})
      }
    });
  } else if (missingBlocking.includes('primary_goal')) {
    basePlan = withDefaults({
      plan: {
        topic: resolved.topic,
        nextSlot: 'primaryGoal',
        nextQuestion: PRIMARY_GOAL_PROMPT[params.locale],
        missingBlocking,
        handoffReady: false,
        referralAskedNow: false,
        conversationStage: getConversationStage({topic: resolved.topic, missingBlocking, handoffReady: false})
      }
    });
  } else if (missingBlocking.includes('timeline_or_budget')) {
    const askBudgetNow = resolved.slots.timeline.state !== 'confirmed'
      && resolved.slots.budget.state !== 'confirmed'
      && runtimeState.previousNextSlot === 'timeline';
    const nextSlot: DialogSlotKey = askBudgetNow
      ? 'budget'
      : (resolved.slots.timeline.state === 'confirmed' ? 'budget' : 'timeline');

    basePlan = withDefaults({
      plan: {
        topic: resolved.topic,
        nextSlot,
        nextQuestion: nextSlot === 'budget'
          ? getBudgetPrompt(params.locale)
          : getTimelinePrompt(params.locale, resolved.slots.budget.state === 'confirmed'),
        missingBlocking,
        handoffReady: false,
        referralAskedNow: false,
        conversationStage: getConversationStage({topic: resolved.topic, missingBlocking, handoffReady: false})
      }
    });
  } else if (missingBlocking.includes('contact')) {
    const needsName = resolved.slots.fullName.state !== 'confirmed';
    basePlan = withDefaults({
      plan: {
        topic: resolved.topic,
        nextSlot: 'contact',
        nextQuestion: needsName
          ? getIdentityRequestPrompt(params.locale)
          : getContactOnlyPrompt(params.locale),
        missingBlocking,
        handoffReady: false,
        referralAskedNow: false,
        conversationStage: 'contact_capture'
      }
    });
  } else {
    const shouldAskReferral = resolved.slots.referralSource.state !== 'confirmed' && !resolved.askedReferralBeforeTurn;
    if (shouldAskReferral) {
      basePlan = withDefaults({
        plan: {
          topic: resolved.topic,
          nextSlot: 'referralSource',
          nextQuestion: getReferralSourcePrompt(params.locale),
          missingBlocking,
          handoffReady: false,
          referralAskedNow: true,
          conversationStage: 'briefing'
        }
      });
    } else {
      basePlan = withDefaults({
        plan: {
          topic: resolved.topic,
          nextSlot: 'handoff',
          nextQuestion: getQualificationPrompt({
            locale: params.locale,
            hasScope: true,
            hasBudget: true,
            hasTimeline: true
          }),
          missingBlocking,
          handoffReady: handoffReadyCore,
          referralAskedNow: false,
          conversationStage: 'handoff_ready'
        }
      });
    }
  }

  let deferredSlot = runtimeState.deferredSlot;
  let deferTurnsRemaining = runtimeState.deferTurnsRemaining;

  if (deferredSlot && (!isDeferrableSlot(basePlan.nextSlot) || basePlan.nextSlot !== deferredSlot || deferTurnsRemaining <= 0)) {
    deferredSlot = null;
    deferTurnsRemaining = 0;
  }

  if (!deferredSlot && discussProjectIntent && isDeferrableSlot(basePlan.nextSlot)) {
    deferredSlot = basePlan.nextSlot;
    deferTurnsRemaining = MAX_DEFER_TURNS;
  }

  if (deferredSlot && basePlan.nextSlot === deferredSlot && deferTurnsRemaining > 0) {
    const discussionStep = getProjectDiscussionStep({
      locale: params.locale,
      resolved,
      blockedSlot: deferredSlot
    });
    if (discussionStep) {
      basePlan = {
        ...basePlan,
        nextSlot: discussionStep.nextSlot,
        nextQuestion: discussionStep.nextQuestion,
        conversationStage: 'briefing'
      };
      deferTurnsRemaining = Math.max(0, deferTurnsRemaining - 1);
    } else {
      deferredSlot = null;
      deferTurnsRemaining = 0;
    }
  }

  let repeatGuardTriggered = false;
  const previousNextSlot = runtimeState.previousNextSlot;
  if (previousNextSlot && basePlan.nextSlot === previousNextSlot) {
    if (basePlan.nextSlot === 'timeline' && resolved.slots.budget.state !== 'confirmed') {
      basePlan = {
        ...basePlan,
        nextSlot: 'budget',
        nextQuestion: getBudgetPrompt(params.locale)
      };
      repeatGuardTriggered = true;
    } else if (basePlan.nextSlot === 'budget' && resolved.slots.timeline.state !== 'confirmed') {
      basePlan = {
        ...basePlan,
        nextSlot: 'timeline',
        nextQuestion: getTimelinePrompt(params.locale, true)
      };
      repeatGuardTriggered = true;
    } else if (basePlan.nextSlot === 'contact') {
      const canAskNameOnly = resolved.slots.fullName.state !== 'confirmed';
      if (canAskNameOnly) {
        basePlan = {
          ...basePlan,
          nextSlot: 'fullName',
          nextQuestion: getNameOnlyPrompt(params.locale),
          conversationStage: 'briefing'
        };
        repeatGuardTriggered = true;
      } else {
        const discussionStep = getProjectDiscussionStep({
          locale: params.locale,
          resolved,
          blockedSlot: 'contact'
        });
        if (discussionStep) {
          basePlan = {
            ...basePlan,
            nextSlot: discussionStep.nextSlot,
            nextQuestion: discussionStep.nextQuestion,
            conversationStage: 'briefing'
          };
          repeatGuardTriggered = true;
        }
      }
    }
  }

  return {
    ...basePlan,
    deferredSlot,
    deferTurnsRemaining,
    repeatGuardTriggered
  };
}
