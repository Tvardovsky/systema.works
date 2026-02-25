import type {Locale} from '@/types/lead';

export type Channel = 'web' | 'telegram' | 'instagram' | 'facebook' | 'whatsapp';

export type ConversationStatus = 'open' | 'qualified' | 'hot' | 'handoff' | 'closed';

export type LeadEventType = 'qualified' | 'hot' | 'handoff' | 'won' | 'lost';

export type LeadPriority = 'low' | 'medium' | 'high';
export type LeadReadFilter = 'all' | 'personal_unread' | 'personal_read';
export type LeadSortMode = 'unread_first' | 'updated_desc';

export type LeadBriefStatus = 'collecting' | 'ready_for_handoff' | 'handoff';

export type LeadBriefField = 'full_name' | 'contact' | 'service_type' | 'primary_goal' | 'timeline_or_budget';

export type IdentityState = 'unverified' | 'pending_match' | 'verified';

export type MemoryAccess = 'none' | 'session_only' | 'full_customer';

export type VerificationLevel = 'unverified' | 'verified_channel' | 'verified_phone' | 'verified_strong';

export type LeadBrief = {
  id: string;
  conversationId: string;
  customerId: string;
  status: LeadBriefStatus;
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
  missingFields: LeadBriefField[];
  completenessScore: number;
  sourceChannel: Channel | null;
  updatedBy: 'ai' | 'manager' | 'system';
  createdAt: string;
  updatedAt: string;
};

export type LifecycleStage = 'lead' | 'active_client' | 'past_client';

export type VisibilityLevel = 'internal' | 'client_visible';

export type ProjectStatus = 'planned' | 'in_progress' | 'blocked' | 'done';

export type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'overdue' | 'void';

export type PaymentStatus = 'pending' | 'settled' | 'failed' | 'refunded';

export type CommunicationType = 'bot' | 'manager_note' | 'email' | 'portal_update';

export type InboundEvent = {
  channel: Channel;
  channelUserId: string;
  platformMessageId: string;
  text: string;
  locale?: Locale;
  profileName?: string;
  username?: string;
  phone?: string;
  email?: string;
  metadata?: Record<string, unknown>;
};

export type OutboundAction = {
  channel: Channel;
  recipientId: string;
  text: string;
  conversationId: string;
  metadata?: Record<string, unknown> & {
    memoryLoaded?: boolean;
    identityState?: IdentityState;
    memoryAccess?: MemoryAccess;
    verificationHint?: string;
  };
};

export type CustomerIdentityMatchResult = {
  customerId: string;
  conversationId: string;
  requiresConfirmation: boolean;
  confidence: number;
  identityState: IdentityState;
  memoryAccess: MemoryAccess;
  pendingCustomerId?: string | null;
  verificationHint?: string;
};

export type MemorySnapshot = {
  customerId: string;
  summary: string;
  openNeeds: string[];
  budgetHint: string | null;
  timelineHint: string | null;
  serviceInterest: string[];
  lastUpdatedAt: string;
};

export type MarkReadRequest = {
  mode?: 'read';
};

export type BulkReadRequest = {
  conversationIds: string[];
};
