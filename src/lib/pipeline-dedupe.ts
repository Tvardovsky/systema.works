type ConversationStatus = 'open' | 'qualified' | 'hot' | 'handoff' | 'closed';

type PipelineConversation = {
  id: string;
  channel: string;
  status: ConversationStatus;
  updatedAt: string;
  createdAt: string;
  source?: string | null;
  customerId?: string;
  leadIntentScore?: number;
  lastInboundMessageAt?: string | null;
  personalUnread: boolean;
  globalUnread: boolean;
  isNewForAdmin: boolean;
  personalLastReadAt: string | null;
  globalLastReadAt: string | null;
};

type PipelineBrief = {
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
} | null;

type LeadPipelineCandidate = {
  conversation: PipelineConversation;
  brief?: PipelineBrief;
  latestEvent?: unknown;
};

const ACTIVE_STATUS = new Set<ConversationStatus>(['open', 'qualified', 'hot', 'handoff']);

function clean(input?: string | null): string {
  return (input ?? '').trim();
}

function toTimestamp(input?: string | null): number {
  if (!input) {
    return Number.NaN;
  }
  const ts = Date.parse(input);
  return Number.isFinite(ts) ? ts : Number.NaN;
}

function compareDesc(a: string, b: string): number {
  const at = toTimestamp(a);
  const bt = toTimestamp(b);
  if (!Number.isFinite(at) || !Number.isFinite(bt)) {
    return String(b).localeCompare(String(a));
  }
  return bt - at;
}

function hasBriefData(brief?: PipelineBrief): boolean {
  if (!brief) {
    return false;
  }
  return Boolean(
    clean(brief.fullName) ||
    clean(brief.email) ||
    clean(brief.phone) ||
    clean(brief.telegramHandle) ||
    clean(brief.serviceType) ||
    clean(brief.primaryGoal) ||
    clean(brief.firstDeliverable) ||
    clean(brief.timelineHint) ||
    clean(brief.budgetHint) ||
    clean(brief.referralSource) ||
    clean(brief.constraints)
  );
}

function isTechnicalWebDuplicateCandidate(item: LeadPipelineCandidate): boolean {
  if (clean(item.conversation.channel).toLowerCase() !== 'web') {
    return false;
  }
  if (!ACTIVE_STATUS.has(item.conversation.status)) {
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
  if (hasBriefData(item.brief ?? null)) {
    return false;
  }
  return true;
}

function mergeReadFlags<T extends LeadPipelineCandidate>(base: T, another: T): T {
  const personalReadAt = [base.conversation.personalLastReadAt, another.conversation.personalLastReadAt]
    .filter((value): value is string => Boolean(value))
    .sort(compareDesc)[0] ?? null;
  const globalReadAt = [base.conversation.globalLastReadAt, another.conversation.globalLastReadAt]
    .filter((value): value is string => Boolean(value))
    .sort(compareDesc)[0] ?? null;

  return {
    ...base,
    conversation: {
      ...base.conversation,
      personalUnread: base.conversation.personalUnread || another.conversation.personalUnread,
      globalUnread: base.conversation.globalUnread || another.conversation.globalUnread,
      isNewForAdmin: base.conversation.isNewForAdmin || another.conversation.isNewForAdmin,
      personalLastReadAt: personalReadAt,
      globalLastReadAt: globalReadAt
    }
  };
}

function getTechnicalBrowserKey(params: {
  conversationId: string;
  browserKeyByConversationId?: ReadonlyMap<string, string>;
}): string | null {
  const value = params.browserKeyByConversationId?.get(params.conversationId);
  if (!value) {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

export function dedupeLeadPipelineItems<T extends LeadPipelineCandidate>(
  items: T[],
  options?: {browserKeyByConversationId?: ReadonlyMap<string, string>}
): T[] {
  const sorted = [...items].sort((a, b) => compareDesc(a.conversation.updatedAt, b.conversation.updatedAt));
  const result: T[] = [];
  const keyToIndex = new Map<string, number>();

  for (const item of sorted) {
    if (!isTechnicalWebDuplicateCandidate(item)) {
      result.push(item);
      continue;
    }

    const browserKey = getTechnicalBrowserKey({
      conversationId: item.conversation.id,
      browserKeyByConversationId: options?.browserKeyByConversationId
    });
    if (!browserKey) {
      result.push(item);
      continue;
    }

    const key = `web|${browserKey}`;
    const duplicateIndex = keyToIndex.get(key);
    if (duplicateIndex === undefined) {
      const index = result.push(item) - 1;
      keyToIndex.set(key, index);
      continue;
    }

    const previous = result[duplicateIndex];
    if (!previous || !isTechnicalWebDuplicateCandidate(previous)) {
      result.push(item);
      continue;
    }

    result[duplicateIndex] = mergeReadFlags(previous, item);
  }

  return result;
}
