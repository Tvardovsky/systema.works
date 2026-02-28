import type {Locale, ChatMessage} from '@/types/lead';
import type {Channel} from '@/types/omnichannel';

/**
 * Topic threads replace rigid slot-filling states.
 * Each thread tracks conversation depth on a specific topic area.
 */
export type TopicThreadKey = 'project_scope' | 'logistics' | 'relationship' | 'handoff';

/**
 * Depth levels within a topic thread.
 * - surface: User mentioned topic briefly
 * - explored: Some details discussed
 * - detailed: Specific requirements captured
 * - decision_ready: User ready to make decisions/commit
 */
export type ThreadDepth = 'surface' | 'explored' | 'detailed' | 'decision_ready';

/**
 * Topic thread state with depth tracking and key entities.
 */
export interface TopicThread {
  key: TopicThreadKey;
  depth: ThreadDepth;
  entities: Record<string, string | string[]>;
  lastActiveAt: number; // Turn number when last active
  openQuestions: string[]; // Unresolved questions in this thread
}

/**
 * User intent classification for current message.
 */
export type UserIntentType =
  | 'statement'           // Sharing information
  | 'question'            // Asking for information
  | 'request'             // Asking assistant to do something
  | 'commitment'          // Ready to proceed/commit
  | 'exploration'         // Want to learn more
  | 'clarification'       // Asking to clarify something
  | 'objection'           // Expressing concern/doubt
  | 'chitchat'            // Social/conversational filler
  | 'handoff_request';    // Explicitly asking for human

/**
 * User emotional state signals.
 */
export type UserSentiment = 'positive' | 'neutral' | 'concerned' | 'frustrated' | 'urgent';

/**
 * Analyzed user intent for current turn.
 */
export interface UserIntent {
  type: UserIntentType;
  sentiment: UserSentiment;
  confidence: number; // 0-1
  topics: TopicThreadKey[]; // Topics user is engaging with
  entities: Record<string, string>; // Extracted entities from message
  isExplorationMode: boolean; // User exploring, not ready for questions
  isCommitmentSignal: boolean; // User showing commitment/readiness
}

/**
 * Conversational context built from history.
 */
export interface ConversationContext {
  threads: Record<TopicThreadKey, TopicThread>;
  activeThread: TopicThreadKey | null;
  userIntent: UserIntent;
  engagementLevel: 'low' | 'medium' | 'high';
  voluntaryDisclosures: number; // Count of info shared without being asked
  userInitiatedQuestions: number; // Count of questions user asked
  messageDepthTrend: 'increasing' | 'stable' | 'decreasing';
  locale: Locale;
  channel: Channel;
}

/**
 * Response components for natural conversation.
 */
export interface ConversationalResponse {
  /** Show understanding of what user said */
  acknowledgment: string;
  /** Add value: insight, option, perspective, or information */
  valueAdd?: string;
  /** Optional: invite to explore further (not a rigid question) */
  explorationInvite?: string;
  /** Signal: ready for human handoff */
  handoffSignal?: boolean;
  /** Internal: which thread to track for next turn */
  nextThread?: TopicThreadKey;
  /** Internal: should we ask a question this turn? */
  shouldAskQuestion: boolean;
  /** Internal: question to ask (if shouldAskQuestion = true) */
  question?: string;
}

/**
 * Full turn decision from orchestrator.
 */
export interface ConversationalTurn {
  response: ConversationalResponse;
  context: ConversationContext;
  updatedThreads: Record<TopicThreadKey, TopicThread>;
  handoffReady: boolean;
  leadIntentScore: number;
  diagnostics: {
    intentType: UserIntentType;
    sentiment: UserSentiment;
    activeThread: TopicThreadKey | null;
    questionsCount: number;
  };
  // Brief extraction result (if extraction ran this turn)
  briefExtraction?: {
    ran: boolean;
    turn: number;
    fieldsUpdated: string[];
    completenessScore: number;
    readyForHandoff: boolean;
    leadScoreChange?: number;
  };
}

/**
 * Input to conversational orchestrator.
 */
export interface ConversationalInput {
  locale: Locale;
  channel: Channel;
  message: string;
  history: ChatMessage[];
  previousContext?: ConversationContext;
  conversationId?: string;
}

/**
 * Handoff detection result.
 */
export interface HandoffSignal {
  isReady: boolean;
  confidence: number;
  signals: string[]; // What triggered handoff readiness
  missingInfo: string[]; // What info still needed for smooth handoff
  action?: 'continue' | 'collect_contact' | 'immediate_handoff';
  shouldAskForContact?: boolean;
  shouldEndConversation?: boolean;
}

/**
 * Engagement quality metrics.
 */
export interface EngagementMetrics {
  averageMessageLength: number;
  depthTrend: 'increasing' | 'stable' | 'decreasing';
  voluntaryDisclosureRate: number; // % of messages with voluntary info
  questionInitiationRate: number; // % of turns where user asks questions
  sentimentProgression: 'improving' | 'stable' | 'declining';
}
