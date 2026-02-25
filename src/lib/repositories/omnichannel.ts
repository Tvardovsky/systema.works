import {getSupabaseAdminClient} from '@/lib/supabase/admin';
import {dedupeLeadPipelineItems} from '@/lib/pipeline-dedupe';
import {
  aggregateTechnicalSignals,
  mergeClientTelemetry,
  readClientTelemetry,
  type ClientTelemetryEventType,
  type ClientTelemetrySnapshot
} from '@/lib/client-telemetry';
import {computeLeadBriefState} from '@/lib/lead-brief';
import {
  getSafetyRetryAfterSeconds,
  isSafetyLockActive,
  readSafetyGuardState,
  type SafetyViolationKind
} from '@/lib/chat-safety';
import type {Locale} from '@/types/lead';
import type {
  Channel,
  LeadBrief,
  LeadBriefField,
  LeadBriefStatus,
  ConversationStatus,
  IdentityState,
  MemoryAccess,
  VerificationLevel,
  CustomerIdentityMatchResult,
  InboundEvent,
  LeadEventType,
  LeadPriority
} from '@/types/omnichannel';

type MessageRole = 'user' | 'assistant' | 'manager' | 'system';

type CustomerRow = {
  id: string;
  full_name: string | null;
  company: string | null;
  locale_pref: Locale | null;
  phones: string[] | null;
  emails: string[] | null;
};

type IdentityRow = {
  id: string;
  customer_id: string;
  channel: Channel;
  channel_user_id: string;
  username: string | null;
  phone: string | null;
  email: string | null;
  match_confidence: number | null;
  pending_link_customer_id: string | null;
  verification_level: VerificationLevel;
  verification_source: string | null;
  verified_at: string | null;
  is_primary: boolean;
};

type ConversationRow = {
  id: string;
  customer_id: string;
  channel: Channel;
  channel_user_id: string | null;
  status: ConversationStatus;
  locale: Locale | null;
  lead_intent_score: number | null;
  assigned_manager_id: string | null;
  identity_state: IdentityState;
  memory_access: MemoryAccess;
  pending_customer_id: string | null;
  last_inbound_message_at: string | null;
  metadata: Record<string, unknown> | null;
  updated_at: string | null;
};

type DeadLetterRow = {
  id: string;
  channel: Channel;
  platform_message_id: string | null;
  payload: Record<string, unknown>;
  error_message: string;
  attempts: number;
  resolved: boolean;
  created_at: string;
};

type LeadBriefRow = {
  id: string;
  conversation_id: string;
  customer_id: string;
  status: LeadBriefStatus;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  telegram_handle: string | null;
  service_type: string | null;
  primary_goal: string | null;
  first_deliverable: string | null;
  timeline_hint: string | null;
  budget_hint: string | null;
  referral_source: string | null;
  constraints: string | null;
  missing_fields: string[] | null;
  completeness_score: number | null;
  source_channel: Channel | null;
  updated_by: 'ai' | 'manager' | 'system';
  created_at: string;
  updated_at: string;
};

type LeadBriefRevisionRow = {
  id: string;
  lead_brief_id: string;
  changed_by_type: 'ai' | 'manager' | 'system';
  changed_by_user_id: string | null;
  before_state: Record<string, unknown>;
  after_state: Record<string, unknown>;
  note: string | null;
  created_at: string;
};

type IdentityClaimStatus = 'captured' | 'candidate_match' | 'verified' | 'rejected';
type LeadReadFilter = 'all' | 'personal_unread' | 'personal_read';
type LeadSortMode = 'unread_first' | 'updated_desc';

const YES_PATTERN = /\b(yes|yeah|yep|sure|ok|confirm|да|угу|tak|si|oui)\b/i;
const NO_PATTERN = /\b(no|nope|cancel|not now|нет|не|stop)\b/i;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function clean(input?: string | null): string | null {
  if (!input) {
    return null;
  }
  const normalized = input.trim().replace(/\s+/g, ' ');
  return normalized || null;
}

function isMissingTableError(errorMessage: string, table: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return normalized.includes(`'public.${table}'`) || normalized.includes(`table \\\"public.${table}\\\"`) || normalized.includes(`relation \\\"public.${table}\\\"`);
}

function isMissingColumnError(errorMessage: string, column: string): boolean {
  const normalized = errorMessage.toLowerCase();
  return (
    (normalized.includes(`column "${column}"`) && normalized.includes('does not exist'))
    || (normalized.includes(`'${column}'`) && normalized.includes('schema cache'))
    || normalized.includes(`column ${column} does not exist`)
  );
}

function normalizeEmail(email?: string | null): string | null {
  const value = clean(email);
  return value ? value.toLowerCase() : null;
}

function normalizePhone(phone?: string | null): string | null {
  const value = clean(phone);
  if (!value) {
    return null;
  }
  const digits = value.replace(/[^\d]/g, '');
  if (digits.length < 8) {
    return null;
  }
  return `+${digits}`;
}

function normalizeTelegramHandle(handle?: string | null): string | null {
  const value = clean(handle);
  if (!value) {
    return null;
  }
  return value.replace(/^@/, '').toLowerCase();
}

function readConversationIpHash(metadata: Record<string, unknown> | null | undefined): string | null {
  const telemetry = readClientTelemetry(metadata ?? null);
  return clean(telemetry?.latest.ipHash ?? null);
}

function isUuid(value?: string | null): value is string {
  if (!value) {
    return false;
  }
  return UUID_RE.test(value);
}

function isTrustedChannel(channel: Channel): boolean {
  return channel === 'telegram' || channel === 'instagram' || channel === 'facebook' || channel === 'whatsapp';
}

function claimStatusRank(status: IdentityClaimStatus): number {
  switch (status) {
    case 'captured':
      return 1;
    case 'candidate_match':
      return 2;
    case 'verified':
      return 3;
    case 'rejected':
      return 4;
    default:
      return 0;
  }
}

function pickHigherClaimStatus(current: IdentityClaimStatus | null | undefined, next: IdentityClaimStatus): IdentityClaimStatus {
  if (!current) {
    return next;
  }
  return claimStatusRank(next) >= claimStatusRank(current) ? next : current;
}

function getConversationSecurityFromIdentity(params: {
  channel: Channel;
  identity?: Pick<IdentityRow, 'pending_link_customer_id' | 'verification_level'> | null;
  hasPending?: boolean;
}): {identityState: IdentityState; memoryAccess: MemoryAccess} {
  if (params.hasPending || params.identity?.pending_link_customer_id) {
    return {identityState: 'pending_match', memoryAccess: 'session_only'};
  }
  if (params.identity?.verification_level && params.identity.verification_level !== 'unverified') {
    return {identityState: 'verified', memoryAccess: 'full_customer'};
  }
  if (isTrustedChannel(params.channel)) {
    return {identityState: 'verified', memoryAccess: 'full_customer'};
  }
  return {identityState: 'unverified', memoryAccess: 'session_only'};
}

function highestVerificationLevel(levels: Array<VerificationLevel | null | undefined>): VerificationLevel {
  if (levels.includes('verified_strong')) {
    return 'verified_strong';
  }
  if (levels.includes('verified_phone')) {
    return 'verified_phone';
  }
  if (levels.includes('verified_channel')) {
    return 'verified_channel';
  }
  return 'unverified';
}

function toLeadBrief(row: LeadBriefRow): LeadBrief {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    customerId: row.customer_id,
    status: row.status,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    telegramHandle: row.telegram_handle,
    serviceType: row.service_type,
    primaryGoal: row.primary_goal,
    firstDeliverable: row.first_deliverable,
    timelineHint: row.timeline_hint,
    budgetHint: row.budget_hint,
    referralSource: row.referral_source ?? null,
    constraints: row.constraints,
    missingFields: (row.missing_fields ?? []) as LeadBriefField[],
    completenessScore: row.completeness_score ?? 0,
    sourceChannel: row.source_channel,
    updatedBy: row.updated_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function isConfirmYes(input: string): boolean {
  return YES_PATTERN.test(input.toLowerCase());
}

function isConfirmNo(input: string): boolean {
  return NO_PATTERN.test(input.toLowerCase());
}

async function createCustomer(input: {
  locale?: Locale;
  fullName?: string;
  email?: string;
  phone?: string;
}): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('customers')
    .insert({
      full_name: input.fullName ?? null,
      locale_pref: input.locale ?? null,
      phones: input.phone ? [input.phone] : [],
      emails: input.email ? [input.email] : []
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Unable to create customer: ${error?.message ?? 'unknown error'}`);
  }

  return data.id as string;
}

async function createConversation(params: {
  customerId: string;
  channel: Channel;
  channelUserId?: string;
  locale?: Locale;
  source?: string;
  identityState?: IdentityState;
  memoryAccess?: MemoryAccess;
  pendingCustomerId?: string | null;
  metadata?: Record<string, unknown>;
}): Promise<string> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('conversations')
    .insert({
      customer_id: params.customerId,
      channel: params.channel,
      channel_user_id: params.channelUserId ?? null,
      status: 'open',
      locale: params.locale ?? null,
      source: params.source ?? null,
      identity_state: params.identityState ?? (params.channel === 'web' ? 'unverified' : 'verified'),
      memory_access: params.memoryAccess ?? (params.channel === 'web' ? 'session_only' : 'full_customer'),
      pending_customer_id: params.pendingCustomerId ?? null,
      metadata: params.metadata ?? null
    })
    .select('id')
    .single();

  if (error || !data) {
    const createError = new Error(`Unable to create conversation: ${error?.message ?? 'unknown error'}`);
    if (error && typeof error === 'object' && 'code' in error) {
      (createError as Error & {code?: unknown}).code = (error as {code?: unknown}).code;
    }
    throw createError;
  }

  return data.id as string;
}

async function findOpenConversation(channel: Channel, channelUserId: string): Promise<ConversationRow | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('conversations')
    .select('id, customer_id, channel, channel_user_id, status, locale, lead_intent_score, assigned_manager_id, identity_state, memory_access, pending_customer_id, last_inbound_message_at, metadata, updated_at')
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId)
    .neq('status', 'closed')
    .order('updated_at', {ascending: false})
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to find conversation: ${error.message}`);
  }

  return (data as ConversationRow | null) ?? null;
}

async function findIdentity(channel: Channel, channelUserId: string): Promise<IdentityRow | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('customer_identities')
    .select('id, customer_id, channel, channel_user_id, username, phone, email, match_confidence, pending_link_customer_id, verification_level, verification_source, verified_at, is_primary')
    .eq('channel', channel)
    .eq('channel_user_id', channelUserId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read identity: ${error.message}`);
  }

  return (data as IdentityRow | null) ?? null;
}

async function ensureIdentity(params: {
  customerId: string;
  channel: Channel;
  channelUserId: string;
  username?: string;
  phone?: string;
  email?: string;
  matchConfidence?: number;
  pendingCustomerId?: string | null;
  verificationLevel?: VerificationLevel;
  verificationSource?: string | null;
  verifiedAt?: string | null;
  isPrimary?: boolean;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('customer_identities').upsert(
    {
      customer_id: params.customerId,
      channel: params.channel,
      channel_user_id: params.channelUserId,
      username: params.username ?? null,
      phone: params.phone ?? null,
      email: params.email ?? null,
      match_confidence: params.matchConfidence ?? 1,
      pending_link_customer_id: params.pendingCustomerId ?? null,
      verification_level: params.verificationLevel ?? 'unverified',
      verification_source: params.verificationSource ?? null,
      verified_at: params.verifiedAt ?? null,
      is_primary: params.isPrimary ?? false,
      last_seen_at: new Date().toISOString()
    },
    {
      onConflict: 'channel,channel_user_id'
    }
  );

  if (error) {
    throw new Error(`Unable to upsert identity: ${error.message}`);
  }
}

async function findCustomerByPhoneOrEmail(phone?: string, email?: string): Promise<string | null> {
  const supabase = getSupabaseAdminClient();

  if (phone) {
    const byPhone = await supabase.from('customers').select('id').contains('phones', [phone]).limit(1).maybeSingle();
    if (!byPhone.error && byPhone.data?.id) {
      return byPhone.data.id as string;
    }
  }

  if (email) {
    const byEmail = await supabase.from('customers').select('id').contains('emails', [email]).limit(1).maybeSingle();
    if (!byEmail.error && byEmail.data?.id) {
      return byEmail.data.id as string;
    }
  }

  return null;
}

async function findCustomerByTelegramHandle(telegramHandle?: string | null): Promise<string | null> {
  const normalized = normalizeTelegramHandle(telegramHandle);
  if (!normalized) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('customer_identities')
    .select('customer_id')
    .ilike('username', normalized)
    .order('last_seen_at', {ascending: false})
    .limit(1)
    .maybeSingle();

  if (error || !data?.customer_id) {
    return null;
  }

  return data.customer_id as string;
}

export async function findCustomerByAnyContact(params: {
  phone?: string | null;
  email?: string | null;
  telegramHandle?: string | null;
  excludeCustomerId?: string;
}): Promise<string | null> {
  const candidateByPhoneEmail = await findCustomerByPhoneOrEmail(
    normalizePhone(params.phone) ?? undefined,
    normalizeEmail(params.email) ?? undefined
  );
  if (candidateByPhoneEmail && (!params.excludeCustomerId || candidateByPhoneEmail !== params.excludeCustomerId)) {
    return candidateByPhoneEmail;
  }

  const candidateByTelegram = await findCustomerByTelegramHandle(params.telegramHandle);
  if (candidateByTelegram && (!params.excludeCustomerId || candidateByTelegram !== params.excludeCustomerId)) {
    return candidateByTelegram;
  }

  return null;
}

export async function findCandidateCustomerByContact(params: {
  phone?: string | null;
  email?: string | null;
  telegramHandle?: string | null;
  excludeCustomerId?: string;
}): Promise<string | null> {
  return findCustomerByAnyContact(params);
}

async function findSoftCandidateByUsername(username?: string): Promise<string | null> {
  if (!username) {
    return null;
  }

  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('customer_identities')
    .select('customer_id, username')
    .ilike('username', username)
    .limit(1)
    .maybeSingle();

  if (error || !data?.customer_id) {
    return null;
  }

  return data.customer_id as string;
}

async function updateConversationCustomer(conversationId: string, customerId: string): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('conversations').update({customer_id: customerId}).eq('id', conversationId);
  if (error) {
    throw new Error(`Unable to update conversation ownership: ${error.message}`);
  }
}

async function updateConversationSecurity(params: {
  conversationId: string;
  identityState?: IdentityState;
  memoryAccess?: MemoryAccess;
  pendingCustomerId?: string | null;
}): Promise<void> {
  const supabase = getSupabaseAdminClient();
  const patch: Record<string, unknown> = {};
  if (params.identityState) {
    patch.identity_state = params.identityState;
  }
  if (params.memoryAccess) {
    patch.memory_access = params.memoryAccess;
  }
  if (params.pendingCustomerId !== undefined) {
    patch.pending_customer_id = params.pendingCustomerId;
  }
  if (Object.keys(patch).length === 0) {
    return;
  }
  const {error} = await supabase.from('conversations').update(patch).eq('id', params.conversationId);
  if (error) {
    throw new Error(`Unable to update conversation security: ${error.message}`);
  }
}

export async function findOpenWebConversationByBrowserKey(browserSessionKey: string): Promise<ConversationRow | null> {
  return findOpenConversation('web', browserSessionKey);
}

function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== 'object') {
    return false;
  }
  const code = 'code' in error ? String((error as {code?: unknown}).code ?? '') : '';
  return code === '23505';
}

export async function createWebSession(params: {
  locale: Locale;
  pagePath: string;
  browserSessionKey: string;
  initialTelemetrySnapshot?: ClientTelemetrySnapshot | null;
}) {
  const existingConversation = await findOpenWebConversationByBrowserKey(params.browserSessionKey);
  if (existingConversation) {
    return {
      sessionId: existingConversation.id,
      customerId: existingConversation.customer_id,
      sessionSource: 'browser_key' as const
    };
  }

  const customerId = await createCustomer({locale: params.locale});
  try {
    const conversationId = await createConversation({
      customerId,
      channel: 'web',
      channelUserId: params.browserSessionKey,
      locale: params.locale,
      source: params.pagePath,
      identityState: 'unverified',
      memoryAccess: 'session_only',
      metadata: params.initialTelemetrySnapshot
        ? {
            clientTelemetry: mergeClientTelemetry(
              null,
              params.initialTelemetrySnapshot,
              'session_start'
            )
          }
        : undefined
    });

    await ensureIdentity({
      customerId,
      channel: 'web',
      channelUserId: params.browserSessionKey,
      matchConfidence: 1,
      verificationLevel: 'unverified',
      verificationSource: 'web_claim',
      verifiedAt: null,
      isPrimary: true
    });

    return {sessionId: conversationId, customerId, sessionSource: 'created' as const};
  } catch (error) {
    if (isUniqueViolation(error)) {
      const concurrent = await findOpenWebConversationByBrowserKey(params.browserSessionKey);
      if (concurrent) {
        try {
          await markWebSessionConflictReused(concurrent.id);
        } catch {
          // Non-blocking marker for conflict-based idempotent reuse.
        }
        return {
          sessionId: concurrent.id,
          customerId: concurrent.customer_id,
          sessionSource: 'conflict_reused' as const
        };
      }
    }
    throw error;
  }
}

async function markWebSessionConflictReused(conversationId: string) {
  const conversation = await getConversationById(conversationId);
  if (!conversation) {
    return;
  }
  const baseMetadata = ((conversation.metadata ?? null) as Record<string, unknown> | null) ?? {};
  const rawState = (baseMetadata.webSessionIdempotency ?? null) as Record<string, unknown> | null;
  const conflictCountRaw = rawState?.conflictReusedCount;
  const conflictReusedCount = typeof conflictCountRaw === 'number' && Number.isFinite(conflictCountRaw)
    ? Math.max(0, Math.floor(conflictCountRaw))
    : 0;

  await updateConversationMetadata({
    conversationId,
    metadata: {
      ...baseMetadata,
      webSessionIdempotency: {
        ...(rawState ?? {}),
        conflictReusedCount: conflictReusedCount + 1,
        lastConflictReusedAt: new Date().toISOString()
      }
    }
  });
}

export async function isChannelEnabled(channel: Channel): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('channel_integrations')
    .select('is_enabled')
    .eq('channel', channel)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read channel integration state: ${error.message}`);
  }

  if (!data) {
    return channel === 'web';
  }

  return Boolean(data.is_enabled);
}

export async function getConversationById(conversationId: string): Promise<ConversationRow | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('conversations')
    .select('id, customer_id, channel, channel_user_id, status, locale, lead_intent_score, assigned_manager_id, identity_state, memory_access, pending_customer_id, last_inbound_message_at, metadata, updated_at')
    .eq('id', conversationId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read conversation: ${error.message}`);
  }

  return (data as ConversationRow | null) ?? null;
}

export async function findOpenWebMergeCandidates(params: {
  customerId: string;
  ipHash: string;
  excludeConversationId?: string;
  windowMinutes?: number;
}): Promise<ConversationRow[]> {
  const supabase = getSupabaseAdminClient();
  const now = Date.now();
  const windowMinutes = Math.max(1, params.windowMinutes ?? 60);
  const cutoffIso = new Date(now - windowMinutes * 60_000).toISOString();

  let query = supabase
    .from('conversations')
    .select('id, customer_id, channel, channel_user_id, status, locale, lead_intent_score, assigned_manager_id, identity_state, memory_access, pending_customer_id, last_inbound_message_at, metadata, updated_at')
    .eq('channel', 'web')
    .eq('customer_id', params.customerId)
    .neq('status', 'closed')
    .gte('updated_at', cutoffIso)
    .order('updated_at', {ascending: false})
    .limit(40);

  if (params.excludeConversationId) {
    query = query.neq('id', params.excludeConversationId);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(`Unable to find web merge candidates: ${error.message}`);
  }

  return ((data ?? []) as ConversationRow[]).filter((conversation) => {
    const candidateIpHash = readConversationIpHash(conversation.metadata);
    return candidateIpHash === params.ipHash;
  });
}

export function rankMergeCandidatesByActivityScore<T extends {updated_at: string | null; activityScore: number}>(
  candidates: T[]
): T[] {
  return [...candidates].sort((left, right) => {
    if (right.activityScore !== left.activityScore) {
      return right.activityScore - left.activityScore;
    }
    return compareTimestampsDesc(left.updated_at, right.updated_at);
  });
}

export async function rankMergeCandidatesByActivity(params: {
  conversations: ConversationRow[];
  windowMessages?: number;
}): Promise<Array<ConversationRow & {activityScore: number}>> {
  const uniqueConversations = Array.from(
    new Map(params.conversations.map((conversation) => [conversation.id, conversation])).values()
  );
  if (!uniqueConversations.length) {
    return [];
  }

  const messageWindow = Math.max(1, Math.min(100, params.windowMessages ?? 30));
  const supabase = getSupabaseAdminClient();
  const activityPairs = await Promise.all(
    uniqueConversations.map(async (conversation) => {
      const {data, error} = await supabase
        .from('messages')
        .select('id')
        .eq('conversation_id', conversation.id)
        .in('role', ['user', 'assistant'] as MessageRole[])
        .order('created_at', {ascending: false})
        .limit(messageWindow);

      if (error) {
        throw new Error(`Unable to rank merge candidates by activity: ${error.message}`);
      }

      return {
        conversationId: conversation.id,
        activityScore: (data ?? []).length
      };
    })
  );

  const activityMap = new Map(activityPairs.map((pair) => [pair.conversationId, pair.activityScore]));
  const ranked = rankMergeCandidatesByActivityScore(
    uniqueConversations.map((conversation) => ({
      ...conversation,
      activityScore: activityMap.get(conversation.id) ?? 0
    }))
  );
  return ranked;
}

export async function findRecentOpenWebConversationByIdentityCustomer(params: {
  browserSessionKey: string;
  ipHash: string;
  windowMinutes?: number;
}): Promise<ConversationRow | null> {
  const identity = await findIdentity('web', params.browserSessionKey);
  if (!identity?.customer_id) {
    return null;
  }

  const candidates = await findOpenWebMergeCandidates({
    customerId: identity.customer_id,
    ipHash: params.ipHash,
    windowMinutes: params.windowMinutes
  });
  if (!candidates.length) {
    return null;
  }

  const [latest] = rankMergeCandidatesByActivityScore(
    candidates.map((conversation) => ({...conversation, activityScore: 0}))
  );
  return latest ?? null;
}

export async function updateConversationMetadata(params: {
  conversationId: string;
  metadata: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase
    .from('conversations')
    .update({metadata: params.metadata})
    .eq('id', params.conversationId);
  if (error) {
    throw new Error(`Unable to update conversation metadata: ${error.message}`);
  }
}

export async function upsertConversationClientTelemetry(params: {
  conversationId: string;
  snapshot: ClientTelemetrySnapshot;
  eventType: ClientTelemetryEventType;
}) {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const metadata = ((conversation.metadata ?? null) as Record<string, unknown> | null) ?? {};
  const nextTelemetry = mergeClientTelemetry(
    metadata.clientTelemetry ?? null,
    params.snapshot,
    params.eventType
  );

  await updateConversationMetadata({
    conversationId: params.conversationId,
    metadata: {
      ...metadata,
      clientTelemetry: nextTelemetry
    }
  });

  return nextTelemetry;
}

export async function setConversationSafetyState(params: {
  conversationId: string;
  invalidStrikes?: number;
  lastViolationKind?: SafetyViolationKind | null;
  lockUntil?: string | null;
  lockReason?: SafetyViolationKind | null;
  closeConversation?: boolean;
}) {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const baseMetadata = ((conversation.metadata ?? null) as Record<string, unknown> | null) ?? {};
  const currentGuard = readSafetyGuardState(baseMetadata);
  const nextInvalidStrikes = typeof params.invalidStrikes === 'number'
    ? Math.max(0, Math.floor(params.invalidStrikes))
    : currentGuard.invalidStrikes;
  const nextGuard = {
    invalidStrikes: nextInvalidStrikes,
    lastViolationKind: params.lastViolationKind ?? currentGuard.lastViolationKind,
    lastViolationAt: params.lastViolationKind ? new Date().toISOString() : currentGuard.lastViolationAt,
    lockUntil: params.lockUntil === undefined ? currentGuard.lockUntil : params.lockUntil,
    lockReason: params.lockReason === undefined ? currentGuard.lockReason : params.lockReason
  };

  const metadata = {
    ...baseMetadata,
    safetyGuard: nextGuard
  };

  const patch: Record<string, unknown> = {metadata};
  if (params.closeConversation) {
    patch.status = 'closed';
  }

  const supabase = getSupabaseAdminClient();
  const {error} = await supabase
    .from('conversations')
    .update(patch)
    .eq('id', params.conversationId);

  if (error) {
    throw new Error(`Unable to update conversation safety state: ${error.message}`);
  }
}

export async function getActiveWebSafetyLockByBrowserKey(browserSessionKey: string, now = new Date()): Promise<{
  conversationId: string;
  lockUntil: string;
  retryAfterSeconds: number;
  reason: SafetyViolationKind | null;
} | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('conversations')
    .select('id, metadata, updated_at')
    .eq('channel', 'web')
    .eq('channel_user_id', browserSessionKey)
    .eq('status', 'closed')
    .order('updated_at', {ascending: false})
    .limit(10);

  if (error) {
    throw new Error(`Unable to read safety lock by browser key: ${error.message}`);
  }

  for (const row of (data ?? []) as Array<{id: string; metadata: Record<string, unknown> | null}>) {
    const guard = readSafetyGuardState((row.metadata ?? null) as Record<string, unknown> | null);
    if (!guard.lockUntil || !isSafetyLockActive(guard.lockUntil, now)) {
      continue;
    }
    return {
      conversationId: row.id,
      lockUntil: guard.lockUntil,
      retryAfterSeconds: getSafetyRetryAfterSeconds(guard.lockUntil, now),
      reason: guard.lockReason
    };
  }

  return null;
}

export async function getConversationMessages(conversationId: string, limit = 30) {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('messages')
    .select('id, role, content, metadata, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', {ascending: true})
    .limit(Math.max(1, Math.min(200, limit)));

  if (error) {
    throw new Error(`Unable to fetch messages: ${error.message}`);
  }

  return (data ?? []) as Array<{id: string; role: MessageRole; content: string; metadata: Record<string, unknown> | null; created_at: string}>;
}

export async function appendConversationMessage(params: {
  conversationId: string;
  role: MessageRole;
  content: string;
  platformMessageId?: string;
  metadata?: Record<string, unknown>;
  visibility?: 'internal' | 'client_visible';
}) {
  const supabase = getSupabaseAdminClient();
  const visibility = params.visibility ?? (params.role === 'user' || params.role === 'assistant' ? 'client_visible' : 'internal');
  const {error} = await supabase.from('messages').insert({
    conversation_id: params.conversationId,
    role: params.role,
    content: params.content,
    platform_message_id: params.platformMessageId ?? null,
    metadata: params.metadata ?? {},
    visibility
  });

  if (error) {
    throw new Error(`Unable to append message: ${error.message}`);
  }
}

export async function upsertMemorySnapshot(params: {
  customerId: string;
  summary: string;
  openNeeds?: string[];
  budgetHint?: string | null;
  timelineHint?: string | null;
  serviceInterest?: string[];
}) {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('memory_snapshots').upsert(
    {
      customer_id: params.customerId,
      summary: params.summary,
      open_needs: params.openNeeds ?? [],
      budget_hint: params.budgetHint ?? null,
      timeline_hint: params.timelineHint ?? null,
      service_interest: params.serviceInterest ?? [],
      last_updated_at: new Date().toISOString()
    },
    {onConflict: 'customer_id'}
  );

  if (error) {
    throw new Error(`Unable to upsert memory snapshot: ${error.message}`);
  }
}

export async function getMemorySnapshot(customerId: string) {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('memory_snapshots')
    .select('customer_id, summary, open_needs, budget_hint, timeline_hint, service_interest, last_updated_at')
    .eq('customer_id', customerId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to fetch memory snapshot: ${error.message}`);
  }

  return data ?? null;
}

export async function touchIdentityContacts(params: {
  customerId: string;
  channel: Channel;
  channelUserId: string;
  username?: string;
  email?: string;
  phone?: string;
  telegramHandle?: string;
}) {
  const existing = await findIdentity(params.channel, params.channelUserId);
  const normalizedEmail = normalizeEmail(params.email) ?? existing?.email ?? undefined;
  const normalizedPhone = normalizePhone(params.phone) ?? existing?.phone ?? undefined;
  const normalizedUsername =
    clean(params.username) ??
    clean(params.telegramHandle)?.replace(/^@/, '') ??
    existing?.username ??
    undefined;

  await ensureIdentity({
    customerId: params.customerId,
    channel: params.channel,
    channelUserId: params.channelUserId,
    username: normalizedUsername,
    email: normalizedEmail,
    phone: normalizedPhone,
    matchConfidence: existing?.match_confidence ?? 1,
    pendingCustomerId: existing?.pending_link_customer_id ?? undefined,
    verificationLevel: existing?.verification_level ?? (isTrustedChannel(params.channel) ? 'verified_channel' : 'unverified'),
    verificationSource: existing?.verification_source ?? (isTrustedChannel(params.channel) ? `${params.channel}_id` : 'web_claim'),
    verifiedAt: existing?.verified_at ?? (isTrustedChannel(params.channel) ? new Date().toISOString() : null),
    isPrimary: existing?.is_primary ?? false
  });
}

export async function captureIdentityClaims(params: {
  conversationId: string;
  customerId: string;
  sourceChannel: Channel;
  email?: string | null;
  phone?: string | null;
  telegramHandle?: string | null;
  status?: IdentityClaimStatus;
  matchedCustomerId?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const claims: Array<{claim_type: 'phone' | 'email' | 'telegram_handle'; claim_value: string; normalized_value: string}> = [];
  const normalizedEmail = normalizeEmail(params.email);
  if (normalizedEmail) {
    claims.push({claim_type: 'email', claim_value: params.email ?? normalizedEmail, normalized_value: normalizedEmail});
  }
  const normalizedPhone = normalizePhone(params.phone);
  if (normalizedPhone) {
    claims.push({claim_type: 'phone', claim_value: params.phone ?? normalizedPhone, normalized_value: normalizedPhone});
  }
  const normalizedTelegram = clean(params.telegramHandle)?.replace(/^@/, '').toLowerCase() ?? null;
  if (normalizedTelegram) {
    claims.push({
      claim_type: 'telegram_handle',
      claim_value: params.telegramHandle ?? `@${normalizedTelegram}`,
      normalized_value: normalizedTelegram
    });
  }

  for (const claim of claims) {
    const existing = await supabase
      .from('identity_claims')
      .select('id, claim_status')
      .eq('conversation_id', params.conversationId)
      .eq('claim_type', claim.claim_type)
      .eq('normalized_value', claim.normalized_value)
      .maybeSingle();

    const finalStatus = pickHigherClaimStatus(
      (existing.data?.claim_status as IdentityClaimStatus | undefined) ?? null,
      params.status ?? 'captured'
    );

    const {error} = await supabase.from('identity_claims').upsert(
      {
        id: existing.data?.id ?? undefined,
        conversation_id: params.conversationId,
        customer_id: params.customerId,
        claim_type: claim.claim_type,
        claim_value: claim.claim_value,
        normalized_value: claim.normalized_value,
        claim_status: finalStatus,
        matched_customer_id: params.matchedCustomerId ?? null,
        source_channel: params.sourceChannel
      },
      {onConflict: 'conversation_id,claim_type,normalized_value'}
    );
    if (error && !isMissingTableError(error.message, 'identity_claims')) {
      throw new Error(`Unable to upsert identity claim: ${error.message}`);
    }
  }
}

export async function upsertLeadBrief(params: {
  conversationId: string;
  customerId: string;
  sourceChannel?: Channel | null;
  updatedBy: 'ai' | 'manager' | 'system';
  status: LeadBriefStatus;
  missingFields: LeadBriefField[];
  completenessScore: number;
  patch?: {
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
  };
}): Promise<LeadBrief> {
  const supabase = getSupabaseAdminClient();
  const payload: Record<string, unknown> = {
    conversation_id: params.conversationId,
    customer_id: params.customerId,
    source_channel: params.sourceChannel ?? null,
    status: params.status,
    missing_fields: params.missingFields,
    completeness_score: params.completenessScore,
    updated_by: params.updatedBy
  };

  const patch = params.patch ?? {};
  if (patch.fullName !== undefined) payload.full_name = clean(patch.fullName);
  if (patch.email !== undefined) payload.email = normalizeEmail(patch.email);
  if (patch.phone !== undefined) payload.phone = normalizePhone(patch.phone) ?? clean(patch.phone);
  if (patch.telegramHandle !== undefined) payload.telegram_handle = clean(patch.telegramHandle);
  if (patch.serviceType !== undefined) payload.service_type = clean(patch.serviceType);
  if (patch.primaryGoal !== undefined) payload.primary_goal = clean(patch.primaryGoal);
  if (patch.firstDeliverable !== undefined) payload.first_deliverable = clean(patch.firstDeliverable);
  if (patch.timelineHint !== undefined) payload.timeline_hint = clean(patch.timelineHint);
  if (patch.budgetHint !== undefined) payload.budget_hint = clean(patch.budgetHint);
  if (patch.referralSource !== undefined) payload.referral_source = clean(patch.referralSource);
  if (patch.constraints !== undefined) payload.constraints = clean(patch.constraints);

  let upsertPayload: Record<string, unknown> = payload;
  let {data, error} = await supabase
    .from('lead_briefs')
    .upsert(upsertPayload, {onConflict: 'conversation_id'})
    .select('*')
    .single();

  if (error && 'referral_source' in upsertPayload && isMissingColumnError(error.message, 'referral_source')) {
    const withoutReferralSource = {...(upsertPayload as Record<string, unknown>)};
    delete withoutReferralSource.referral_source;
    upsertPayload = withoutReferralSource;
    ({data, error} = await supabase
      .from('lead_briefs')
      .upsert(upsertPayload, {onConflict: 'conversation_id'})
      .select('*')
      .single());
  }

  if (error) {
    if (isMissingTableError(error.message, 'lead_briefs')) {
      const now = new Date().toISOString();
      return {
        id: params.conversationId,
        conversationId: params.conversationId,
        customerId: params.customerId,
        status: params.status,
        fullName: clean(params.patch?.fullName ?? null),
        email: normalizeEmail(params.patch?.email ?? null),
        phone: normalizePhone(params.patch?.phone ?? null) ?? clean(params.patch?.phone ?? null),
        telegramHandle: clean(params.patch?.telegramHandle ?? null),
        serviceType: clean(params.patch?.serviceType ?? null),
        primaryGoal: clean(params.patch?.primaryGoal ?? null),
        firstDeliverable: clean(params.patch?.firstDeliverable ?? null),
        timelineHint: clean(params.patch?.timelineHint ?? null),
        budgetHint: clean(params.patch?.budgetHint ?? null),
        referralSource: clean(params.patch?.referralSource ?? null),
        constraints: clean(params.patch?.constraints ?? null),
        missingFields: params.missingFields,
        completenessScore: params.completenessScore,
        sourceChannel: params.sourceChannel ?? null,
        updatedBy: params.updatedBy,
        createdAt: now,
        updatedAt: now
      };
    }
    throw new Error(`Unable to upsert lead brief: ${error.message}`);
  }
  if (!data) {
    throw new Error('Unable to upsert lead brief: missing response data');
  }

  return toLeadBrief(data as LeadBriefRow);
}

export async function appendLeadBriefRevision(params: {
  leadBriefId: string;
  changedByType: 'ai' | 'manager' | 'system';
  changedByUserId?: string | null;
  beforeState: Record<string, unknown>;
  afterState: Record<string, unknown>;
  note?: string;
}) {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('lead_brief_revisions').insert({
    lead_brief_id: params.leadBriefId,
    changed_by_type: params.changedByType,
    changed_by_user_id: params.changedByUserId ?? null,
    before_state: params.beforeState,
    after_state: params.afterState,
    note: clean(params.note)
  });

  if (error) {
    if (isMissingTableError(error.message, 'lead_brief_revisions')) {
      return;
    }
    throw new Error(`Unable to append lead brief revision: ${error.message}`);
  }
}

export async function getLeadBriefByConversation(conversationId: string): Promise<LeadBrief | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('lead_briefs')
    .select('*')
    .eq('conversation_id', conversationId)
    .maybeSingle();

  if (error) {
    if (isMissingTableError(error.message, 'lead_briefs')) {
      return null;
    }
    throw new Error(`Unable to get lead brief: ${error.message}`);
  }
  if (!data) {
    return null;
  }
  return toLeadBrief(data as LeadBriefRow);
}

export async function getLeadBriefRevisions(leadBriefId: string, limit = 100): Promise<LeadBriefRevisionRow[]> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('lead_brief_revisions')
    .select('*')
    .eq('lead_brief_id', leadBriefId)
    .order('created_at', {ascending: false})
    .limit(Math.max(1, Math.min(limit, 500)));
  if (error) {
    if (isMissingTableError(error.message, 'lead_brief_revisions')) {
      return [];
    }
    throw new Error(`Unable to get lead brief revisions: ${error.message}`);
  }
  return (data ?? []) as LeadBriefRevisionRow[];
}

export async function getLeadBriefBundle(conversationId: string) {
  const brief = await getLeadBriefByConversation(conversationId);
  if (!brief) {
    return {brief: null, revisions: [], derivedContacts: null};
  }

  const supabase = getSupabaseAdminClient();
  const [customerRes, identitiesRes, revisions] = await Promise.all([
    supabase.from('customers').select('id, emails, phones').eq('id', brief.customerId).maybeSingle(),
    supabase
      .from('customer_identities')
      .select('id, channel, channel_user_id, username, phone, email, last_seen_at, match_confidence')
      .eq('customer_id', brief.customerId)
      .order('last_seen_at', {ascending: false}),
    getLeadBriefRevisions(brief.id, 100)
  ]);

  const customerEmails = (customerRes.data?.emails ?? []) as string[];
  const customerPhones = (customerRes.data?.phones ?? []) as string[];
  const identities = identitiesRes.data ?? [];
  const allEmails = Array.from(new Set([brief.email, ...customerEmails, ...identities.map((it) => it.email)].filter(Boolean))).map(String);
  const allPhones = Array.from(new Set([brief.phone, ...customerPhones, ...identities.map((it) => it.phone)].filter(Boolean))).map(String);
  const allTelegram = Array.from(
    new Set([brief.telegramHandle, ...identities.map((it) => (it.username ? `@${String(it.username).replace(/^@/, '')}` : null))].filter(Boolean))
  ).map(String);

  return {
    brief,
    revisions,
    derivedContacts: {
      primaryEmail: brief.email ?? allEmails[0] ?? null,
      primaryPhone: brief.phone ?? allPhones[0] ?? null,
      primaryTelegram: brief.telegramHandle ?? allTelegram[0] ?? null,
      allEmails,
      allPhones,
      allTelegram
    }
  };
}

function compareTimestampsDesc(a?: string | null, b?: string | null): number {
  if (!a && !b) {
    return 0;
  }
  if (!a) {
    return 1;
  }
  if (!b) {
    return -1;
  }
  return new Date(b).getTime() - new Date(a).getTime();
}

function isBefore(left?: string | null, right?: string | null): boolean {
  if (!right) {
    return false;
  }
  if (!left) {
    return true;
  }
  return new Date(left).getTime() < new Date(right).getTime();
}

function hasBriefContent(brief: LeadBrief | null): boolean {
  if (!brief) {
    return false;
  }
  return Boolean(
    brief.fullName
    || brief.email
    || brief.phone
    || brief.telegramHandle
    || brief.serviceType
    || brief.primaryGoal
    || brief.firstDeliverable
    || brief.timelineHint
    || brief.budgetHint
    || brief.referralSource
    || brief.constraints
  );
}

function isTechnicalWebNoisePipelineItem(item: {
  conversation: {
    channel: string;
    status: ConversationStatus;
    leadIntentScore: number;
    lastInboundMessageAt: string | null;
  };
  brief: LeadBrief | null;
  latestEvent: {id: string} | null;
}): boolean {
  if (item.conversation.channel !== 'web') {
    return false;
  }
  if (item.conversation.status === 'closed') {
    return false;
  }
  if (item.conversation.lastInboundMessageAt) {
    return false;
  }
  if (Number(item.conversation.leadIntentScore ?? 0) > 0) {
    return false;
  }
  if (item.latestEvent) {
    return false;
  }
  if (hasBriefContent(item.brief)) {
    return false;
  }
  return true;
}

function isUnknownCustomerName(value?: string | null): boolean {
  const normalized = clean(value)?.toLowerCase() ?? '';
  if (!normalized) {
    return true;
  }
  if (normalized === '-' || normalized === '—') {
    return true;
  }
  return normalized === 'unknown'
    || normalized === 'неизвестно'
    || normalized === 'невідомо'
    || normalized === 'nepoznato';
}

export async function markConversationRead(params: {
  conversationId: string;
  adminUserId: string;
}) {
  if (!isUuid(params.adminUserId)) {
    throw new Error('Admin user id must be a valid UUID');
  }

  const supabase = getSupabaseAdminClient();
  const [latestMessage, nowIso] = await Promise.all([
    supabase
      .from('messages')
      .select('id')
      .eq('conversation_id', params.conversationId)
      .order('created_at', {ascending: false})
      .limit(1)
      .maybeSingle(),
    Promise.resolve(new Date().toISOString())
  ]);

  if (latestMessage.error) {
    throw new Error(`Unable to resolve last read message: ${latestMessage.error.message}`);
  }

  const {error} = await supabase.from('admin_conversation_reads').upsert(
    {
      conversation_id: params.conversationId,
      admin_user_id: params.adminUserId,
      last_read_message_id: latestMessage.data?.id ?? null,
      last_read_at: nowIso
    },
    {onConflict: 'conversation_id,admin_user_id'}
  );

  if (error) {
    if (isMissingTableError(error.message, 'admin_conversation_reads')) {
      return;
    }
    throw new Error(`Unable to mark conversation as read: ${error.message}`);
  }
}

export async function markConversationsReadBulk(params: {
  conversationIds: string[];
  adminUserId: string;
}) {
  if (!isUuid(params.adminUserId)) {
    throw new Error('Admin user id must be a valid UUID');
  }

  const conversationIds = Array.from(new Set(params.conversationIds.filter(Boolean)));
  if (!conversationIds.length) {
    return {count: 0};
  }

  const supabase = getSupabaseAdminClient();
  const latestMessages = await supabase
    .from('messages')
    .select('id, conversation_id, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', {ascending: false});

  if (latestMessages.error) {
    throw new Error(`Unable to resolve latest messages: ${latestMessages.error.message}`);
  }

  const latestMessageByConversation = new Map<string, string>();
  for (const row of latestMessages.data ?? []) {
    const conversationId = String(row.conversation_id);
    if (!latestMessageByConversation.has(conversationId)) {
      latestMessageByConversation.set(conversationId, String(row.id));
    }
  }

  const nowIso = new Date().toISOString();
  const rows = conversationIds.map((conversationId) => ({
    conversation_id: conversationId,
    admin_user_id: params.adminUserId,
    last_read_message_id: latestMessageByConversation.get(conversationId) ?? null,
    last_read_at: nowIso
  }));

  const {error} = await supabase
    .from('admin_conversation_reads')
    .upsert(rows, {onConflict: 'conversation_id,admin_user_id'});

  if (error) {
    if (isMissingTableError(error.message, 'admin_conversation_reads')) {
      return {count: 0};
    }
    throw new Error(`Unable to bulk mark conversations as read: ${error.message}`);
  }

  return {count: conversationIds.length};
}

export async function getConversationReadState(params: {
  conversationIds: string[];
  adminUserId?: string | null;
}): Promise<Map<string, {personalLastReadAt: string | null; globalLastReadAt: string | null}>> {
  const conversationIds = Array.from(new Set(params.conversationIds.filter(Boolean)));
  const result = new Map<string, {personalLastReadAt: string | null; globalLastReadAt: string | null}>();
  if (!conversationIds.length) {
    return result;
  }

  const adminUserId = isUuid(params.adminUserId) ? params.adminUserId : null;
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('admin_conversation_reads')
    .select('conversation_id, admin_user_id, last_read_at')
    .in('conversation_id', conversationIds);

  if (error) {
    if (isMissingTableError(error.message, 'admin_conversation_reads')) {
      return result;
    }
    throw new Error(`Unable to fetch read state: ${error.message}`);
  }

  for (const conversationId of conversationIds) {
    result.set(conversationId, {personalLastReadAt: null, globalLastReadAt: null});
  }

  for (const row of data ?? []) {
    const conversationId = String(row.conversation_id);
    const current = result.get(conversationId) ?? {personalLastReadAt: null, globalLastReadAt: null};
    const rowReadAt = row.last_read_at ? String(row.last_read_at) : null;
    if (!rowReadAt) {
      result.set(conversationId, current);
      continue;
    }

    if (!current.globalLastReadAt || isBefore(current.globalLastReadAt, rowReadAt)) {
      current.globalLastReadAt = rowReadAt;
    }
    if (adminUserId && String(row.admin_user_id) === adminUserId) {
      if (!current.personalLastReadAt || isBefore(current.personalLastReadAt, rowReadAt)) {
        current.personalLastReadAt = rowReadAt;
      }
    }
    result.set(conversationId, current);
  }

  return result;
}

export async function listLeadPipeline(params: {
  limit: number;
  status?: ConversationStatus;
  assignee?: string;
  q?: string;
  viewerUserId?: string | null;
  readFilter?: LeadReadFilter;
  sort?: LeadSortMode;
}) {
  const supabase = getSupabaseAdminClient();
  let convQuery = supabase
    .from('conversations')
    .select('id, customer_id, channel, channel_user_id, status, lead_intent_score, locale, source, assigned_manager_id, identity_state, memory_access, pending_customer_id, last_inbound_message_at, updated_at, created_at')
    .neq('status', 'closed')
    .order('updated_at', {ascending: false})
    .limit(Math.max(1, Math.min(500, params.limit)));

  if (params.status) {
    convQuery = convQuery.eq('status', params.status);
  }
  if (params.assignee) {
    convQuery = convQuery.eq('assigned_manager_id', params.assignee);
  }

  const convRes = await convQuery;
  if (convRes.error) {
    throw new Error(`Unable to list pipeline conversations: ${convRes.error.message}`);
  }

  const conversations = (convRes.data ?? []) as Array<Record<string, unknown>>;
  const browserKeyByConversationId = new Map<string, string>();
  for (const conversation of conversations) {
    const channel = String(conversation.channel ?? '').toLowerCase();
    const conversationId = String(conversation.id);
    const channelUserId = typeof conversation.channel_user_id === 'string'
      ? conversation.channel_user_id.trim()
      : '';
    if (channel === 'web' && channelUserId) {
      browserKeyByConversationId.set(conversationId, channelUserId);
    }
  }
  const conversationIds = conversations.map((item) => String(item.id));
  const customerIds = Array.from(new Set(conversations.map((item) => String(item.customer_id))));
  const viewerUserId = isUuid(params.viewerUserId) ? params.viewerUserId : null;

  const [briefRes, customerRes, eventsRes, identityRes, readState] = await Promise.all([
    conversationIds.length
      ? supabase.from('lead_briefs').select('*').in('conversation_id', conversationIds)
      : Promise.resolve({data: [], error: null}),
    customerIds.length
      ? supabase.from('customers').select('id, full_name, company, emails, phones').in('id', customerIds)
      : Promise.resolve({data: [], error: null}),
    conversationIds.length
      ? supabase
          .from('lead_events')
          .select('id, conversation_id, event_type, priority, intent_score, created_at')
          .in('conversation_id', conversationIds)
          .order('created_at', {ascending: false})
      : Promise.resolve({data: [], error: null}),
    customerIds.length
      ? supabase
          .from('customer_identities')
          .select('customer_id, verification_level')
          .in('customer_id', customerIds)
      : Promise.resolve({data: [], error: null}),
    getConversationReadState({
      conversationIds,
      adminUserId: viewerUserId
    })
  ]);

  if (briefRes.error && !isMissingTableError(briefRes.error.message, 'lead_briefs')) {
    throw new Error(`Unable to list lead briefs: ${briefRes.error.message}`);
  }
  if (customerRes.error) {
    throw new Error(`Unable to list lead customers: ${customerRes.error.message}`);
  }
  if (eventsRes.error) {
    throw new Error(`Unable to list lead events: ${eventsRes.error.message}`);
  }
  if (identityRes.error) {
    throw new Error(`Unable to list customer identities: ${identityRes.error.message}`);
  }

  const briefByConversation = new Map<string, LeadBriefRow>(
    ((briefRes.data ?? []) as LeadBriefRow[]).map((row) => [row.conversation_id, row])
  );
  const customerById = new Map<string, Record<string, unknown>>(
    ((customerRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );
  const latestEventByConversation = new Map<string, Record<string, unknown>>();
  for (const event of (eventsRes.data ?? []) as Array<Record<string, unknown>>) {
    const key = String(event.conversation_id);
    if (!latestEventByConversation.has(key)) {
      latestEventByConversation.set(key, event);
    }
  }
  const identityLevelsByCustomer = new Map<string, VerificationLevel[]>();
  for (const row of (identityRes.data ?? []) as Array<{customer_id: string; verification_level: VerificationLevel | null}>) {
    const key = String(row.customer_id);
    const list = identityLevelsByCustomer.get(key) ?? [];
    list.push(row.verification_level ?? 'unverified');
    identityLevelsByCustomer.set(key, list);
  }

  let items = conversations.map((conversation) => {
    const customerId = String(conversation.customer_id);
    const customer = customerById.get(customerId);
    const briefRow = briefByConversation.get(String(conversation.id));
    const latestEvent = latestEventByConversation.get(String(conversation.id));
    const conversationId = String(conversation.id);
    const inboundAt = conversation.last_inbound_message_at ? String(conversation.last_inbound_message_at) : null;
    const read = readState.get(conversationId) ?? {personalLastReadAt: null, globalLastReadAt: null};
    const personalUnread = Boolean(inboundAt && (!read.personalLastReadAt || isBefore(read.personalLastReadAt, inboundAt)));
    const globalUnread = Boolean(inboundAt && (!read.globalLastReadAt || isBefore(read.globalLastReadAt, inboundAt)));
    const isNewForAdmin = Boolean(inboundAt && !read.personalLastReadAt);

    return {
      conversation: {
        id: conversationId,
        customerId,
        channel: String(conversation.channel),
        source: conversation.source ? String(conversation.source) : null,
        status: (conversation.status ? String(conversation.status) : 'open') as ConversationStatus,
        leadIntentScore: Number(conversation.lead_intent_score ?? 0),
        assignedManagerId: conversation.assigned_manager_id ? String(conversation.assigned_manager_id) : null,
        identityState: (conversation.identity_state ? String(conversation.identity_state) : 'unverified') as IdentityState,
        memoryAccess: (conversation.memory_access ? String(conversation.memory_access) : 'session_only') as MemoryAccess,
        pendingCustomerId: conversation.pending_customer_id ? String(conversation.pending_customer_id) : null,
        lastInboundMessageAt: inboundAt,
        personalUnread,
        globalUnread,
        isNewForAdmin,
        personalLastReadAt: read.personalLastReadAt,
        globalLastReadAt: read.globalLastReadAt,
        updatedAt: String(conversation.updated_at),
        createdAt: String(conversation.created_at)
      },
      customer: {
        id: customerId,
        fullName: customer?.full_name ? String(customer.full_name) : null,
        company: customer?.company ? String(customer.company) : null,
        emails: (customer?.emails as string[] | undefined) ?? [],
        phones: (customer?.phones as string[] | undefined) ?? []
      },
      brief: briefRow ? toLeadBrief(briefRow) : null,
      latestEvent: latestEvent
        ? {
            id: String(latestEvent.id),
            eventType: String(latestEvent.event_type),
            priority: String(latestEvent.priority),
            intentScore: Number(latestEvent.intent_score ?? 0),
            createdAt: String(latestEvent.created_at)
          }
        : null,
      verificationLevel: highestVerificationLevel(identityLevelsByCustomer.get(customerId) ?? [])
    };
  });

  items = dedupeLeadPipelineItems(items, {browserKeyByConversationId});
  items = items.filter((item) => !isTechnicalWebNoisePipelineItem({
    conversation: item.conversation,
    brief: item.brief,
    latestEvent: item.latestEvent
  }));

  if (params.q) {
    const q = params.q.toLowerCase().trim();
    items = items.filter((item) => {
      const haystack = [
        item.customer.fullName,
        item.customer.company,
        item.brief?.serviceType,
        item.brief?.primaryGoal,
        item.brief?.firstDeliverable
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  const readFilter = params.readFilter ?? 'all';
  if (readFilter === 'personal_unread') {
    items = items.filter((item) => item.conversation.personalUnread);
  } else if (readFilter === 'personal_read') {
    items = items.filter((item) => !item.conversation.personalUnread);
  }

  const sort = params.sort ?? 'unread_first';
  if (sort === 'unread_first') {
    items.sort((a, b) => {
      if (a.conversation.personalUnread !== b.conversation.personalUnread) {
        return a.conversation.personalUnread ? -1 : 1;
      }
      return compareTimestampsDesc(a.conversation.updatedAt, b.conversation.updatedAt);
    });
  } else {
    items.sort((a, b) => compareTimestampsDesc(a.conversation.updatedAt, b.conversation.updatedAt));
  }

  return items;
}

export async function saveLeadEvent(params: {
  conversationId: string;
  customerId: string;
  eventType: LeadEventType;
  priority: LeadPriority;
  intentScore: number;
  payload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('lead_events').insert({
    conversation_id: params.conversationId,
    customer_id: params.customerId,
    event_type: params.eventType,
    priority: params.priority,
    intent_score: params.intentScore,
    payload: params.payload ?? {}
  });

  if (error) {
    throw new Error(`Unable to save lead event: ${error.message}`);
  }
}

export async function updateConversationStatus(params: {
  conversationId: string;
  status: ConversationStatus;
  leadIntentScore?: number;
  assignedManagerId?: string | null;
}) {
  const supabase = getSupabaseAdminClient();
  const patch: Record<string, unknown> = {status: params.status};
  if (typeof params.leadIntentScore === 'number') {
    patch.lead_intent_score = params.leadIntentScore;
  }
  if (params.assignedManagerId !== undefined) {
    patch.assigned_manager_id = params.assignedManagerId;
  }

  const {error} = await supabase.from('conversations').update(patch).eq('id', params.conversationId);
  if (error) {
    throw new Error(`Unable to update conversation status: ${error.message}`);
  }
}

export async function markWebhookProcessed(params: {
  channel: Channel;
  platformMessageId: string;
  checksum?: string;
}): Promise<boolean> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('webhook_idempotency')
    .select('id')
    .eq('channel', params.channel)
    .eq('platform_message_id', params.platformMessageId)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to read webhook idempotency: ${error.message}`);
  }

  if (data?.id) {
    return false;
  }

  const insert = await supabase.from('webhook_idempotency').insert({
    channel: params.channel,
    platform_message_id: params.platformMessageId,
    checksum: params.checksum ?? null
  });

  if (insert.error) {
    throw new Error(`Unable to mark webhook as processed: ${insert.error.message}`);
  }

  return true;
}

export async function appendDeadLetter(params: {
  channel: Channel;
  platformMessageId: string;
  payload: Record<string, unknown>;
  errorMessage: string;
}) {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('dead_letter_events').insert({
    channel: params.channel,
    platform_message_id: params.platformMessageId,
    payload: params.payload,
    error_message: params.errorMessage
  });

  if (error) {
    throw new Error(`Unable to persist dead-letter event: ${error.message}`);
  }
}

export async function listDeadLetters(params: {resolved?: boolean; limit: number}) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('dead_letter_events')
    .select('id, channel, platform_message_id, payload, error_message, attempts, resolved, created_at')
    .order('created_at', {ascending: false})
    .limit(Math.max(1, Math.min(500, params.limit)));

  if (typeof params.resolved === 'boolean') {
    query = query.eq('resolved', params.resolved);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(`Unable to list dead letters: ${error.message}`);
  }

  return (data ?? []) as DeadLetterRow[];
}

export async function getDeadLetterById(id: string): Promise<DeadLetterRow | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase
    .from('dead_letter_events')
    .select('id, channel, platform_message_id, payload, error_message, attempts, resolved, created_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    throw new Error(`Unable to get dead letter: ${error.message}`);
  }
  return (data as DeadLetterRow | null) ?? null;
}

export async function updateDeadLetter(params: {
  id: string;
  resolved?: boolean;
  attempts?: number;
  errorMessage?: string;
}) {
  const supabase = getSupabaseAdminClient();
  const patch: Record<string, unknown> = {};
  if (typeof params.resolved === 'boolean') {
    patch.resolved = params.resolved;
  }
  if (typeof params.attempts === 'number') {
    patch.attempts = params.attempts;
  }
  if (typeof params.errorMessage === 'string') {
    patch.error_message = params.errorMessage;
  }

  const {error} = await supabase.from('dead_letter_events').update(patch).eq('id', params.id);
  if (error) {
    throw new Error(`Unable to update dead letter: ${error.message}`);
  }
}

export async function resolveInboundIdentity(event: InboundEvent): Promise<CustomerIdentityMatchResult> {
  const trustedChannel = isTrustedChannel(event.channel);
  const nowIso = new Date().toISOString();
  const existingIdentity = await findIdentity(event.channel, event.channelUserId);
  const preferredConversationIdRaw = event.metadata?.conversationId;
  const preferredConversationId = typeof preferredConversationIdRaw === 'string' && isUuid(preferredConversationIdRaw)
    ? preferredConversationIdRaw
    : null;
  const preferredConversation = preferredConversationId
    ? await getConversationById(preferredConversationId)
    : null;
  const validPreferredConversation = preferredConversation &&
    preferredConversation.channel === event.channel &&
    preferredConversation.channel_user_id === event.channelUserId &&
    preferredConversation.status !== 'closed'
    ? preferredConversation
    : null;

  if (existingIdentity) {
    const security = getConversationSecurityFromIdentity({
      channel: event.channel,
      identity: existingIdentity
    });
    const conversation = validPreferredConversation ?? await findOpenConversation(event.channel, event.channelUserId);
    const conversationId = conversation?.id ?? (await createConversation({
      customerId: existingIdentity.customer_id,
      channel: event.channel,
      channelUserId: event.channelUserId,
      locale: event.locale,
      identityState: security.identityState,
      memoryAccess: security.memoryAccess,
      pendingCustomerId: existingIdentity.pending_link_customer_id
    }));

    if (existingIdentity.pending_link_customer_id) {
      await updateConversationSecurity({
        conversationId,
        identityState: 'pending_match',
        memoryAccess: 'session_only',
        pendingCustomerId: existingIdentity.pending_link_customer_id
      });

      if (!trustedChannel || event.channel === 'web') {
        return {
          customerId: existingIdentity.customer_id,
          conversationId,
          requiresConfirmation: false,
          confidence: existingIdentity.match_confidence ?? 0.6,
          identityState: 'pending_match',
          memoryAccess: 'session_only',
          pendingCustomerId: existingIdentity.pending_link_customer_id
        };
      }

      if (isConfirmYes(event.text)) {
        await ensureIdentity({
          customerId: existingIdentity.pending_link_customer_id,
          channel: event.channel,
          channelUserId: event.channelUserId,
          username: event.username,
          phone: event.phone,
          email: event.email,
          matchConfidence: 0.95,
          verificationLevel: 'verified_channel',
          verificationSource: `${event.channel}_id`,
          verifiedAt: nowIso,
          pendingCustomerId: null,
          isPrimary: true
        });
        await updateConversationCustomer(conversationId, existingIdentity.pending_link_customer_id);
        await updateConversationSecurity({
          conversationId,
          identityState: 'verified',
          memoryAccess: 'full_customer',
          pendingCustomerId: null
        });
        return {
          customerId: existingIdentity.pending_link_customer_id,
          conversationId,
          requiresConfirmation: false,
          confidence: 0.95,
          identityState: 'verified',
          memoryAccess: 'full_customer',
          pendingCustomerId: null
        };
      }

      if (isConfirmNo(event.text)) {
        await ensureIdentity({
          customerId: existingIdentity.customer_id,
          channel: event.channel,
          channelUserId: event.channelUserId,
          username: event.username,
          phone: event.phone,
          email: event.email,
          matchConfidence: 0.85,
          verificationLevel: trustedChannel ? 'verified_channel' : 'unverified',
          verificationSource: trustedChannel ? `${event.channel}_id` : 'web_claim',
          verifiedAt: trustedChannel ? nowIso : null,
          pendingCustomerId: null,
          isPrimary: true
        });
        const rejectedIdentityState: IdentityState = trustedChannel ? 'verified' : 'unverified';
        const rejectedMemoryAccess: MemoryAccess = trustedChannel ? 'full_customer' : 'session_only';
        await updateConversationSecurity({
          conversationId,
          identityState: rejectedIdentityState,
          memoryAccess: rejectedMemoryAccess,
          pendingCustomerId: null
        });

        return {
          customerId: existingIdentity.customer_id,
          conversationId,
          requiresConfirmation: false,
          confidence: 0.85,
          identityState: rejectedIdentityState,
          memoryAccess: rejectedMemoryAccess,
          pendingCustomerId: null
        };
      }

      return {
        customerId: existingIdentity.customer_id,
        conversationId,
        requiresConfirmation: true,
        confidence: existingIdentity.match_confidence ?? 0.6,
        identityState: 'pending_match',
        memoryAccess: 'session_only',
        pendingCustomerId: existingIdentity.pending_link_customer_id
      };
    }

    const verificationLevel: VerificationLevel = trustedChannel
      ? (existingIdentity.verification_level === 'unverified' ? 'verified_channel' : existingIdentity.verification_level)
      : existingIdentity.verification_level;
    const updatedSecurity = getConversationSecurityFromIdentity({
      channel: event.channel,
      identity: {
        pending_link_customer_id: null,
        verification_level: verificationLevel
      }
    });

    await ensureIdentity({
      customerId: existingIdentity.customer_id,
      channel: event.channel,
      channelUserId: event.channelUserId,
      username: event.username,
      phone: event.phone,
      email: event.email,
      matchConfidence: 1,
      verificationLevel,
      verificationSource: existingIdentity.verification_source ?? (trustedChannel ? `${event.channel}_id` : 'web_claim'),
      verifiedAt: trustedChannel ? (existingIdentity.verified_at ?? nowIso) : existingIdentity.verified_at,
      pendingCustomerId: null,
      isPrimary: existingIdentity.is_primary
    });
    await updateConversationSecurity({
      conversationId,
      identityState: updatedSecurity.identityState,
      memoryAccess: updatedSecurity.memoryAccess,
      pendingCustomerId: null
    });

    return {
      customerId: existingIdentity.customer_id,
      conversationId,
      requiresConfirmation: false,
      confidence: 1,
      identityState: updatedSecurity.identityState,
      memoryAccess: updatedSecurity.memoryAccess,
      pendingCustomerId: null
    };
  }

  const normalizedPhone = normalizePhone(event.phone);
  const normalizedEmail = normalizeEmail(event.email);
  const exactCustomerId = await findCustomerByPhoneOrEmail(normalizedPhone ?? undefined, normalizedEmail ?? undefined);
  const softCandidateId = exactCustomerId ? null : await findSoftCandidateByUsername(event.username);
  const pendingCustomerId = exactCustomerId ?? softCandidateId ?? null;

  const tempCustomerId = await createCustomer({
    locale: event.locale,
    fullName: event.profileName,
    email: normalizedEmail ?? undefined,
    phone: normalizedPhone ?? undefined
  });

  const identityState: IdentityState = pendingCustomerId ? 'pending_match' : (trustedChannel ? 'verified' : 'unverified');
  const memoryAccess: MemoryAccess = pendingCustomerId ? 'session_only' : (trustedChannel ? 'full_customer' : 'session_only');
  const verificationLevel: VerificationLevel = pendingCustomerId
    ? 'unverified'
    : (trustedChannel ? 'verified_channel' : 'unverified');

  await ensureIdentity({
    customerId: tempCustomerId,
    channel: event.channel,
    channelUserId: event.channelUserId,
    username: event.username,
    phone: normalizedPhone ?? undefined,
    email: normalizedEmail ?? undefined,
    matchConfidence: pendingCustomerId ? 0.5 : 0.9,
    pendingCustomerId: pendingCustomerId ?? undefined,
    verificationLevel,
    verificationSource: trustedChannel ? `${event.channel}_id` : 'web_claim',
    verifiedAt: verificationLevel === 'unverified' ? null : nowIso,
    isPrimary: true
  });

  const conversationId = await createConversation({
    customerId: tempCustomerId,
    channel: event.channel,
    channelUserId: event.channelUserId,
    locale: event.locale,
    identityState,
    memoryAccess,
    pendingCustomerId
  });

  return {
    customerId: tempCustomerId,
    conversationId,
    requiresConfirmation: Boolean(pendingCustomerId && trustedChannel),
    confidence: pendingCustomerId ? 0.5 : 0.9,
    identityState,
    memoryAccess,
    pendingCustomerId
  };
}

export async function touchCustomerContacts(params: {
  customerId: string;
  fullName?: string;
  company?: string;
  phone?: string;
  email?: string;
  locale?: Locale;
}) {
  const supabase = getSupabaseAdminClient();
  const current = await supabase
    .from('customers')
    .select('id, full_name, company, locale_pref, phones, emails')
    .eq('id', params.customerId)
    .single();

  if (current.error || !current.data) {
    throw new Error(`Unable to load customer: ${current.error?.message ?? 'missing record'}`);
  }

  const row = current.data as CustomerRow;
  const phones = new Set(row.phones ?? []);
  const emails = new Set(row.emails ?? []);
  if (params.phone) {
    phones.add(params.phone);
  }
  if (params.email) {
    emails.add(params.email);
  }

  const update = await supabase.from('customers').update({
    full_name: params.fullName ?? row.full_name,
    company: params.company ?? row.company,
    locale_pref: params.locale ?? row.locale_pref,
    phones: Array.from(phones),
    emails: Array.from(emails)
  }).eq('id', params.customerId);

  if (update.error) {
    throw new Error(`Unable to update customer contacts: ${update.error.message}`);
  }
}

export async function listConversations(filters: {
  status?: ConversationStatus;
  channel?: Channel;
  limit: number;
}) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('conversations')
    .select('id, customer_id, channel, channel_user_id, status, lead_intent_score, locale, source, assigned_manager_id, identity_state, memory_access, pending_customer_id, last_inbound_message_at, updated_at, created_at')
    .order('updated_at', {ascending: false})
    .limit(filters.limit);

  if (filters.status) {
    query = query.eq('status', filters.status);
  }
  if (filters.channel) {
    query = query.eq('channel', filters.channel);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(`Unable to list conversations: ${error.message}`);
  }
  return data ?? [];
}

export async function listConversationMessages(conversationId: string, limit: number) {
  return getConversationMessages(conversationId, limit);
}

export async function cleanupUnknownAndOpenWebConversations(params: {
  mode: 'close' | 'delete';
  performedByUserId: string;
  performedByRole: 'owner' | 'manager' | 'viewer';
}) {
  void params.performedByUserId;
  if (params.performedByRole !== 'owner' && params.performedByRole !== 'manager') {
    throw new Error('Unauthorized cleanup role');
  }
  if (params.mode === 'delete' && params.performedByRole !== 'owner') {
    throw new Error('Only owner can run hard delete cleanup');
  }

  const supabase = getSupabaseAdminClient();
  const conversationsRes = await supabase
    .from('conversations')
    .select('id, customer_id, status, channel')
    .eq('channel', 'web')
    .neq('status', 'closed')
    .limit(2000);
  if (conversationsRes.error) {
    throw new Error(`Unable to load conversations for cleanup: ${conversationsRes.error.message}`);
  }

  const conversations = (conversationsRes.data ?? []) as Array<{
    id: string;
    customer_id: string;
    status: ConversationStatus;
    channel: Channel;
  }>;
  if (!conversations.length) {
    return {
      mode: params.mode,
      matched: 0,
      openMatched: 0,
      unknownMatched: 0,
      affected: 0
    };
  }

  const customerIds = Array.from(new Set(conversations.map((row) => row.customer_id)));
  const customersRes = customerIds.length
    ? await supabase
        .from('customers')
        .select('id, full_name')
        .in('id', customerIds)
    : {data: [], error: null};
  if (customersRes.error) {
    throw new Error(`Unable to load customers for cleanup: ${customersRes.error.message}`);
  }
  const customerNameById = new Map(
    ((customersRes.data ?? []) as Array<{id: string; full_name: string | null}>)
      .map((row) => [row.id, row.full_name ?? null])
  );

  const targets = conversations.filter((conversation) => {
    const isOpenStatus = conversation.status === 'open';
    const isUnknown = isUnknownCustomerName(customerNameById.get(conversation.customer_id) ?? null);
    return isOpenStatus || isUnknown;
  });
  if (!targets.length) {
    return {
      mode: params.mode,
      matched: 0,
      openMatched: 0,
      unknownMatched: 0,
      affected: 0
    };
  }

  const targetIds = targets.map((row) => row.id);
  const openMatched = targets.filter((row) => row.status === 'open').length;
  const unknownMatched = targets.filter((row) => isUnknownCustomerName(customerNameById.get(row.customer_id) ?? null)).length;

  if (params.mode === 'close') {
    const closeRes = await supabase
      .from('conversations')
      .update({status: 'closed', pending_customer_id: null})
      .in('id', targetIds);
    if (closeRes.error) {
      throw new Error(`Unable to close conversations during cleanup: ${closeRes.error.message}`);
    }
    return {
      mode: params.mode,
      matched: targets.length,
      openMatched,
      unknownMatched,
      affected: targets.length
    };
  }

  const briefIdsRes = await supabase
    .from('lead_briefs')
    .select('id')
    .in('conversation_id', targetIds);
  if (briefIdsRes.error && !isMissingTableError(briefIdsRes.error.message, 'lead_briefs')) {
    throw new Error(`Unable to fetch lead briefs for cleanup delete: ${briefIdsRes.error.message}`);
  }
  const briefIds = ((briefIdsRes.data ?? []) as Array<{id: string}>).map((row) => row.id);

  if (briefIds.length) {
    const briefRevisionsDelete = await supabase
      .from('lead_brief_revisions')
      .delete()
      .in('lead_brief_id', briefIds);
    if (briefRevisionsDelete.error && !isMissingTableError(briefRevisionsDelete.error.message, 'lead_brief_revisions')) {
      throw new Error(`Unable to delete lead brief revisions during cleanup: ${briefRevisionsDelete.error.message}`);
    }
  }

  const deletions = [
    supabase.from('admin_conversation_reads').delete().in('conversation_id', targetIds),
    supabase.from('identity_claims').delete().in('conversation_id', targetIds),
    supabase.from('messages').delete().in('conversation_id', targetIds),
    supabase.from('communications').delete().in('conversation_id', targetIds),
    supabase.from('lead_events').delete().in('conversation_id', targetIds),
    supabase.from('lead_briefs').delete().in('conversation_id', targetIds),
    supabase.from('conversations').delete().in('id', targetIds)
  ] as const;

  const [readsDel, claimsDel, messagesDel, commsDel, eventsDel, briefsDel, conversationsDel] = await Promise.all(deletions);
  const tableErrors: Array<{label: string; message: string}> = [];
  if (readsDel.error && !isMissingTableError(readsDel.error.message, 'admin_conversation_reads')) {
    tableErrors.push({label: 'admin_conversation_reads', message: readsDel.error.message});
  }
  if (claimsDel.error && !isMissingTableError(claimsDel.error.message, 'identity_claims')) {
    tableErrors.push({label: 'identity_claims', message: claimsDel.error.message});
  }
  if (messagesDel.error) {
    tableErrors.push({label: 'messages', message: messagesDel.error.message});
  }
  if (commsDel.error) {
    tableErrors.push({label: 'communications', message: commsDel.error.message});
  }
  if (eventsDel.error) {
    tableErrors.push({label: 'lead_events', message: eventsDel.error.message});
  }
  if (briefsDel.error && !isMissingTableError(briefsDel.error.message, 'lead_briefs')) {
    tableErrors.push({label: 'lead_briefs', message: briefsDel.error.message});
  }
  if (conversationsDel.error) {
    tableErrors.push({label: 'conversations', message: conversationsDel.error.message});
  }
  if (tableErrors.length) {
    throw new Error(`Cleanup delete failed: ${tableErrors.map((item) => `${item.label}: ${item.message}`).join('; ')}`);
  }

  return {
    mode: params.mode,
    matched: targets.length,
    openMatched,
    unknownMatched,
    affected: targets.length
  };
}

export async function listLeadEvents(filters: {priority?: LeadPriority; status?: LeadEventType; limit: number}) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('lead_events')
    .select('id, conversation_id, customer_id, event_type, priority, intent_score, payload, created_at')
    .order('created_at', {ascending: false})
    .limit(filters.limit);

  if (filters.priority) {
    query = query.eq('priority', filters.priority);
  }
  if (filters.status) {
    query = query.eq('event_type', filters.status);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(`Unable to list lead events: ${error.message}`);
  }
  return data ?? [];
}

export async function listLeadOutcomes(filters: {
  outcome?: 'won' | 'lost';
  q?: string;
  limit: number;
}) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('lead_events')
    .select('id, conversation_id, customer_id, event_type, priority, intent_score, payload, created_at')
    .in('event_type', ['won', 'lost'])
    .order('created_at', {ascending: false})
    .limit(Math.max(1, Math.min(filters.limit, 500)));

  if (filters.outcome) {
    query = query.eq('event_type', filters.outcome);
  }

  const eventsRes = await query;
  if (eventsRes.error) {
    throw new Error(`Unable to list lead outcomes: ${eventsRes.error.message}`);
  }

  const events = (eventsRes.data ?? []) as Array<Record<string, unknown>>;
  const conversationIds = Array.from(new Set(events.map((row) => String(row.conversation_id))));
  const customerIds = Array.from(new Set(events.map((row) => String(row.customer_id))));

  const [conversationRes, customerRes, briefRes] = await Promise.all([
    conversationIds.length
      ? supabase
          .from('conversations')
          .select('id, channel, status, lead_intent_score, updated_at, created_at')
          .in('id', conversationIds)
      : Promise.resolve({data: [], error: null}),
    customerIds.length
      ? supabase
          .from('customers')
          .select('id, full_name, company, emails, phones')
          .in('id', customerIds)
      : Promise.resolve({data: [], error: null}),
    conversationIds.length
      ? supabase
          .from('lead_briefs')
          .select('*')
          .in('conversation_id', conversationIds)
      : Promise.resolve({data: [], error: null})
  ]);

  if (conversationRes.error) {
    throw new Error(`Unable to fetch outcome conversations: ${conversationRes.error.message}`);
  }
  if (customerRes.error) {
    throw new Error(`Unable to fetch outcome customers: ${customerRes.error.message}`);
  }
  if (briefRes.error && !isMissingTableError(briefRes.error.message, 'lead_briefs')) {
    throw new Error(`Unable to fetch outcome briefs: ${briefRes.error.message}`);
  }

  const conversationsById = new Map<string, Record<string, unknown>>(
    ((conversationRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );
  const customersById = new Map<string, Record<string, unknown>>(
    ((customerRes.data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.id), row])
  );
  const briefsByConversation = new Map<string, LeadBriefRow>(
    ((briefRes.data ?? []) as LeadBriefRow[]).map((row) => [row.conversation_id, row])
  );

  let items = events.map((event) => {
    const conversationId = String(event.conversation_id);
    const customerId = String(event.customer_id);
    const conversation = conversationsById.get(conversationId);
    const customer = customersById.get(customerId);
    const brief = briefsByConversation.get(conversationId);

    return {
      outcome: String(event.event_type) as 'won' | 'lost',
      event: {
        id: String(event.id),
        createdAt: String(event.created_at),
        priority: String(event.priority),
        intentScore: Number(event.intent_score ?? 0)
      },
      conversation: {
        id: conversationId,
        channel: conversation?.channel ? String(conversation.channel) : 'web',
        status: conversation?.status ? String(conversation.status) : 'closed',
        leadIntentScore: Number(conversation?.lead_intent_score ?? 0),
        updatedAt: conversation?.updated_at ? String(conversation.updated_at) : String(event.created_at)
      },
      customer: {
        id: customerId,
        fullName: customer?.full_name ? String(customer.full_name) : null,
        company: customer?.company ? String(customer.company) : null,
        emails: (customer?.emails as string[] | undefined) ?? [],
        phones: (customer?.phones as string[] | undefined) ?? []
      },
      brief: brief ? toLeadBrief(brief) : null
    };
  });

  if (filters.q) {
    const q = filters.q.trim().toLowerCase();
    items = items.filter((item) => {
      const haystack = [
        item.customer.fullName,
        item.customer.company,
        item.brief?.serviceType,
        item.brief?.primaryGoal,
        item.brief?.firstDeliverable
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }

  return items;
}

export async function getCustomerContext(customerId: string, viewerUserId?: string | null) {
  const supabase = getSupabaseAdminClient();

  const [customerRes, identityRes, memoryRes, conversationRes, leadRes, briefRes, claimsRes, mergeRes] = await Promise.all([
    supabase.from('customers').select('*').eq('id', customerId).maybeSingle(),
    supabase.from('customer_identities').select('*').eq('customer_id', customerId).order('last_seen_at', {ascending: false}),
    supabase.from('memory_snapshots').select('*').eq('customer_id', customerId).maybeSingle(),
    supabase.from('conversations').select('*').eq('customer_id', customerId).order('updated_at', {ascending: false}).limit(200),
    supabase.from('lead_events').select('*').eq('customer_id', customerId).order('created_at', {ascending: false}).limit(50),
    supabase.from('lead_briefs').select('*').eq('customer_id', customerId).order('updated_at', {ascending: false}).limit(10),
    supabase
      .from('identity_claims')
      .select('*')
      .or(`customer_id.eq.${customerId},matched_customer_id.eq.${customerId}`)
      .order('updated_at', {ascending: false})
      .limit(200),
    supabase
      .from('customer_merge_audit')
      .select('*')
      .or(`from_customer_id.eq.${customerId},to_customer_id.eq.${customerId}`)
      .order('created_at', {ascending: false})
      .limit(100)
  ]);

  if (customerRes.error) {
    throw new Error(`Unable to fetch customer context: ${customerRes.error.message}`);
  }
  if (claimsRes.error && !isMissingTableError(claimsRes.error.message, 'identity_claims')) {
    throw new Error(`Unable to fetch identity claims: ${claimsRes.error.message}`);
  }
  if (mergeRes.error && !isMissingTableError(mergeRes.error.message, 'customer_merge_audit')) {
    throw new Error(`Unable to fetch merge audit: ${mergeRes.error.message}`);
  }

  const customer = customerRes.data as (Record<string, unknown> | null);
  const identities = (identityRes.data ?? []) as Array<Record<string, unknown>>;
  const brief = ((briefRes.data ?? [])[0] ?? null) as LeadBriefRow | null;
  const claims = claimsRes.error && isMissingTableError(claimsRes.error.message, 'identity_claims')
    ? []
    : ((claimsRes.data ?? []) as Array<Record<string, unknown>>);
  const mergeAudit = mergeRes.error && isMissingTableError(mergeRes.error.message, 'customer_merge_audit')
    ? []
    : ((mergeRes.data ?? []) as Array<Record<string, unknown>>);
  const allEmails = Array.from(
    new Set([...(Array.isArray(customer?.emails) ? (customer?.emails as string[]) : []), ...identities.map((it) => String(it.email ?? '')).filter(Boolean)])
  );
  const allPhones = Array.from(
    new Set([...(Array.isArray(customer?.phones) ? (customer?.phones as string[]) : []), ...identities.map((it) => String(it.phone ?? '')).filter(Boolean)])
  );
  const capturedEmails = claims
    .filter((row) => row.claim_type === 'email' && row.claim_status !== 'verified')
    .map((row) => String(row.normalized_value ?? row.claim_value ?? ''))
    .filter(Boolean);
  const capturedPhones = claims
    .filter((row) => row.claim_type === 'phone' && row.claim_status !== 'verified')
    .map((row) => String(row.normalized_value ?? row.claim_value ?? ''))
    .filter(Boolean);
  const capturedTelegram = claims
    .filter((row) => row.claim_type === 'telegram_handle' && row.claim_status !== 'verified')
    .map((row) => String(row.normalized_value ?? row.claim_value ?? ''))
    .filter(Boolean);
  const verifiedEmails = claims
    .filter((row) => row.claim_type === 'email' && row.claim_status === 'verified')
    .map((row) => String(row.normalized_value ?? row.claim_value ?? ''))
    .filter(Boolean);
  const verifiedPhones = claims
    .filter((row) => row.claim_type === 'phone' && row.claim_status === 'verified')
    .map((row) => String(row.normalized_value ?? row.claim_value ?? ''))
    .filter(Boolean);
  const verifiedTelegram = claims
    .filter((row) => row.claim_type === 'telegram_handle' && row.claim_status === 'verified')
    .map((row) => String(row.normalized_value ?? row.claim_value ?? ''))
    .filter(Boolean);
  const identityVerification = identities.map((it) => ({
    id: String(it.id),
    channel: String(it.channel ?? ''),
    channelUserId: String(it.channel_user_id ?? ''),
    verificationLevel: String(it.verification_level ?? 'unverified'),
    verificationSource: it.verification_source ? String(it.verification_source) : null,
    verifiedAt: it.verified_at ? String(it.verified_at) : null,
    pendingLinkCustomerId: it.pending_link_customer_id ? String(it.pending_link_customer_id) : null,
    matchConfidence: typeof it.match_confidence === 'number' ? Number(it.match_confidence) : null,
    lastSeenAt: it.last_seen_at ? String(it.last_seen_at) : null
  }));
  const highestVerification = highestVerificationLevel(
    identityVerification.map((it) => it.verificationLevel as VerificationLevel)
  );
  const conversations = (conversationRes.data ?? []) as Array<Record<string, unknown>>;
  const technicalSignals = aggregateTechnicalSignals(
    conversations.map((row) => ({
      metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata)
        ? (row.metadata as Record<string, unknown>)
        : null
    }))
  );
  const conversationIds = conversations.map((row) => String(row.id));
  const readState = await getConversationReadState({
    conversationIds,
    adminUserId: viewerUserId ?? null
  });
  const readStateSummary = conversations.reduce<{personalUnread: number; globalUnread: number}>(
    (acc, row) => {
      const conversationId = String(row.id);
      const inboundAt = row.last_inbound_message_at ? String(row.last_inbound_message_at) : null;
      if (!inboundAt) {
        return acc;
      }
      const read = readState.get(conversationId) ?? {personalLastReadAt: null, globalLastReadAt: null};
      if (!read.personalLastReadAt || isBefore(read.personalLastReadAt, inboundAt)) {
        acc.personalUnread += 1;
      }
      if (!read.globalLastReadAt || isBefore(read.globalLastReadAt, inboundAt)) {
        acc.globalUnread += 1;
      }
      return acc;
    },
    {personalUnread: 0, globalUnread: 0}
  );

  return {
    customer: customer ?? null,
    identities,
    memory: memoryRes.data ?? null,
    conversations,
    leadEvents: leadRes.data ?? [],
    leadBrief: brief ? toLeadBrief(brief) : null,
    contacts: {
      primaryEmail: normalizeEmail(brief?.email ?? null) ?? (allEmails[0] ?? null),
      primaryPhone: normalizePhone(brief?.phone ?? null) ?? (allPhones[0] ?? null),
      allEmails,
      allPhones
    },
    contactsCaptured: {
      emails: Array.from(new Set(capturedEmails)),
      phones: Array.from(new Set(capturedPhones)),
      telegramHandles: Array.from(new Set(capturedTelegram))
    },
    contactsVerified: {
      emails: Array.from(new Set([...allEmails, ...verifiedEmails])),
      phones: Array.from(new Set([...allPhones, ...verifiedPhones])),
      telegramHandles: Array.from(new Set(verifiedTelegram))
    },
    identityVerification: {
      highestVerification,
      items: identityVerification
    },
    readStateSummary,
    technicalSignals,
    claims,
    mergeAudit
  };
}

export async function setConversationIdentitySecurity(params: {
  conversationId: string;
  identityState: IdentityState;
  memoryAccess: MemoryAccess;
  pendingCustomerId?: string | null;
}) {
  await updateConversationSecurity(params);
}

export async function setConversationPendingMatch(params: {
  conversationId: string;
  pendingCustomerId: string;
  channel: Channel;
  channelUserId?: string | null;
  customerId: string;
}) {
  await updateConversationSecurity({
    conversationId: params.conversationId,
    identityState: 'pending_match',
    memoryAccess: 'session_only',
    pendingCustomerId: params.pendingCustomerId
  });
  if (params.channelUserId) {
    const existing = await findIdentity(params.channel, params.channelUserId);
    await ensureIdentity({
      customerId: params.customerId,
      channel: params.channel,
      channelUserId: params.channelUserId,
      username: existing?.username ?? undefined,
      phone: existing?.phone ?? undefined,
      email: existing?.email ?? undefined,
      matchConfidence: existing?.match_confidence ?? 0.5,
      pendingCustomerId: params.pendingCustomerId,
      verificationLevel: existing?.verification_level ?? (isTrustedChannel(params.channel) ? 'verified_channel' : 'unverified'),
      verificationSource: existing?.verification_source ?? (isTrustedChannel(params.channel) ? `${params.channel}_id` : 'web_claim'),
      verifiedAt: existing?.verified_at ?? (isTrustedChannel(params.channel) ? new Date().toISOString() : null),
      isPrimary: existing?.is_primary ?? true
    });
  }
}

function pickInformativeText(primary?: string | null, secondary?: string | null, minSecondaryAdvantage = 8): string | null {
  const preferred = clean(primary);
  const candidate = clean(secondary);
  if (!preferred) {
    return candidate;
  }
  if (!candidate) {
    return preferred;
  }
  if (preferred === candidate) {
    return preferred;
  }
  if (candidate.length >= preferred.length + minSecondaryAdvantage) {
    return candidate;
  }
  return preferred;
}

function mergeLeadBriefDraft(params: {
  target: LeadBrief;
  source: LeadBrief;
}) {
  return {
    fullName: pickInformativeText(params.target.fullName, params.source.fullName, 4),
    email: params.target.email ?? params.source.email ?? null,
    phone: params.target.phone ?? params.source.phone ?? null,
    telegramHandle: params.target.telegramHandle ?? params.source.telegramHandle ?? null,
    serviceType: pickInformativeText(params.target.serviceType, params.source.serviceType, 2),
    primaryGoal: pickInformativeText(params.target.primaryGoal, params.source.primaryGoal, 12),
    firstDeliverable: pickInformativeText(params.target.firstDeliverable, params.source.firstDeliverable, 12),
    timelineHint: pickInformativeText(params.target.timelineHint, params.source.timelineHint, 8),
    budgetHint: pickInformativeText(params.target.budgetHint, params.source.budgetHint, 8),
    referralSource: pickInformativeText(params.target.referralSource, params.source.referralSource, 6),
    constraints: pickInformativeText(params.target.constraints, params.source.constraints, 10)
  };
}

async function mergeLeadBriefsBetweenConversations(params: {
  fromConversationId: string;
  toConversationId: string;
  customerId: string;
}) {
  const [fromBrief, toBrief] = await Promise.all([
    getLeadBriefByConversation(params.fromConversationId),
    getLeadBriefByConversation(params.toConversationId)
  ]);

  if (!fromBrief) {
    return;
  }

  const supabase = getSupabaseAdminClient();

  if (!toBrief) {
    const {error} = await supabase
      .from('lead_briefs')
      .update({
        conversation_id: params.toConversationId,
        customer_id: params.customerId,
        updated_by: 'system'
      })
      .eq('id', fromBrief.id);
    if (error && !isMissingTableError(error.message, 'lead_briefs')) {
      throw new Error(`Unable to move lead brief to canonical conversation: ${error.message}`);
    }
    return;
  }

  const mergedDraft = mergeLeadBriefDraft({target: toBrief, source: fromBrief});
  const mergedComputed = computeLeadBriefState(mergedDraft, {highIntent: false});
  const mergedStatus: LeadBriefStatus = (toBrief.status === 'handoff' || fromBrief.status === 'handoff')
    ? 'handoff'
    : mergedComputed.status;

  const mergedBrief = await upsertLeadBrief({
    conversationId: params.toConversationId,
    customerId: params.customerId,
    sourceChannel: toBrief.sourceChannel ?? fromBrief.sourceChannel ?? 'web',
    updatedBy: 'system',
    status: mergedStatus,
    missingFields: mergedComputed.missingFields,
    completenessScore: mergedComputed.completenessScore,
    patch: mergedDraft
  });

  const fieldsToCompare: Array<keyof LeadBrief> = [
    'status',
    'fullName',
    'email',
    'phone',
    'telegramHandle',
    'serviceType',
    'primaryGoal',
    'firstDeliverable',
    'timelineHint',
    'budgetHint',
    'referralSource',
    'constraints',
    'completenessScore',
    'missingFields'
  ];
  const targetChanged = fieldsToCompare.some((field) => JSON.stringify(toBrief[field]) !== JSON.stringify(mergedBrief[field]));
  if (targetChanged) {
    await appendLeadBriefRevision({
      leadBriefId: mergedBrief.id,
      changedByType: 'system',
      beforeState: {brief: toBrief},
      afterState: {brief: mergedBrief},
      note: 'Auto merge from duplicate web conversation'
    });
  }

  const revisionsTransfer = await supabase
    .from('lead_brief_revisions')
    .update({lead_brief_id: mergedBrief.id})
    .eq('lead_brief_id', fromBrief.id);
  if (revisionsTransfer.error && !isMissingTableError(revisionsTransfer.error.message, 'lead_brief_revisions')) {
    throw new Error(`Unable to transfer lead brief revisions: ${revisionsTransfer.error.message}`);
  }

  const briefDelete = await supabase
    .from('lead_briefs')
    .delete()
    .eq('id', fromBrief.id);
  if (briefDelete.error && !isMissingTableError(briefDelete.error.message, 'lead_briefs')) {
    throw new Error(`Unable to delete duplicate lead brief: ${briefDelete.error.message}`);
  }
}

async function mergeCustomerMemory(fromCustomerId: string, toCustomerId: string) {
  const supabase = getSupabaseAdminClient();
  const [fromRes, toRes] = await Promise.all([
    supabase
      .from('memory_snapshots')
      .select('customer_id, summary, open_needs, budget_hint, timeline_hint, service_interest, last_updated_at')
      .eq('customer_id', fromCustomerId)
      .maybeSingle(),
    supabase
      .from('memory_snapshots')
      .select('customer_id, summary, open_needs, budget_hint, timeline_hint, service_interest, last_updated_at')
      .eq('customer_id', toCustomerId)
      .maybeSingle()
  ]);

  const fromMemory = fromRes.data;
  const toMemory = toRes.data;
  if (!fromMemory && !toMemory) {
    return;
  }

  const summary = [toMemory?.summary, fromMemory?.summary].filter(Boolean).join(' | ').slice(0, 1500);
  const openNeeds = Array.from(
    new Set([
      ...((toMemory?.open_needs as string[] | undefined) ?? []),
      ...((fromMemory?.open_needs as string[] | undefined) ?? [])
    ])
  );
  const serviceInterest = Array.from(
    new Set([
      ...((toMemory?.service_interest as string[] | undefined) ?? []),
      ...((fromMemory?.service_interest as string[] | undefined) ?? [])
    ])
  );

  await upsertMemorySnapshot({
    customerId: toCustomerId,
    summary,
    openNeeds,
    budgetHint: (toMemory?.budget_hint as string | null | undefined) ?? (fromMemory?.budget_hint as string | null | undefined) ?? null,
    timelineHint: (toMemory?.timeline_hint as string | null | undefined) ?? (fromMemory?.timeline_hint as string | null | undefined) ?? null,
    serviceInterest
  });

  if (fromMemory) {
    await supabase.from('memory_snapshots').delete().eq('customer_id', fromCustomerId);
  }
}

export async function mergeCustomers(params: {
  fromCustomerId: string;
  toCustomerId: string;
  reason: string;
  triggerChannel: Channel;
  triggerConversationId?: string | null;
  performedBy: 'system' | 'manager';
}) {
  if (params.fromCustomerId === params.toCustomerId) {
    return;
  }

  const supabase = getSupabaseAdminClient();
  const [fromCustomerRes, toCustomerRes, fromIdentityRes, toIdentityRes] = await Promise.all([
    supabase.from('customers').select('id, full_name, company, locale_pref, phones, emails').eq('id', params.fromCustomerId).maybeSingle(),
    supabase.from('customers').select('id, full_name, company, locale_pref, phones, emails').eq('id', params.toCustomerId).maybeSingle(),
    supabase.from('customer_identities').select('*').eq('customer_id', params.fromCustomerId),
    supabase.from('customer_identities').select('*').eq('customer_id', params.toCustomerId)
  ]);

  if (!fromCustomerRes.data || !toCustomerRes.data) {
    throw new Error('Unable to merge customers: source or target customer not found');
  }

  const fromCustomer = fromCustomerRes.data as CustomerRow;
  const toCustomer = toCustomerRes.data as CustomerRow;
  const phones = Array.from(new Set([...(toCustomer.phones ?? []), ...(fromCustomer.phones ?? [])]));
  const emails = Array.from(new Set([...(toCustomer.emails ?? []), ...(fromCustomer.emails ?? [])]));

  const customerPatch = await supabase.from('customers').update({
    full_name: toCustomer.full_name ?? fromCustomer.full_name,
    company: toCustomer.company ?? fromCustomer.company,
    locale_pref: toCustomer.locale_pref ?? fromCustomer.locale_pref,
    phones,
    emails
  }).eq('id', params.toCustomerId);
  if (customerPatch.error) {
    throw new Error(`Unable to merge customer profile: ${customerPatch.error.message}`);
  }

  const toIdentities = (toIdentityRes.data ?? []) as IdentityRow[];
  const toIdentityKey = new Set(toIdentities.map((item) => `${item.channel}:${item.channel_user_id}`));
  for (const row of (fromIdentityRes.data ?? []) as IdentityRow[]) {
    const key = `${row.channel}:${row.channel_user_id}`;
    const verificationLevel = highestVerificationLevel([row.verification_level]);
    if (!toIdentityKey.has(key)) {
      await ensureIdentity({
        customerId: params.toCustomerId,
        channel: row.channel,
        channelUserId: row.channel_user_id,
        username: row.username ?? undefined,
        phone: row.phone ?? undefined,
        email: row.email ?? undefined,
        matchConfidence: row.match_confidence ?? 1,
        pendingCustomerId: null,
        verificationLevel,
        verificationSource: row.verification_source,
        verifiedAt: row.verified_at,
        isPrimary: row.is_primary
      });
    }
    await supabase.from('customer_identities').delete().eq('id', row.id);
  }

  const tablesToReassign = [
    'conversations',
    'lead_events',
    'lead_briefs',
    'communications'
  ] as const;
  for (const table of tablesToReassign) {
    const patch = await supabase.from(table).update({customer_id: params.toCustomerId}).eq('customer_id', params.fromCustomerId);
    if (patch.error) {
      throw new Error(`Unable to reassign ${table}: ${patch.error.message}`);
    }
  }

  await mergeCustomerMemory(params.fromCustomerId, params.toCustomerId);

  await supabase
    .from('identity_claims')
    .update({customer_id: params.toCustomerId})
    .eq('customer_id', params.fromCustomerId);
  await supabase
    .from('identity_claims')
    .update({matched_customer_id: params.toCustomerId})
    .eq('matched_customer_id', params.fromCustomerId);

  const audit = await supabase.from('customer_merge_audit').insert({
    from_customer_id: params.fromCustomerId,
    to_customer_id: params.toCustomerId,
    reason: params.reason,
    trigger_channel: params.triggerChannel,
    trigger_conversation_id: params.triggerConversationId ?? null,
    performed_by: params.performedBy
  });
  if (audit.error && !isMissingTableError(audit.error.message, 'customer_merge_audit')) {
    throw new Error(`Unable to write merge audit: ${audit.error.message}`);
  }

  await supabase.from('customers').delete().eq('id', params.fromCustomerId);
}

export async function mergeWebConversationsIntoTarget(params: {
  fromConversationId: string;
  toConversationId: string;
  reason: string;
  performedBy?: 'system' | 'manager';
}) {
  if (params.fromConversationId === params.toConversationId) {
    return {merged: false, toConversationId: params.toConversationId};
  }

  const [fromConversationRaw, toConversationRaw] = await Promise.all([
    getConversationById(params.fromConversationId),
    getConversationById(params.toConversationId)
  ]);

  if (!fromConversationRaw || !toConversationRaw) {
    throw new Error('Unable to merge web conversations: source or target conversation not found');
  }
  if (fromConversationRaw.channel !== 'web' || toConversationRaw.channel !== 'web') {
    throw new Error('Unable to merge web conversations: only web channel is supported');
  }
  if (fromConversationRaw.status === 'closed') {
    return {merged: false, toConversationId: params.toConversationId};
  }

  if (fromConversationRaw.customer_id !== toConversationRaw.customer_id) {
    await mergeCustomers({
      fromCustomerId: fromConversationRaw.customer_id,
      toCustomerId: toConversationRaw.customer_id,
      reason: params.reason,
      triggerChannel: 'web',
      triggerConversationId: params.fromConversationId,
      performedBy: params.performedBy ?? 'system'
    });
  }

  const [fromConversation, toConversation] = await Promise.all([
    getConversationById(params.fromConversationId),
    getConversationById(params.toConversationId)
  ]);
  if (!fromConversation || !toConversation) {
    throw new Error('Unable to merge web conversations: missing conversation after customer merge');
  }

  const supabase = getSupabaseAdminClient();
  const tablesToMove = ['messages', 'communications', 'lead_events'] as const;
  for (const table of tablesToMove) {
    const {error} = await supabase
      .from(table)
      .update({conversation_id: params.toConversationId})
      .eq('conversation_id', params.fromConversationId);
    if (error) {
      throw new Error(`Unable to reassign ${table} while merging web conversations: ${error.message}`);
    }
  }

  const identityClaimsMove = await supabase
    .from('identity_claims')
    .update({conversation_id: params.toConversationId, customer_id: toConversation.customer_id})
    .eq('conversation_id', params.fromConversationId);
  if (identityClaimsMove.error && !isMissingTableError(identityClaimsMove.error.message, 'identity_claims')) {
    throw new Error(`Unable to reassign identity claims while merging web conversations: ${identityClaimsMove.error.message}`);
  }

  await mergeLeadBriefsBetweenConversations({
    fromConversationId: params.fromConversationId,
    toConversationId: params.toConversationId,
    customerId: toConversation.customer_id
  });

  const nowIso = new Date().toISOString();
  const fromMetadata = ((fromConversation.metadata ?? null) as Record<string, unknown> | null) ?? {};
  const toMetadata = ((toConversation.metadata ?? null) as Record<string, unknown> | null) ?? {};
  const targetMergeState = ((toMetadata.webAutoMerge ?? null) as Record<string, unknown> | null) ?? {};
  const sourceMergeState = ((fromMetadata.webAutoMerge ?? null) as Record<string, unknown> | null) ?? {};

  const mergedFromIdsRaw = Array.isArray(targetMergeState.mergedFromConversationIds)
    ? targetMergeState.mergedFromConversationIds
    : [];
  const mergedFromIds = Array.from(
    new Set(
      [...mergedFromIdsRaw, params.fromConversationId]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
    )
  );

  const targetMetadata: Record<string, unknown> = {
    ...toMetadata,
    webAutoMerge: {
      ...targetMergeState,
      lastMergedAt: nowIso,
      lastReason: params.reason,
      mergedFromConversationIds: mergedFromIds
    }
  };
  const sourceMetadata: Record<string, unknown> = {
    ...fromMetadata,
    webAutoMerge: {
      ...sourceMergeState,
      mergedIntoConversationId: params.toConversationId,
      mergedAt: nowIso,
      reason: params.reason
    }
  };

  const nextLeadIntentScore = Math.max(
    Number(toConversation.lead_intent_score ?? 0),
    Number(fromConversation.lead_intent_score ?? 0)
  );

  const [targetUpdate, sourceUpdate] = await Promise.all([
    supabase
      .from('conversations')
      .update({
        metadata: targetMetadata,
        lead_intent_score: Number.isFinite(nextLeadIntentScore) ? nextLeadIntentScore : null,
        pending_customer_id: null
      })
      .eq('id', params.toConversationId),
    supabase
      .from('conversations')
      .update({
        status: 'closed',
        metadata: sourceMetadata,
        pending_customer_id: null
      })
      .eq('id', params.fromConversationId)
  ]);

  if (targetUpdate.error) {
    throw new Error(`Unable to update canonical conversation metadata after merge: ${targetUpdate.error.message}`);
  }
  if (sourceUpdate.error) {
    throw new Error(`Unable to close duplicate conversation after merge: ${sourceUpdate.error.message}`);
  }

  return {
    merged: true,
    fromConversationId: params.fromConversationId,
    toConversationId: params.toConversationId
  };
}

export async function verifyConversationLink(params: {
  conversationId: string;
  action: 'approve' | 'reject' | 'force_merge';
  actorRole: 'owner' | 'manager' | 'viewer';
  actorType: 'manager' | 'system';
  actorUserId?: string;
  targetCustomerId?: string;
  note?: string;
}) {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  const pendingCustomerId = params.targetCustomerId ?? conversation.pending_customer_id;
  if (!pendingCustomerId && params.action !== 'reject') {
    throw new Error('Pending customer link is not available');
  }
  if (params.action === 'force_merge' && params.actorRole !== 'owner') {
    throw new Error('Only owner can force merge');
  }

  if (params.action === 'reject') {
    await updateConversationSecurity({
      conversationId: params.conversationId,
      identityState: conversation.channel === 'web' ? 'unverified' : 'verified',
      memoryAccess: conversation.channel === 'web' ? 'session_only' : 'full_customer',
      pendingCustomerId: null
    });
    await updateConversationStatus({
      conversationId: params.conversationId,
      status: conversation.status,
      leadIntentScore: conversation.lead_intent_score ?? undefined
    });
    const supabase = getSupabaseAdminClient();
    await supabase
      .from('identity_claims')
      .update({claim_status: 'rejected'})
      .eq('conversation_id', params.conversationId)
      .eq('claim_status', 'candidate_match');
    if (conversation.channel_user_id) {
      await ensureIdentity({
        customerId: conversation.customer_id,
        channel: conversation.channel,
        channelUserId: conversation.channel_user_id,
        verificationLevel: conversation.channel === 'web' ? 'unverified' : 'verified_channel',
        verificationSource: conversation.channel === 'web' ? 'web_claim' : `${conversation.channel}_id`,
        verifiedAt: conversation.channel === 'web' ? null : new Date().toISOString(),
        pendingCustomerId: null
      });
    }
    return {conversationId: params.conversationId, action: 'reject'};
  }

  await mergeCustomers({
    fromCustomerId: conversation.customer_id,
    toCustomerId: pendingCustomerId as string,
    reason: params.note ?? (params.action === 'force_merge' ? 'force_merge' : 'approved_link'),
    triggerChannel: conversation.channel,
    triggerConversationId: params.conversationId,
    performedBy: params.actorType
  });

  await updateConversationCustomer(params.conversationId, pendingCustomerId as string);
  await updateConversationSecurity({
    conversationId: params.conversationId,
    identityState: 'verified',
    memoryAccess: 'full_customer',
    pendingCustomerId: null
  });
  if (conversation.channel_user_id) {
    await ensureIdentity({
      customerId: pendingCustomerId as string,
      channel: conversation.channel,
      channelUserId: conversation.channel_user_id,
      verificationLevel: conversation.channel === 'web' ? 'verified_strong' : 'verified_channel',
      verificationSource: params.action === 'force_merge' ? 'manual_admin' : `${conversation.channel}_id`,
      verifiedAt: new Date().toISOString(),
      pendingCustomerId: null,
      isPrimary: true
    });
  }
  await captureIdentityClaims({
    conversationId: params.conversationId,
    customerId: pendingCustomerId as string,
    sourceChannel: conversation.channel,
    status: 'verified',
    matchedCustomerId: null
  });

  return {conversationId: params.conversationId, action: params.action, customerId: pendingCustomerId};
}

export async function handoffConversation(params: {
  conversationId: string;
  managerUserId: string;
  note?: string;
  intentScore?: number;
  mode?: 'normal' | 'expedite';
  missingFieldsAtHandoff?: string[];
}) {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }
  const supabase = getSupabaseAdminClient();

  const briefUpdate = await supabase
    .from('lead_briefs')
    .update({status: 'handoff', updated_by: 'manager'})
    .eq('conversation_id', params.conversationId);
  if (briefUpdate.error && !isMissingTableError(briefUpdate.error.message, 'lead_briefs')) {
    throw new Error(`Unable to update lead brief status: ${briefUpdate.error.message}`);
  }

  await updateConversationStatus({
    conversationId: params.conversationId,
    status: 'handoff',
    assignedManagerId: params.managerUserId,
    leadIntentScore: params.intentScore ?? conversation.lead_intent_score ?? 80
  });

  await saveLeadEvent({
    conversationId: params.conversationId,
    customerId: conversation.customer_id,
    eventType: 'handoff',
    priority: 'high',
    intentScore: params.intentScore ?? conversation.lead_intent_score ?? 80,
    payload: {
      note: params.note ?? '',
      mode: params.mode ?? 'normal',
      missingFieldsAtHandoff: params.missingFieldsAtHandoff ?? []
    }
  });
}

export async function setConversationOutcome(params: {
  conversationId: string;
  managerUserId: string;
  outcome: 'won' | 'lost';
  note?: string;
  intentScore?: number;
}) {
  const conversation = await getConversationById(params.conversationId);
  if (!conversation) {
    throw new Error('Conversation not found');
  }

  await updateConversationStatus({
    conversationId: params.conversationId,
    status: 'closed',
    assignedManagerId: params.managerUserId,
    leadIntentScore: params.intentScore ?? conversation.lead_intent_score ?? 70
  });

  await saveLeadEvent({
    conversationId: params.conversationId,
    customerId: conversation.customer_id,
    eventType: params.outcome,
    priority: params.outcome === 'won' ? 'high' : 'medium',
    intentScore: params.intentScore ?? conversation.lead_intent_score ?? 70,
    payload: {
      note: params.note ?? '',
      managerUserId: params.managerUserId
    }
  });
}

export async function listProjects(filters: {
  accountId?: string;
  status?: 'planned' | 'in_progress' | 'blocked' | 'done';
  limit: number;
}) {
  const supabase = getSupabaseAdminClient();
  let query = supabase
    .from('projects')
    .select('*')
    .order('updated_at', {ascending: false})
    .limit(filters.limit);

  if (filters.accountId) {
    query = query.eq('account_id', filters.accountId);
  }
  if (filters.status) {
    query = query.eq('status', filters.status);
  }

  const {data, error} = await query;
  if (error) {
    throw new Error(`Unable to list projects: ${error.message}`);
  }
  return data ?? [];
}

export async function getAccountSummary(accountId: string) {
  const supabase = getSupabaseAdminClient();
  const [accountRes, customersRes, projectsRes, invoicesRes, paymentsRes, communicationsRes] = await Promise.all([
    supabase.from('accounts').select('*').eq('id', accountId).maybeSingle(),
    supabase.from('customers').select('*').eq('account_id', accountId).order('updated_at', {ascending: false}),
    supabase.from('projects').select('*').eq('account_id', accountId).order('updated_at', {ascending: false}),
    supabase.from('invoices').select('*').eq('account_id', accountId).order('issued_at', {ascending: false}),
    supabase.from('payments').select('*').eq('account_id', accountId).order('paid_at', {ascending: false}),
    supabase.from('communications').select('*').eq('account_id', accountId).order('created_at', {ascending: false}).limit(100)
  ]);

  if (accountRes.error) {
    throw new Error(`Unable to fetch account summary: ${accountRes.error.message}`);
  }

  return {
    account: accountRes.data ?? null,
    customers: customersRes.data ?? [],
    projects: projectsRes.data ?? [],
    invoices: invoicesRes.data ?? [],
    payments: paymentsRes.data ?? [],
    communications: communicationsRes.data ?? []
  };
}

export async function createCommunication(params: {
  accountId?: string | null;
  customerId?: string | null;
  conversationId?: string | null;
  type: 'bot' | 'manager_note' | 'email' | 'portal_update';
  visibility: 'internal' | 'client_visible';
  body: string;
  payload?: Record<string, unknown>;
}) {
  const supabase = getSupabaseAdminClient();
  const {error} = await supabase.from('communications').insert({
    account_id: params.accountId ?? null,
    customer_id: params.customerId ?? null,
    conversation_id: params.conversationId ?? null,
    type: params.type,
    visibility: params.visibility,
    body: params.body,
    payload: params.payload ?? {}
  });

  if (error) {
    throw new Error(`Unable to create communication entry: ${error.message}`);
  }
}

export async function ensureProjectInfoForLead(params: {
  customerId: string;
  projectName: string;
  accountId?: string;
}) {
  const supabase = getSupabaseAdminClient();
  if (!params.accountId) {
    return;
  }

  const existing = await supabase
    .from('projects')
    .select('id')
    .eq('account_id', params.accountId)
    .ilike('name', params.projectName)
    .limit(1)
    .maybeSingle();

  if (existing.data?.id || existing.error) {
    return;
  }

  await supabase.from('projects').insert({
    account_id: params.accountId,
    name: params.projectName,
    status: 'planned'
  });
}

export async function getAdminRoleForUser(userId: string): Promise<'owner' | 'manager' | 'viewer' | null> {
  const supabase = getSupabaseAdminClient();
  const {data, error} = await supabase.from('admin_users').select('role').eq('user_id', userId).maybeSingle();
  if (error || !data?.role) {
    return null;
  }
  if (data.role === 'owner' || data.role === 'manager' || data.role === 'viewer') {
    return data.role;
  }
  return null;
}
