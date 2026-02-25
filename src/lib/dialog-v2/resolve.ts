import type {
  DialogBlockingField,
  ResolvedContact,
  ResolvedSlot,
  SlotCandidate,
  SlotState
} from './types';
import type {DialogV2ExtractResult} from './extract';

const INFER_CONFIRM_THRESHOLD = 0.78;
const EXPLICIT_CONFIRM_THRESHOLD = 0.7;

function clean(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function similarity(a: string, b: string): number {
  const left = a.toLowerCase().split(/\s+/).filter(Boolean);
  const right = b.toLowerCase().split(/\s+/).filter(Boolean);
  if (!left.length || !right.length) {
    return 0;
  }
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  for (const token of leftSet) {
    if (rightSet.has(token)) {
      overlap += 1;
    }
  }
  const union = leftSet.size + rightSet.size - overlap;
  return union > 0 ? overlap / union : 0;
}

function resolveInferable(input: SlotCandidate): ResolvedSlot {
  const value = clean(input.value);
  if (!value) {
    return {...input, value: null, state: 'unknown'};
  }
  if (input.confidence >= INFER_CONFIRM_THRESHOLD && Boolean(clean(input.evidence))) {
    return {...input, value, state: 'confirmed'};
  }
  return {...input, value, state: 'candidate'};
}

function resolveExplicit(input: SlotCandidate): ResolvedSlot {
  const value = clean(input.value);
  if (!value) {
    return {...input, value: null, state: 'unknown'};
  }
  if (input.explicit && input.confidence >= EXPLICIT_CONFIRM_THRESHOLD) {
    return {...input, value, state: 'confirmed'};
  }
  return {...input, value, state: 'candidate'};
}

function mergeState(a: SlotState, b: SlotState): SlotState {
  if (a === 'confirmed' || b === 'confirmed') {
    return 'confirmed';
  }
  if (a === 'candidate' || b === 'candidate') {
    return 'candidate';
  }
  return 'unknown';
}

function isContextAnchored(input: SlotCandidate): boolean {
  return input.source === 'history'
    && input.explicit
    && !input.updatedThisTurn
    && input.confidence >= 0.99;
}

function resolveTimeline(input: SlotCandidate): ResolvedSlot {
  const value = clean(input.value);
  if (!value) {
    return {...input, value: null, state: 'unknown'};
  }
  const likelyFallbackFreeText = value.startsWith('free_text:');
  if (likelyFallbackFreeText && !input.explicit) {
    if (isContextAnchored(input)) {
      return {...input, value, state: 'confirmed'};
    }
    return {...input, value: null, state: 'unknown'};
  }
  const resolved = resolveExplicit({...input, value});
  if (resolved.state !== 'confirmed' && isContextAnchored(input)) {
    return {...resolved, state: 'confirmed'};
  }
  return resolved;
}

function resolveContact(input: DialogV2ExtractResult['fields']['contact']): ResolvedContact {
  const email = resolveExplicit(input.email);
  const phone = resolveExplicit(input.phone);
  const telegramHandle = resolveExplicit(input.telegramHandle);

  const aggregateState = mergeState(mergeState(email.state, phone.state), telegramHandle.state);
  const aggregateValue = email.value ?? phone.value ?? telegramHandle.value;
  const aggregateConfidence = Math.max(email.confidence, phone.confidence, telegramHandle.confidence);
  const aggregateEvidence = email.evidence ?? phone.evidence ?? telegramHandle.evidence;

  return {
    email,
    phone,
    telegramHandle,
    aggregate: {
      value: aggregateValue,
      confidence: aggregateConfidence,
      evidence: aggregateEvidence,
      source: email.value ? email.source : (phone.value ? phone.source : telegramHandle.source),
      explicit: email.explicit || phone.explicit || telegramHandle.explicit,
      updatedThisTurn: email.updatedThisTurn || phone.updatedThisTurn || telegramHandle.updatedThisTurn,
      state: aggregateState
    }
  };
}

export type DialogV2ResolveResult = {
  topic: DialogV2ExtractResult['topic'];
  askedReferralBeforeTurn: boolean;
  slots: {
    serviceType: ResolvedSlot;
    primaryGoal: ResolvedSlot;
    firstDeliverable: ResolvedSlot;
    timeline: ResolvedSlot;
    budget: ResolvedSlot;
    contact: ResolvedContact;
    fullName: ResolvedSlot;
    referralSource: ResolvedSlot;
    constraints: ResolvedSlot;
  };
  missingBlocking: DialogBlockingField[];
};

export function resolveDialogV2(params: {extracted: DialogV2ExtractResult}): DialogV2ResolveResult {
  const serviceType = resolveInferable(params.extracted.fields.serviceType);
  let primaryGoal = resolveInferable(params.extracted.fields.primaryGoal);
  let firstDeliverable = resolveInferable(params.extracted.fields.firstDeliverable);
  const timeline = resolveTimeline(params.extracted.fields.timeline);
  const budget = resolveExplicit(params.extracted.fields.budget);
  const fullName = resolveExplicit(params.extracted.fields.fullName);
  const referralSource = resolveInferable(params.extracted.fields.referralSource);
  const constraints = resolveInferable(params.extracted.fields.constraints);
  const contact = resolveContact(params.extracted.fields.contact);

  if (firstDeliverable.value && primaryGoal.value) {
    const normalizedDeliverable = firstDeliverable.value.toLowerCase();
    const normalizedGoal = primaryGoal.value.toLowerCase();
    if (normalizedDeliverable === normalizedGoal || similarity(firstDeliverable.value, primaryGoal.value) >= 0.86) {
      const keepGoal = primaryGoal.explicit && !firstDeliverable.explicit;
      const keepDeliverable = firstDeliverable.explicit && !primaryGoal.explicit;
      const clearGoal = keepDeliverable || (!primaryGoal.explicit && !keepGoal && primaryGoal.confidence <= firstDeliverable.confidence);
      if (clearGoal) {
        primaryGoal = {
          ...primaryGoal,
          value: null,
          state: 'unknown'
        };
      } else {
        firstDeliverable = {
          ...firstDeliverable,
          value: null,
          state: 'unknown'
        };
      }
    }
  }

  const missingBlocking: DialogBlockingField[] = [];
  if (serviceType.state !== 'confirmed') {
    missingBlocking.push('service_type');
  }
  if (primaryGoal.state !== 'confirmed') {
    missingBlocking.push('primary_goal');
  }
  if (timeline.state !== 'confirmed' && budget.state !== 'confirmed') {
    missingBlocking.push('timeline_or_budget');
  }
  if (contact.aggregate.state !== 'confirmed') {
    missingBlocking.push('contact');
  }

  return {
    topic: params.extracted.topic,
    askedReferralBeforeTurn: params.extracted.askedReferralBeforeTurn,
    slots: {
      serviceType,
      primaryGoal,
      firstDeliverable,
      timeline,
      budget,
      contact,
      fullName,
      referralSource,
      constraints
    },
    missingBlocking
  };
}
