import type {ConversationContext, HandoffSignal, TopicThreadKey} from './types';
import {isThreadReadyForHandoff} from './topic-tracker';

/**
 * Patterns indicating explicit handoff request.
 */
const HANDOFF_REQUEST_PATTERNS: RegExp[] = [
  /\b(менеджер|менеджер|manager|human|person|живой|живий|real person)\b/i,
  /\b(созвон|дзвінок|call|meeting|встреча|зустріч|conference)\b/i,
  /\b(готов|готовий|ready|хочу|want|желаю|бажаю)\s+(начинать|починати|start|begin|работать|працювати)\b/i,
  /\b(договор|contract|proposal|кп|оценка|оцінка|estimate|расчет|розрахунок)\b/i,
  /\b(передайте|передайте|transfer|connect|соедините|з'єднайте)\b/i,
  /\b(позови|поклич|call\s+someone|get\s+someone|want\s+human)\b/i
];

/**
 * Patterns indicating commitment/readiness.
 */
const COMMITMENT_PATTERNS: RegExp[] = [
  /\b(срочно|терміново|urgent|asap|быстро|швидко|fast)\b/i,
  /\b(запускать|запускати|launch|start|начинать|починати)\b/i,
  /\b(подписать|підписати|sign|contract|договор|угода)\b/i,
  /\b(оплатить|оплатити|pay|payment|оплата|плата)\b/i
];

/**
 * Patterns indicating frustration with bot.
 */
const BOT_FRUSTRATION_PATTERNS: RegExp[] = [
  /\b(бот|robot|robot|automaton|бездушн|не хочу\s+общаться)\b/i,
  /\b(достаточно|хватит|прекрати|отстань|ухожу)\b/i
];

/**
 * Required info for smooth handoff.
 */
const HANDOFF_REQUIRED_FIELDS: Record<string, TopicThreadKey> = {
  serviceType: 'project_scope',
  primaryGoal: 'project_scope',
  contact: 'relationship'
};

/**
 * Check if user explicitly requested handoff.
 */
function isExplicitHandoffRequest(message: string): boolean {
  return HANDOFF_REQUEST_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Check if user is frustrated with bot.
 */
function isBotFrustration(message: string): boolean {
  return BOT_FRUSTRATION_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Check if user shows commitment signals.
 */
function isCommitmentSignal(message: string): boolean {
  return COMMITMENT_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * Extract missing info for handoff.
 */
function extractMissingInfo(context: ConversationContext): string[] {
  const missing: string[] = [];
  const threads = context.threads;

  // Check project_scope thread
  const scopeThread = threads.project_scope;
  if (!scopeThread.entities.serviceType) {
    missing.push('serviceType');
  }
  if (!scopeThread.entities.primaryGoal) {
    missing.push('primaryGoal');
  }

  // Check relationship thread for contact
  const relationshipThread = threads.relationship;
  const hasContact = !!(
    relationshipThread.entities.email ||
    relationshipThread.entities.phone ||
    relationshipThread.entities.telegramHandle
  );
  const hasName = !!relationshipThread.entities.fullName;

  if (!hasContact) {
    missing.push('contact');
  }
  if (!hasName) {
    missing.push('fullName');
  }

  // Check logistics thread (optional but helpful)
  const logisticsThread = threads.logistics;
  const hasTimeline = !!logisticsThread.entities.timelineHint;
  const hasBudget = !!logisticsThread.entities.budgetHint;

  if (!hasTimeline && !hasBudget) {
    missing.push('timeline_or_budget');
  }

  return missing;
}

/**
 * Calculate handoff confidence score.
 */
function calculateHandoffConfidence(
  context: ConversationContext,
  message: string
): number {
  let confidence = 0.3; // Base confidence

  // Explicit handoff request
  if (isExplicitHandoffRequest(message)) {
    confidence += 0.4;
  }

  // Commitment signals
  if (isCommitmentSignal(message)) {
    confidence += 0.2;
  }

  // Check thread readiness
  const scopeReady = isThreadReadyForHandoff(context.threads.project_scope);
  const relationshipReady = isThreadReadyForHandoff(context.threads.relationship);

  if (scopeReady) {
    confidence += 0.15;
  }
  if (relationshipReady) {
    confidence += 0.15;
  }

  // Engagement level bonus
  if (context.engagementLevel === 'high') {
    confidence += 0.1;
  } else if (context.engagementLevel === 'medium') {
    confidence += 0.05;
  }

  // Commitment signal from intent
  if (context.userIntent.isCommitmentSignal) {
    confidence += 0.15;
  }

  return Math.min(0.95, confidence);
}

/**
 * Detect handoff signals from conversation.
 */
export function detectHandoffSignal(params: {
  context: ConversationContext;
  message: string;
  handoffRequestCount?: number;
  contactCaptured?: boolean;
}): HandoffSignal {
  const {context, message, handoffRequestCount = 0, contactCaptured = false} = params;

  const signals: string[] = [];
  const missingInfo = extractMissingInfo(context);

  // Check for explicit handoff request
  const explicitRequest = isExplicitHandoffRequest(message);
  if (explicitRequest) {
    signals.push('explicit_request');
  }

  // Check for bot frustration (wants human)
  const frustratedWithBot = isBotFrustration(message);
  if (frustratedWithBot) {
    signals.push('bot_frustration');
  }

  // Check for commitment
  if (isCommitmentSignal(message)) {
    signals.push('commitment_signal');
  }

  // Check intent
  if (context.userIntent.type === 'handoff_request') {
    signals.push('handoff_intent');
  }
  if (context.userIntent.isCommitmentSignal) {
    signals.push('commitment_intent');
  }

  // Check thread readiness
  if (isThreadReadyForHandoff(context.threads.project_scope)) {
    signals.push('scope_ready');
  }
  if (isThreadReadyForHandoff(context.threads.relationship)) {
    signals.push('relationship_ready');
  }

  // Calculate confidence
  const confidence = calculateHandoffConfidence(context, message);

  // Determine action based on request count and contact status
  let action: 'continue' | 'collect_contact' | 'immediate_handoff' = 'continue';
  let isReady = false;

  if (explicitRequest || frustratedWithBot) {
    if (contactCaptured) {
      // Contact already provided → immediate handoff
      action = 'immediate_handoff';
      isReady = true;
    } else if (handoffRequestCount >= 1) {
      // Second request → immediate handoff even without contact
      action = 'immediate_handoff';
      isReady = true;
    } else {
      // First request → collect contact
      action = 'collect_contact';
      isReady = false;
    }
  } else if (confidence >= 0.6 || missingInfo.length <= 2) {
    isReady = true;
    action = contactCaptured ? 'immediate_handoff' : 'collect_contact';
  }

  return {
    isReady,
    confidence,
    signals,
    missingInfo,
    action,
    shouldAskForContact: action === 'collect_contact' && !contactCaptured,
    shouldEndConversation: action === 'immediate_handoff' && contactCaptured
  };
}

/**
 * Check if handoff is already complete (manager transferred).
 */
export function isHandoffComplete(context: ConversationContext): boolean {
  return context.threads.handoff.depth === 'decision_ready';
}

/**
 * Mark handoff as complete.
 */
export function markHandoffComplete(
  context: ConversationContext,
  turnNumber: number
): ConversationContext {
  return {
    ...context,
    threads: {
      ...context.threads,
      handoff: {
        ...context.threads.handoff,
        depth: 'decision_ready',
        lastActiveAt: turnNumber
      }
    },
    activeThread: 'handoff'
  };
}

/**
 * Get handoff summary for transfer to manager.
 */
export function getHandoffSummary(context: ConversationContext): Record<string, unknown> {
  const allEntities: Record<string, string | string[]> = {};

  for (const thread of Object.values(context.threads)) {
    Object.assign(allEntities, thread.entities);
  }

  return {
    projectScope: {
      serviceType: context.threads.project_scope.entities.serviceType ?? null,
      primaryGoal: context.threads.project_scope.entities.primaryGoal ?? null,
      constraints: context.threads.project_scope.entities.constraints ?? null
    },
    logistics: {
      timelineHint: context.threads.logistics.entities.timelineHint ?? null,
      budgetHint: context.threads.logistics.entities.budgetHint ?? null
    },
    relationship: {
      fullName: context.threads.relationship.entities.fullName ?? null,
      email: context.threads.relationship.entities.email ?? null,
      phone: context.threads.relationship.entities.phone ?? null,
      telegramHandle: context.threads.relationship.entities.telegramHandle ?? null
    },
    engagementLevel: context.engagementLevel,
    sentiment: context.userIntent.sentiment,
    conversationDepth: Object.keys(allEntities).length
  };
}

/**
 * Calculate lead intent score (0-100) for analytics.
 */
export function calculateLeadIntentScore(context: ConversationContext): number {
  let score = 30; // Base score

  // Engagement level
  if (context.engagementLevel === 'high') {
    score += 25;
  } else if (context.engagementLevel === 'medium') {
    score += 15;
  } else {
    score += 5;
  }

  // Thread depth
  const scopeDepth = context.threads.project_scope.depth;
  if (scopeDepth === 'decision_ready') {
    score += 20;
  } else if (scopeDepth === 'detailed') {
    score += 15;
  } else if (scopeDepth === 'explored') {
    score += 8;
  }

  // Commitment signals
  if (context.userIntent.isCommitmentSignal) {
    score += 15;
  }

  // Sentiment
  if (context.userIntent.sentiment === 'positive') {
    score += 10;
  } else if (context.userIntent.sentiment === 'urgent') {
    score += 12;
  }

  // Voluntary disclosures
  if (context.voluntaryDisclosures >= 3) {
    score += 10;
  } else if (context.voluntaryDisclosures >= 1) {
    score += 5;
  }

  return Math.min(100, Math.max(0, score));
}
