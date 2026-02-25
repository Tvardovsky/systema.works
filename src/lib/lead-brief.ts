import type {DialogMissingCoreSlot, DialogReadiness, DialogSlotKey} from '@/types/lead';
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
  missingCoreSlots: DialogMissingCoreSlot[];
  completenessScore: number;
  status: LeadBriefStatus;
  conversationStage: 'discovery' | 'briefing' | 'contact_capture' | 'handoff_ready';
  handoffReady: boolean;
  expediteEligible: boolean;
  readiness: DialogReadiness;
  nextSlot: DialogSlotKey | null;
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

function toMissingCoreSlots(missingFields: LeadBriefField[]): DialogMissingCoreSlot[] {
  const slots: DialogMissingCoreSlot[] = [];
  for (const field of missingFields) {
    if (field === 'service_type') {
      slots.push('serviceType');
    } else if (field === 'primary_goal') {
      slots.push('primaryGoal');
    } else if (field === 'timeline_or_budget') {
      slots.push('timeline_or_budget');
    } else if (field === 'contact') {
      slots.push('contact');
    }
  }
  return slots;
}

function pickNextSlot(missingCoreSlots: DialogMissingCoreSlot[]): DialogSlotKey | null {
  if (missingCoreSlots.includes('serviceType')) {
    return 'serviceType';
  }
  if (missingCoreSlots.includes('primaryGoal')) {
    return 'primaryGoal';
  }
  if (missingCoreSlots.includes('timeline_or_budget')) {
    return 'timeline';
  }
  if (missingCoreSlots.includes('contact')) {
    return 'contact';
  }
  return 'handoff';
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

  if (!hasValue(draft.serviceType)) {
    missingFields.push('service_type');
  }
  if (!hasValue(draft.primaryGoal)) {
    missingFields.push('primary_goal');
  }
  if (!hasValue(draft.timelineHint) && !hasValue(draft.budgetHint)) {
    missingFields.push('timeline_or_budget');
  }
  if (!hasContact) {
    missingFields.push('contact');
  }

  const completenessScore = Math.max(0, Math.min(100, Math.round(((4 - missingFields.length) / 4) * 100)));
  const highIntent = Boolean(options?.highIntent);
  const expediteEligible = highIntent && hasContact && hasValue(draft.serviceType) && missingFields.length <= 1;
  const handoffReady = missingFields.length === 0 || expediteEligible;
  const missingCoreSlots = toMissingCoreSlots(missingFields);
  const readiness: DialogReadiness = handoffReady ? 'ready' : 'not_ready';
  const nextSlot = handoffReady ? 'handoff' : pickNextSlot(missingCoreSlots);

  let conversationStage: LeadBriefComputed['conversationStage'] = 'briefing';
  if (!hasValue(draft.serviceType) && !hasValue(draft.primaryGoal)) {
    conversationStage = 'discovery';
  }
  if (!hasContact) {
    conversationStage = 'contact_capture';
  }
  if (handoffReady) {
    conversationStage = 'handoff_ready';
  }

  const status: LeadBriefStatus = handoffReady ? 'ready_for_handoff' : 'collecting';
  return {
    missingFields,
    missingCoreSlots,
    completenessScore,
    status,
    conversationStage,
    handoffReady,
    expediteEligible,
    readiness,
    nextSlot
  };
}

export function pickPrimaryContact(draft: LeadBriefDraft): {primaryEmail: string | null; primaryPhone: string | null; primaryTelegram: string | null} {
  return {
    primaryEmail: clean(draft.email),
    primaryPhone: clean(draft.phone),
    primaryTelegram: clean(draft.telegramHandle)
  };
}
