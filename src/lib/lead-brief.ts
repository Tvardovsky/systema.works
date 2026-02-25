import type {Channel, LeadBriefField, LeadBriefStatus} from '@/types/omnichannel';

export type LeadBriefDraft = {
  fullName?: string | null;
  email?: string | null;
  phone?: string | null;
  telegramHandle?: string | null;
  serviceType?: string | null;
  primaryGoal?: string | null;
  firstDeliverable?: string | null;
  timelineHint?: string | null;
  budgetHint?: string | null;
  referralSource?: string | null;
  constraints?: string | null;
  sourceChannel?: Channel | null;
};

export type LeadBriefComputed = {
  missingFields: LeadBriefField[];
  completenessScore: number;
  status: LeadBriefStatus;
  conversationStage: 'discovery' | 'briefing' | 'contact_capture' | 'handoff_ready';
  handoffReady: boolean;
  expediteEligible: boolean;
};

const HIGH_INTENT_HINTS = [
  'call', 'meeting', 'proposal', 'estimate', 'contract', 'ready to start', 'start now',
  'созвон', 'встреч', 'кп', 'коммерческ', 'оценк', 'договор', 'готовы стартовать',
  'дзвін', 'зустріч', 'оцінк', 'догов',
  'poziv', 'sastanak', 'ponuda', 'procena', 'ugovor'
];

function clean(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function hasValue(input?: string | null): boolean {
  return Boolean(clean(input));
}

export function isHighIntentMessage(message: string): boolean {
  const lower = message.toLowerCase();
  return HIGH_INTENT_HINTS.some((hint) => lower.includes(hint));
}

export function computeLeadBriefState(
  draft: LeadBriefDraft,
  options?: {highIntent?: boolean}
): LeadBriefComputed {
  const missingFields: LeadBriefField[] = [];
  const hasContact = hasValue(draft.email) || hasValue(draft.phone) || hasValue(draft.telegramHandle);

  if (!hasValue(draft.fullName)) {
    missingFields.push('full_name');
  }
  if (!hasContact) {
    missingFields.push('contact');
  }
  if (!hasValue(draft.serviceType)) {
    missingFields.push('service_type');
  }
  if (!hasValue(draft.primaryGoal)) {
    missingFields.push('primary_goal');
  }
  if (!hasValue(draft.timelineHint) && !hasValue(draft.budgetHint)) {
    missingFields.push('timeline_or_budget');
  }

  const completenessScore = Math.max(0, Math.min(100, Math.round(((5 - missingFields.length) / 5) * 100)));
  const highIntent = Boolean(options?.highIntent);
  const expediteEligible = highIntent && hasContact && hasValue(draft.serviceType) && missingFields.length <= 1;
  const handoffReady = missingFields.length === 0 || expediteEligible;

  let conversationStage: LeadBriefComputed['conversationStage'] = 'briefing';
  if (!hasValue(draft.serviceType) && !hasValue(draft.primaryGoal)) {
    conversationStage = 'discovery';
  }
  if (!hasContact || !hasValue(draft.fullName)) {
    conversationStage = 'contact_capture';
  }
  if (handoffReady) {
    conversationStage = 'handoff_ready';
  }

  const status: LeadBriefStatus = handoffReady ? 'ready_for_handoff' : 'collecting';
  return {
    missingFields,
    completenessScore,
    status,
    conversationStage,
    handoffReady,
    expediteEligible
  };
}

export function pickPrimaryContact(draft: LeadBriefDraft): {primaryEmail: string | null; primaryPhone: string | null; primaryTelegram: string | null} {
  return {
    primaryEmail: clean(draft.email),
    primaryPhone: clean(draft.phone),
    primaryTelegram: clean(draft.telegramHandle)
  };
}
