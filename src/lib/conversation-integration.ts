/**
 * Conversational Engine Integration Layer
 * 
 * Bridges the new conversational engine with existing orchestrator infrastructure.
 */

import type {Locale} from '@/types/lead';
import type {Channel} from '@/types/omnichannel';
import type {ChatMessage} from '@/types/lead';
import type {
  ConversationContext,
  ConversationalTurn,
  ConversationalInput
} from './conversation/types';
import {runConversationalTurn, initializeConversationContext, extractCapturedEntities} from './conversation/orchestrator';

/**
 * Extracted signals from conversational engine (compatible with existing brief system).
 */
export interface ConversationalExtractedSignals {
  fullName: string | null;
  email: string | null;
  phone: string | null;
  telegramHandle: string | null;
  serviceType: string | null;
  primaryGoal: string | null;
  firstDeliverable: string | null;
  timelineHint: string | null;
  budgetHint: string | null;
  referralSource: string | null;
  constraints: string | null;
}

/**
 * Runtime metadata for conversational engine.
 */
export interface ConversationalRuntimeState {
  context: ConversationContext | null;
  lastTurnAt: string | null;
  turnCount: number;
}

/**
 * Run conversational engine and return compatible response.
 */
export async function runConversationalEngine(params: {
  locale: Locale;
  channel: Channel;
  message: string;
  history: ChatMessage[];
  conversationId: string;
  previousContext?: ConversationContext;
}): Promise<{
  turn: ConversationalTurn;
  extractedSignals: ConversationalExtractedSignals;
  runtimeState: ConversationalRuntimeState;
}> {
  const input: ConversationalInput = {
    locale: params.locale,
    channel: params.channel,
    message: params.message,
    history: params.history,
    previousContext: params.previousContext,
    conversationId: params.conversationId
  };

  const turn = await runConversationalTurn(input);

  // Extract signals for brief persistence
  const entities = extractCapturedEntities(turn.context);
  const extractedSignals: ConversationalExtractedSignals = {
    fullName: entities.fullName ?? null,
    email: entities.email ?? null,
    phone: entities.phone ?? null,
    telegramHandle: entities.telegramHandle ?? null,
    serviceType: entities.serviceType ?? null,
    primaryGoal: entities.primaryGoal ?? null,
    firstDeliverable: entities.firstDeliverable ?? null,
    timelineHint: entities.timelineHint ?? null,
    budgetHint: entities.budgetHint ?? null,
    referralSource: entities.referralSource ?? null,
    constraints: entities.constraints ?? null
  };

  const runtimeState: ConversationalRuntimeState = {
    context: turn.context,
    lastTurnAt: new Date().toISOString(),
    turnCount: params.history.length + 1
  };

  return {
    turn,
    extractedSignals,
    runtimeState
  };
}

/**
 * Read conversational runtime state from metadata.
 */
export function readConversationalRuntimeState(
  metadata?: Record<string, unknown> | null
): ConversationalRuntimeState {
  const raw = (metadata?.conversationalRuntime ?? null) as Record<string, unknown> | null;
  if (!raw || typeof raw !== 'object') {
    return {
      context: null,
      lastTurnAt: null,
      turnCount: 0
    };
  }

  const contextRaw = raw.context ?? null;
  const context: ConversationContext | null = contextRaw && typeof contextRaw === 'object'
    ? (contextRaw as ConversationContext)
    : null;

  const lastTurnAtRaw = raw.lastTurnAt;
  const lastTurnAt = typeof lastTurnAtRaw === 'string' ? lastTurnAtRaw : null;

  const turnCountRaw = raw.turnCount;
  const turnCount = typeof turnCountRaw === 'number' && Number.isFinite(turnCountRaw)
    ? Math.max(0, Math.floor(turnCountRaw))
    : 0;

  return {
    context,
    lastTurnAt,
    turnCount
  };
}

/**
 * Merge conversational runtime state into metadata.
 */
export function mergeConversationalRuntimeMetadata(
  metadata: Record<string, unknown> | null | undefined,
  runtime: ConversationalRuntimeState
): Record<string, unknown> {
  const base = metadata && typeof metadata === 'object' ? {...metadata} : {};
  return {
    ...base,
    conversationalRuntime: runtime
  };
}

/**
 * Convert conversational turn to ChatResponse-compatible format.
 */
export function convertTurnToChatResponse(turn: ConversationalTurn): {
  answer: string;
  topic: 'allowed' | 'unclear' | 'disallowed';
  leadIntentScore: number;
  nextQuestion: string;
  conversationStage: string;
  missingFields: string[];
  handoffReady: boolean;
  dialogMode: string;
  chatLocked: boolean;
  chatMode: string;
} {
  // Build answer from response components
  let answer = turn.response.acknowledgment;
  if (turn.response.valueAdd) {
    answer += ` ${turn.response.valueAdd}`;
  }
  if (turn.response.question) {
    answer += ` ${turn.response.question}`;
  }

  // Determine topic based on context
  const topic: 'allowed' | 'unclear' | 'disallowed' = 
    turn.context.userIntent.type === 'objection' ? 'unclear' :
    turn.context.activeThread === 'project_scope' && turn.context.threads.project_scope.depth === 'surface' ? 'unclear' :
    'allowed';

  // Determine conversation stage
  const conversationStage = turn.handoffReady ? 'handoff_ready' :
    turn.context.threads.project_scope.depth === 'surface' ? 'discovery' :
    turn.context.threads.relationship.depth === 'surface' ? 'contact_capture' :
    'briefing';

  // Determine missing fields based on thread depths
  const missingFields: string[] = [];
  if (turn.context.threads.project_scope.depth === 'surface') {
    missingFields.push('service_type', 'primary_goal');
  }
  if (turn.context.threads.logistics.depth === 'surface') {
    missingFields.push('timeline_or_budget');
  }
  if (turn.context.threads.relationship.depth === 'surface') {
    missingFields.push('contact');
  }

  return {
    answer: answer.trim(),
    topic,
    leadIntentScore: turn.leadIntentScore,
    nextQuestion: turn.response.question ?? '',
    conversationStage,
    missingFields,
    handoffReady: turn.handoffReady,
    dialogMode: turn.context.activeThread ? 'context_continuation' : 'scope_clarify',
    chatLocked: false,
    chatMode: 'normal'
  };
}
