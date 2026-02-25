export type Locale = 'en' | 'sr-ME' | 'ru' | 'uk';

export type LeadPriority = 'low' | 'medium' | 'high';

export type ChatTopic = 'allowed' | 'disallowed' | 'unclear';

export type ServiceFamily =
  | 'website_app'
  | 'branding_logo'
  | 'automation'
  | 'ai_assistant'
  | 'ui_ux'
  | 'smm_growth'
  | 'unknown';

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type DialogSlotKey =
  | 'serviceType'
  | 'primaryGoal'
  | 'firstDeliverable'
  | 'timeline'
  | 'budget'
  | 'contact'
  | 'fullName'
  | 'referralSource'
  | 'handoff'
  | 'scope';

export type DialogReadiness = 'ready' | 'not_ready';

export type DialogMissingCoreSlot = 'serviceType' | 'primaryGoal' | 'timeline_or_budget' | 'contact';

export type BriefContext = {
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
  briefStructured?: Record<string, unknown> | null;
  briefStructuredVersion?: string | null;
  missingFields?: string[];
  completenessScore?: number;
  hasConversationContact?: boolean;
};

export type ChatResponse = {
  answer: string;
  topic: ChatTopic;
  leadIntentScore: number;
  nextQuestion: string;
  requiresLeadCapture: boolean;
  conversationStage: 'discovery' | 'briefing' | 'contact_capture' | 'handoff_ready';
  missingFields: string[];
  handoffReady: boolean;
  identityState: 'unverified' | 'pending_match' | 'verified';
  memoryAccess?: 'none' | 'session_only' | 'full_customer';
  memoryLoaded: boolean;
  verificationHint?: string;
  dialogMode?: 'context_continuation' | 'scope_clarify' | 'disallowed';
  llmReplyDeferred?: boolean;
  deferReason?: 'quota' | 'rate_limit' | 'connection' | 'parse_error' | null;
  fallbackModelUsed?: boolean;
  gracefulFailUsed?: boolean;
  rephraseUsed?: boolean;
  templateBlockTriggered?: boolean;
  repetitionScore?: number | null;
  topicGuard?: 'allowed' | 'unclear' | 'disallowed';
  llmCallsCount?: number;
  jsonRepairUsed?: boolean;
  sameModelFallbackSkipped?: boolean;
  parseFailReason?: 'length_limit' | 'invalid_json' | 'timeout' | null;
  replyLatencyMs?: number | null;
  dialogTurnMode?: 'progress' | 'answer_only' | 'scope_clarify';
  questionsCount?: number;
  fallbackPath?: 'primary' | 'retry' | 'deterministic';
  validatorAdjusted?: boolean;
};
