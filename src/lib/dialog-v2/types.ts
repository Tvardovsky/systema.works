import type {BriefContext, ChatMessage, ChatResponse, Locale} from '@/types/lead';
import type {Channel} from '@/types/omnichannel';

export type DialogRuntimeMode = 'v2_deterministic' | 'v3_llm_first';
export type DialogTurnMode = 'progress' | 'answer_only' | 'scope_clarify';
export type DialogFallbackPath = 'primary' | 'retry' | 'deterministic';

export type DialogSlotKey =
  | 'serviceType'
  | 'primaryGoal'
  | 'firstDeliverable'
  | 'timeline'
  | 'budget'
  | 'contact'
  | 'fullName'
  | 'referralSource';

export type DialogBlockingField = 'service_type' | 'primary_goal' | 'timeline_or_budget' | 'contact';

export type DialogTopic = 'allowed' | 'unclear' | 'disallowed';

export type SlotState = 'confirmed' | 'candidate' | 'unknown';

export type SlotSource = 'regex' | 'history' | 'llm' | null;

export type SlotCandidate = {
  value: string | null;
  confidence: number;
  evidence: string | null;
  source: SlotSource;
  explicit: boolean;
  updatedThisTurn: boolean;
};

export type ResolvedSlot = SlotCandidate & {
  state: SlotState;
};

export type ContactCandidates = {
  email: SlotCandidate;
  phone: SlotCandidate;
  telegramHandle: SlotCandidate;
};

export type ResolvedContact = {
  email: ResolvedSlot;
  phone: ResolvedSlot;
  telegramHandle: ResolvedSlot;
  aggregate: ResolvedSlot;
};

export type ExtractedBriefFields = {
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
};

export type DialogStructuredBrief = {
  engineVersion: 'v2' | 'v3';
  topic: DialogTopic;
  slots: {
    serviceType: ResolvedSlot;
    primaryGoal: ResolvedSlot;
    firstDeliverable: ResolvedSlot;
    timeline: ResolvedSlot;
    budget: ResolvedSlot;
    contact: ResolvedContact;
    fullName: ResolvedSlot;
    referralSource: ResolvedSlot;
  };
  missingBlocking: DialogBlockingField[];
  nextSlot: DialogSlotKey | 'handoff' | 'scope';
  nextQuestion: string;
  handoffReady: boolean;
  conversationStage: 'discovery' | 'briefing' | 'contact_capture' | 'handoff_ready';
  referralAskedBeforeTurn: boolean;
  referralAskedNow: boolean;
  previousNextSlot: DialogSlotKey | 'handoff' | 'scope' | null;
  deferredSlot: DialogSlotKey | null;
  deferTurnsRemaining: number;
  repeatGuardTriggered: boolean;
  turnMode: DialogTurnMode;
  questionsCount: number;
  fallbackPath: DialogFallbackPath;
  validatorAdjusted: boolean;
};

export type DialogPlannerRuntimeState = {
  previousNextSlot: DialogSlotKey | 'handoff' | 'scope' | null;
  deferredSlot: DialogSlotKey | null;
  deferTurnsRemaining: number;
};

export type DialogV2Input = {
  locale: Locale;
  channel: Channel;
  message: string;
  history: ChatMessage[];
  briefContext?: BriefContext;
  identityState?: 'unverified' | 'pending_match' | 'verified';
  runtimeMode?: DialogRuntimeMode;
  conversationId?: string;
};

export type DialogV2TurnDecision = {
  extractedFields: ExtractedBriefFields;
  structuredBrief: DialogStructuredBrief;
  response: ChatResponse;
  leadIntentScore: number;
  nextQuestion: string;
  diagnostics: {
    engineVersion: 'v2' | 'v3';
    topic: DialogTopic;
    nextSlot: DialogStructuredBrief['nextSlot'];
    deferredSlot: DialogStructuredBrief['deferredSlot'];
    deferTurnsRemaining: number;
    repeatGuardTriggered: boolean;
    updatedSlots: DialogSlotKey[];
    turnMode: DialogTurnMode;
    questionsCount: number;
    fallbackPath: DialogFallbackPath;
    validatorAdjusted: boolean;
  };
};
