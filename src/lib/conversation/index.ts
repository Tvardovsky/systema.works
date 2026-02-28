/**
 * Conversational AI Assistant Engine
 * 
 * Natural dialog system replacing rigid questionnaire-style chat.
 * Uses topic threads instead of slot-filling for flexible conversation flow.
 */

export {
  runConversationalTurn,
  initializeConversationContext,
  getConversationSummary,
  extractCapturedEntities
} from './orchestrator';

export {
  analyzeUserIntent,
  isUserExploring,
  isUserCommitted,
  isHandoffRequest
} from './intent-analyzer';

export {
  initializeThreads,
  getAllThreads,
  updateThread,
  activateThread,
  answerQuestion,
  getMostActiveThread,
  getOrCreateThread,
  isThreadReadyForHandoff,
  promoteThreadDepth,
  getThreadsSummary,
  mergeThreads
} from './topic-tracker';

export {
  buildConversationContext,
  updateConversationContext,
  getContextSummary,
  extractAllEntities
} from './context-builder';

export {
  composeConversationalResponse,
  composeScenarioResponse
} from './response-composer';

export {
  generateLLMResponse,
  isLLMAvailable,
  getLLMConfig
} from './llm-responder';

export {
  detectHandoffSignal,
  isHandoffComplete,
  markHandoffComplete,
  getHandoffSummary,
  calculateLeadIntentScore
} from './handoff-detector';

// Brief extraction
export {
  extractBriefFromConversation,
  shouldExtractBrief,
  getExtractionConfig,
  isExtractionAvailable
} from './brief-extractor';

export {
  markFieldAsVerified,
  updateBriefField,
  getFieldsNeedingAttention,
  calculateBriefQuality,
  exportBriefForManager,
  createEmptyMergedBrief
} from './brief-merger';

export type {
  TopicThreadKey,
  ThreadDepth,
  TopicThread,
  UserIntentType,
  UserSentiment,
  UserIntent,
  ConversationContext,
  ConversationalResponse,
  ConversationalTurn,
  ConversationalInput,
  HandoffSignal,
  EngagementMetrics
} from './types';

export type {
  LLMResponse,
  LLMResponderInput
} from './llm-responder';

// Brief extraction types
export type {
  ConfidenceLevel,
  ExtractionSource,
  ExtractedField,
  ExtractedBrief,
  MergedBrief,
  BriefCompleteness,
  LLMExtractionOutput,
  LLMFieldOutput,
  LLMAmbiguity,
  BriefExtractionInput,
  BriefExtractionResult,
  BriefExtractionHistory
} from './brief-types';
