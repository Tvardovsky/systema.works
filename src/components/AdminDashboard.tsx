'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {useTranslations} from 'next-intl';
import {AdminLocaleSwitcher} from '@/components/AdminLocaleSwitcher';

type ConversationStatus = 'open' | 'qualified' | 'hot' | 'handoff' | 'closed';
type ReadFilter = 'all' | 'personal_unread' | 'personal_read';
type SortMode = 'unread_first' | 'updated_desc';

type PipelineItem = {
  conversation: {
    id: string;
    customerId: string;
    channel: string;
    status: ConversationStatus;
    leadIntentScore: number;
    assignedManagerId: string | null;
    identityState: 'unverified' | 'pending_match' | 'verified';
    memoryAccess: 'none' | 'session_only' | 'full_customer';
    pendingCustomerId: string | null;
    lastInboundMessageAt: string | null;
    personalUnread: boolean;
    globalUnread: boolean;
    isNewForAdmin: boolean;
    personalLastReadAt: string | null;
    globalLastReadAt: string | null;
    updatedAt: string;
    createdAt: string;
  };
  customer: {
    id: string;
    fullName: string | null;
    company: string | null;
    emails: string[];
    phones: string[];
  };
  brief: {
    id: string;
    status: 'collecting' | 'ready_for_handoff' | 'handoff';
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
    missingFields: string[];
    completenessScore: number;
    updatedAt: string;
  } | null;
  latestEvent: {
    id: string;
    eventType: string;
    priority: string;
    intentScore: number;
    createdAt: string;
  } | null;
  verificationLevel: 'unverified' | 'verified_channel' | 'verified_phone' | 'verified_strong';
};

type Message = {
  id: string;
  role: string;
  content: string;
  created_at: string;
};

type BriefBundle = {
  brief: {
    id: string;
    status: 'collecting' | 'ready_for_handoff' | 'handoff';
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
    missingFields: string[];
    completenessScore: number;
  } | null;
  revisions: Array<{
    id: string;
    changed_by_type: string;
    changed_by_user_id: string | null;
    note: string | null;
    created_at: string;
  }>;
  derivedContacts: {
    primaryEmail: string | null;
    primaryPhone: string | null;
    primaryTelegram: string | null;
    allEmails: string[];
    allPhones: string[];
    allTelegram: string[];
  } | null;
};

type CustomerContext = {
  customer: {
    id: string;
    account_id?: string | null;
    full_name?: string | null;
    company?: string | null;
    locale_pref?: string | null;
  } | null;
  contacts: {
    primaryEmail: string | null;
    primaryPhone: string | null;
    allEmails: string[];
    allPhones: string[];
  } | null;
  contactsCaptured?: {
    emails: string[];
    phones: string[];
    telegramHandles: string[];
  };
  contactsVerified?: {
    emails: string[];
    phones: string[];
    telegramHandles: string[];
  };
  identityVerification?: {
    highestVerification: string;
    items: Array<{
      id: string;
      channel: string;
      channelUserId: string;
      verificationLevel: string;
      verificationSource: string | null;
      verifiedAt: string | null;
      pendingLinkCustomerId: string | null;
      matchConfidence: number | null;
      lastSeenAt: string | null;
    }>;
  };
  claims?: Array<{
    id: string;
    claim_type: string;
    normalized_value: string;
    claim_status: string;
    source_channel: string;
    updated_at: string;
  }>;
  mergeAudit?: Array<{
    id: string;
    from_customer_id: string;
    to_customer_id: string;
    reason: string;
    trigger_channel: string;
    created_at: string;
  }>;
  identities: Array<{
    id: string;
    channel: string;
    channel_user_id: string;
    username?: string | null;
    phone?: string | null;
    email?: string | null;
    last_seen_at?: string | null;
    match_confidence?: number | null;
  }>;
  memory: {summary?: string | null} | null;
  leadBrief: {
    status: string;
    missingFields: string[];
    completenessScore: number;
    referralSource?: string | null;
  } | null;
  readStateSummary?: {
    personalUnread: number;
    globalUnread: number;
  };
  technicalSignals?: {
    firstSeenAt: string | null;
    lastSeenAt: string | null;
    lastIpMasked: string | null;
    lastCountry: string | null;
    lastBrowser: string | null;
    lastDeviceType: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown' | null;
    uniqueIpCount90d: number;
    uniqueCountryCount90d: number;
    uniqueDeviceCount90d: number;
    recentIps: Array<{
      ipMasked: string | null;
      hits: number;
      lastSeenAt: string;
    }>;
    recentCountries: Array<{
      countryCode: string;
      region: string | null;
      city: string | null;
      hits: number;
      lastSeenAt: string;
    }>;
    recentAgents: Array<{
      browserFamily: string | null;
      browserVersion: string | null;
      osFamily: string | null;
      osVersion: string | null;
      deviceType: 'mobile' | 'tablet' | 'desktop' | 'bot' | 'unknown';
      isBot: boolean;
      hits: number;
      lastSeenAt: string;
    }>;
  } | null;
};

type FetchState<T> = {
  loading: boolean;
  error: string | null;
  data: T;
};

type BriefDraft = {
  fullName: string;
  email: string;
  phone: string;
  telegramHandle: string;
  serviceType: string;
  primaryGoal: string;
  firstDeliverable: string;
  timelineHint: string;
  budgetHint: string;
  referralSource: string;
  constraints: string;
  note: string;
};

const EMPTY_BRIEF_DRAFT: BriefDraft = {
  fullName: '',
  email: '',
  phone: '',
  telegramHandle: '',
  serviceType: '',
  primaryGoal: '',
  firstDeliverable: '',
  timelineHint: '',
  budgetHint: '',
  referralSource: '',
  constraints: '',
  note: ''
};

function fmtDate(input?: string | null): string {
  if (!input) {
    return '-';
  }
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) {
    return input;
  }
  return d.toLocaleString();
}

type Props = {
  locale: 'ru' | 'en';
  role: 'owner' | 'manager' | 'viewer';
};

export function AdminDashboard({locale, role}: Props) {
  const t = useTranslations('Admin');

  const [token, setToken] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | ConversationStatus>('all');
  const [readFilter, setReadFilter] = useState<ReadFilter>('all');
  const [sort, setSort] = useState<SortMode>('unread_first');

  const [pipeline, setPipeline] = useState<FetchState<PipelineItem[]>>({loading: true, error: null, data: []});
  const [messages, setMessages] = useState<FetchState<Message[]>>({loading: false, error: null, data: []});
  const [briefBundle, setBriefBundle] = useState<FetchState<BriefBundle | null>>({loading: false, error: null, data: null});
  const [customerContext, setCustomerContext] = useState<FetchState<CustomerContext | null>>({loading: false, error: null, data: null});
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [savingBrief, setSavingBrief] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionNote, setActionNote] = useState('');
  const [briefDraft, setBriefDraft] = useState<BriefDraft>(EMPTY_BRIEF_DRAFT);

  const headers = useMemo(() => {
    if (!token.trim()) {
      return undefined;
    }
    return {authorization: `Bearer ${token.trim()}`};
  }, [token]);

  const fetchAdmin = useCallback(async <T,>(url: string, init?: RequestInit): Promise<T> => {
    const response = await fetch(url, {
      method: 'GET',
      headers,
      cache: 'no-store',
      ...init
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const payload = (await response.json()) as {ok?: boolean; data?: T};
    return payload.data as T;
  }, [headers]);

  const selectedItem = useMemo(
    () => pipeline.data.find((item) => item.conversation.id === selectedConversationId) ?? null,
    [pipeline.data, selectedConversationId]
  );

  const grouped = useMemo(() => {
    const groups: Record<'open' | 'qualified' | 'hot' | 'handoff', PipelineItem[]> = {
      open: [],
      qualified: [],
      hot: [],
      handoff: []
    };
    for (const item of pipeline.data) {
      if (item.conversation.status === 'open' || item.conversation.status === 'qualified' || item.conversation.status === 'hot' || item.conversation.status === 'handoff') {
        groups[item.conversation.status].push(item);
      }
    }
    return groups;
  }, [pipeline.data]);

  const kpi = useMemo(() => {
    const unread = pipeline.data.filter((item) => item.conversation.personalUnread).length;
    return {
      open: grouped.open.length,
      qualified: grouped.qualified.length,
      hot: grouped.hot.length,
      handoff: grouped.handoff.length,
      unread
    };
  }, [grouped, pipeline.data]);

  const loadPipeline = useCallback(async () => {
    setPipeline((prev) => ({...prev, loading: true, error: null}));
    try {
      const params = new URLSearchParams();
      params.set('view', 'pipeline');
      params.set('limit', '250');
      params.set('readFilter', readFilter);
      params.set('sort', sort);
      if (statusFilter !== 'all') {
        params.set('status', statusFilter);
      }
      if (query.trim()) {
        params.set('q', query.trim());
      }

      const data = await fetchAdmin<PipelineItem[]>(`/api/admin/leads?${params.toString()}`);
      setPipeline({loading: false, error: null, data});

      if (data[0] && !selectedConversationId) {
        setSelectedConversationId(data[0].conversation.id);
        setSelectedCustomerId(data[0].conversation.customerId);
      }
      if (selectedConversationId && !data.some((item) => item.conversation.id === selectedConversationId)) {
        const first = data[0] ?? null;
        setSelectedConversationId(first?.conversation.id ?? null);
        setSelectedCustomerId(first?.conversation.customerId ?? null);
      }
    } catch (error) {
      setPipeline({loading: false, error: error instanceof Error ? error.message : t('errors.pipelineLoad'), data: []});
    }
  }, [fetchAdmin, query, readFilter, selectedConversationId, sort, statusFilter, t]);

  const loadConversationDetails = useCallback(async (conversationId: string, customerId: string) => {
    setMessages({loading: true, error: null, data: []});
    setBriefBundle({loading: true, error: null, data: null});
    setCustomerContext({loading: true, error: null, data: null});

    const [messagesRes, briefRes, customerRes] = await Promise.allSettled([
      fetchAdmin<Message[]>(`/api/admin/conversations/${conversationId}/messages?limit=300`),
      fetchAdmin<BriefBundle>(`/api/admin/conversations/${conversationId}/brief`),
      fetchAdmin<CustomerContext>(`/api/admin/customers/${customerId}/context`)
    ]);

    if (messagesRes.status === 'fulfilled') {
      setMessages({loading: false, error: null, data: messagesRes.value});
    } else {
      setMessages({
        loading: false,
        error: messagesRes.reason instanceof Error ? messagesRes.reason.message : t('errors.messagesLoad'),
        data: []
      });
    }

    if (briefRes.status === 'fulfilled') {
      setBriefBundle({loading: false, error: null, data: briefRes.value});
    } else {
      setBriefBundle({
        loading: false,
        error: briefRes.reason instanceof Error ? briefRes.reason.message : t('errors.briefLoad'),
        data: null
      });
    }

    if (customerRes.status === 'fulfilled') {
      setCustomerContext({loading: false, error: null, data: customerRes.value});
    } else {
      setCustomerContext({
        loading: false,
        error: customerRes.reason instanceof Error ? customerRes.reason.message : t('errors.contextLoad'),
        data: null
      });
    }
  }, [fetchAdmin, t]);

  const markConversationRead = useCallback(async (conversationId: string) => {
    await fetchAdmin<unknown>(`/api/admin/conversations/${conversationId}/read`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(headers ?? {})
      },
      body: JSON.stringify({mode: 'read'})
    });
  }, [fetchAdmin, headers]);

  const markVisibleAsRead = useCallback(async () => {
    const conversationIds = pipeline.data
      .filter((item) => item.conversation.personalUnread || item.conversation.isNewForAdmin)
      .map((item) => item.conversation.id);
    if (!conversationIds.length) {
      return;
    }
    setActionLoading(true);
    try {
      await fetchAdmin<{count: number}>('/api/admin/conversations/read-bulk', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify({conversationIds})
      });
      await loadPipeline();
    } finally {
      setActionLoading(false);
    }
  }, [fetchAdmin, headers, loadPipeline, pipeline.data]);

  const cleanupUnknownAndOpen = useCallback(async () => {
    if (role === 'viewer' || actionLoading) {
      return;
    }

    const confirmed = window.confirm(t('actions.cleanupUnknownOpenConfirm'));
    if (!confirmed) {
      return;
    }

    let mode: 'close' | 'delete' = 'close';
    if (role === 'owner') {
      const hardDelete = window.confirm(t('actions.cleanupUnknownOpenDeleteConfirm'));
      mode = hardDelete ? 'delete' : 'close';
    }

    setActionLoading(true);
    try {
      const data = await fetchAdmin<{
        mode: 'close' | 'delete';
        matched: number;
        openMatched: number;
        unknownMatched: number;
        affected: number;
      }>('/api/admin/conversations/cleanup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify({
          confirmed: true,
          mode
        })
      });

      await loadPipeline();
      if (selectedConversationId && selectedCustomerId) {
        await loadConversationDetails(selectedConversationId, selectedCustomerId).catch(() => undefined);
      }

      const modeLabel = data.mode === 'delete' ? t('actions.cleanupModeDelete') : t('actions.cleanupModeClose');
      window.alert(
        t('actions.cleanupUnknownOpenDone', {
          mode: modeLabel,
          affected: data.affected,
          matched: data.matched,
          open: data.openMatched,
          unknown: data.unknownMatched
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : t('errors.cleanupFailed');
      window.alert(message);
    } finally {
      setActionLoading(false);
    }
  }, [
    actionLoading,
    fetchAdmin,
    headers,
    loadConversationDetails,
    loadPipeline,
    role,
    selectedConversationId,
    selectedCustomerId,
    t
  ]);

  useEffect(() => {
    void loadPipeline();
  }, [loadPipeline]);

  useEffect(() => {
    if (!selectedConversationId || !selectedCustomerId) {
      return;
    }
    void loadConversationDetails(selectedConversationId, selectedCustomerId);
  }, [loadConversationDetails, selectedConversationId, selectedCustomerId]);

  useEffect(() => {
    if (!selectedItem) {
      return;
    }
    if (!selectedItem.conversation.personalUnread && !selectedItem.conversation.isNewForAdmin) {
      return;
    }
    void (async () => {
      await markConversationRead(selectedItem.conversation.id);
      await loadPipeline();
    })();
  }, [loadPipeline, markConversationRead, selectedItem]);

  useEffect(() => {
    const brief = briefBundle.data?.brief;
    if (!brief) {
      setBriefDraft(EMPTY_BRIEF_DRAFT);
      return;
    }
    setBriefDraft({
      fullName: brief.fullName ?? '',
      email: brief.email ?? '',
      phone: brief.phone ?? '',
      telegramHandle: brief.telegramHandle ?? '',
      serviceType: brief.serviceType ?? '',
      primaryGoal: brief.primaryGoal ?? '',
      firstDeliverable: brief.firstDeliverable ?? '',
      timelineHint: brief.timelineHint ?? '',
      budgetHint: brief.budgetHint ?? '',
      referralSource: brief.referralSource ?? '',
      constraints: brief.constraints ?? '',
      note: ''
    });
  }, [briefBundle.data?.brief]);

  const patchBrief = useCallback(async () => {
    if (!selectedConversationId || savingBrief) {
      return;
    }
    setSavingBrief(true);
    try {
      await fetchAdmin<unknown>(`/api/admin/conversations/${selectedConversationId}/brief`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify(briefDraft)
      });
      if (selectedCustomerId) {
        await loadConversationDetails(selectedConversationId, selectedCustomerId);
      }
      await loadPipeline();
    } finally {
      setSavingBrief(false);
    }
  }, [briefDraft, fetchAdmin, headers, loadConversationDetails, loadPipeline, savingBrief, selectedConversationId, selectedCustomerId]);

  const triggerHandoff = useCallback(async (mode: 'normal' | 'expedite') => {
    if (!selectedConversationId) {
      return;
    }
    setActionLoading(true);
    try {
      await fetchAdmin<unknown>(`/api/admin/conversations/${selectedConversationId}/handoff`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify({
          mode,
          note: actionNote || (mode === 'expedite' ? 'Expedite handoff from admin dashboard' : 'Manual handoff from admin dashboard'),
          missingFieldsAtHandoff: briefBundle.data?.brief?.missingFields ?? []
        })
      });
      await loadPipeline();
      if (selectedCustomerId) {
        await loadConversationDetails(selectedConversationId, selectedCustomerId);
      }
    } finally {
      setActionLoading(false);
    }
  }, [actionNote, briefBundle.data?.brief?.missingFields, fetchAdmin, headers, loadConversationDetails, loadPipeline, selectedConversationId, selectedCustomerId]);

  const verifyLink = useCallback(async (action: 'approve' | 'reject' | 'force_merge') => {
    if (!selectedConversationId) {
      return;
    }
    if (action === 'force_merge') {
      const ok = window.confirm(t('actions.forceMergeConfirm'));
      if (!ok) {
        return;
      }
    }
    setActionLoading(true);
    try {
      await fetchAdmin<unknown>(`/api/admin/conversations/${selectedConversationId}/verify-link`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify({
          action,
          note: actionNote || undefined
        })
      });
      await loadPipeline();
      if (selectedCustomerId) {
        await loadConversationDetails(selectedConversationId, selectedCustomerId);
      }
    } finally {
      setActionLoading(false);
    }
  }, [actionNote, fetchAdmin, headers, loadConversationDetails, loadPipeline, selectedConversationId, selectedCustomerId, t]);

  const markOutcome = useCallback(async (outcome: 'won' | 'lost') => {
    if (!selectedConversationId) {
      return;
    }
    setActionLoading(true);
    try {
      await fetchAdmin<unknown>(`/api/admin/conversations/${selectedConversationId}/status`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers ?? {})
        },
        body: JSON.stringify({
          outcome,
          note: actionNote || undefined
        })
      });
      await loadPipeline();
      if (selectedCustomerId) {
        await loadConversationDetails(selectedConversationId, selectedCustomerId);
      }
    } finally {
      setActionLoading(false);
    }
  }, [actionNote, fetchAdmin, headers, loadConversationDetails, loadPipeline, selectedConversationId, selectedCustomerId]);

  const statusSections = ['open', 'qualified', 'hot', 'handoff'] as const;
  const hasSelectedConversation = Boolean(selectedConversationId);
  const isPendingMatch = selectedItem?.conversation.identityState === 'pending_match';
  const canManageActions = role === 'owner' || role === 'manager';
  const showIdentityActions = hasSelectedConversation && isPendingMatch;
  const isOwner = role === 'owner';
  const actionStatusText = !canManageActions
    ? t('actions.viewerReadOnly')
    : !hasSelectedConversation
    ? t('actions.selectLeadToAct')
    : (!isPendingMatch ? t('actions.identityPendingOnly') : (isOwner ? t('actions.identityReady') : t('actions.forceMergeOwnerOnly')));

  return (
    <main className="lp-main">
      <div className="page-shell admin-page-shell admin-shell admin-v2-shell" suppressHydrationWarning>
        <section className="card bg-base-100 shadow-sm admin-v2-topbar">
          <div className="card-body gap-4 p-5">
            <div className="admin-headline admin-v2-headline">
              <div>
                <h1 className="text-2xl font-black text-primary">{t('title')}</h1>
                <p className="text-sm text-base-content/70">{t('subtitle')}</p>
              </div>
              <div className="admin-head-actions admin-v2-head-actions">
                <div className="join">
                  <AdminLocaleSwitcher locale={locale} className="join-item" />
                  <button className="btn btn-primary btn-sm join-item" type="button" onClick={() => void loadPipeline()}>
                    {t('actions.refresh')}
                  </button>
                </div>
              </div>
            </div>

            <div role="tablist" className="tabs tabs-box w-fit">
              <Link role="tab" className="tab tab-active" href={`/${locale}/admin`}>
                {t('nav.pipeline')}
              </Link>
              <Link role="tab" className="tab" href={`/${locale}/admin/outcomes`}>
                {t('nav.outcomes')}
              </Link>
            </div>

            <div className="admin-v2-filters">
              <label className="input input-bordered w-full">
                <input
                  className="grow"
                  placeholder={t('filters.search')}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  suppressHydrationWarning
                />
              </label>
              <div className="join admin-v2-filter-join">
                <select className="select select-bordered join-item" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as 'all' | ConversationStatus)}>
                  <option value="all">{t('filters.statusAll')}</option>
                  <option value="open">{t('status.open')}</option>
                  <option value="qualified">{t('status.qualified')}</option>
                  <option value="hot">{t('status.hot')}</option>
                  <option value="handoff">{t('status.handoff')}</option>
                </select>
                <select className="select select-bordered join-item" value={readFilter} onChange={(event) => setReadFilter(event.target.value as ReadFilter)}>
                  <option value="all">{t('filters.readAll')}</option>
                  <option value="personal_unread">{t('filters.readUnread')}</option>
                  <option value="personal_read">{t('filters.readRead')}</option>
                </select>
                <select className="select select-bordered join-item" value={sort} onChange={(event) => setSort(event.target.value as SortMode)}>
                  <option value="unread_first">{t('filters.sortUnreadFirst')}</option>
                  <option value="updated_desc">{t('filters.sortUpdated')}</option>
                </select>
              </div>
              <label className="input input-bordered w-full">
                <input
                  type="password"
                  className="grow"
                  placeholder={t('filters.bearer')}
                  value={token}
                  onChange={(event) => setToken(event.target.value)}
                  suppressHydrationWarning
                />
              </label>
            </div>
          </div>
        </section>

        <section className="stats stats-vertical border border-base-300 bg-base-100 shadow-sm xl:stats-horizontal">
          <div className="stat py-4">
            <div className="stat-title">{t('status.open')}</div>
            <div className="stat-value text-primary">{kpi.open}</div>
          </div>
          <div className="stat py-4">
            <div className="stat-title">{t('status.qualified')}</div>
            <div className="stat-value text-primary">{kpi.qualified}</div>
          </div>
          <div className="stat py-4">
            <div className="stat-title">{t('status.hot')}</div>
            <div className="stat-value text-primary">{kpi.hot}</div>
          </div>
          <div className="stat py-4">
            <div className="stat-title">{t('status.handoff')}</div>
            <div className="stat-value text-primary">{kpi.handoff}</div>
          </div>
          <div className="stat py-4">
            <div className="stat-title">{t('status.unread')}</div>
            <div className="stat-value text-secondary">{kpi.unread}</div>
          </div>
        </section>

        <section className="admin-v2-grid">
          <aside className="card bg-base-100 shadow-sm admin-v2-column">
            <div className="card-body p-4">
              <div className="admin-v2-card-head admin-v2-card-head-stack">
                <h2 className="text-lg font-bold text-primary">{t('sections.pipeline')}</h2>
                <div className="admin-pipeline-actions">
                  <button className="btn btn-outline" type="button" disabled={actionLoading} onClick={() => void markVisibleAsRead()}>
                    {t('actions.markVisibleRead')}
                  </button>
                  <button
                    className="btn btn-outline btn-error"
                    type="button"
                    disabled={actionLoading || role === 'viewer'}
                    onClick={() => void cleanupUnknownAndOpen()}
                  >
                    {t('actions.cleanupUnknownOpen')}
                  </button>
                </div>
              </div>

              {pipeline.error ? (
                <div className="alert alert-error text-sm">
                  <span>{pipeline.error}</span>
                </div>
              ) : null}

              {pipeline.loading ? (
                <div className="admin-skeleton-stack">
                  {Array.from({length: 7}).map((_, idx) => (
                    <div key={idx} className="skeleton h-20 w-full rounded-box" />
                  ))}
                </div>
              ) : null}

              {!pipeline.loading && !pipeline.error && pipeline.data.length === 0 ? (
                <div className="admin-empty-state">
                  <p className="text-sm opacity-75">{t('empty.pipeline')}</p>
                  {readFilter !== 'all' ? (
                    <button className="btn btn-sm btn-outline" type="button" onClick={() => setReadFilter('all')}>
                      {t('actions.showAllLeads')}
                    </button>
                  ) : null}
                </div>
              ) : null}

              {!pipeline.loading ? statusSections.map((status) => (
                <details
                  key={status}
                  className="collapse collapse-arrow border border-base-300 bg-base-100"
                  open={status === 'open' || selectedItem?.conversation.status === status}
                >
                  <summary className="collapse-title min-h-0 py-3 text-sm font-semibold text-primary">
                    <div className="flex items-center justify-between gap-2 pr-6">
                      <span>{t(`status.${status}`)}</span>
                      <span className="badge badge-outline badge-sm">{grouped[status].length}</span>
                    </div>
                  </summary>
                  <div className="collapse-content pt-0">
                    {grouped[status].length === 0 ? (
                      <p className="px-2 text-xs opacity-65">{t('common.none')}</p>
                    ) : (
                      <ul className="menu menu-sm gap-1 rounded-box bg-base-100 p-0">
                        {grouped[status].map((item) => (
                          <li key={item.conversation.id}>
                            <button
                              type="button"
                              className={`admin-pipeline-item ${selectedConversationId === item.conversation.id ? 'menu-active' : ''}`}
                              onClick={() => {
                                setSelectedConversationId(item.conversation.id);
                                setSelectedCustomerId(item.conversation.customerId);
                              }}
                            >
                              <div className="admin-v2-item-head">
                                <div className="indicator w-full justify-start">
                                  {item.conversation.personalUnread ? (
                                    <span className="badge badge-error badge-xs indicator-item indicator-end indicator-top mr-2 mt-2 px-1">•</span>
                                  ) : null}
                                  <strong className="truncate">{item.customer.fullName ?? t('common.unknown')}</strong>
                                </div>
                                <span className="badge badge-outline badge-sm">{item.conversation.channel}</span>
                              </div>
                              <div className="admin-v2-item-badges">
                                {item.conversation.isNewForAdmin ? <span className="badge badge-info badge-sm">{t('badges.new')}</span> : null}
                                {item.conversation.personalUnread ? <span className="badge badge-error badge-sm">{t('badges.unread')}</span> : null}
                                {item.conversation.globalUnread && !item.conversation.personalUnread ? <span className="badge badge-warning badge-sm">{t('badges.teamUnread')}</span> : null}
                              </div>
                              <div className="admin-v2-item-meta text-xs opacity-80">
                                <span className="truncate">{item.customer.company ?? '-'}</span>
                                <span>{t('labels.score')}: {item.conversation.leadIntentScore}</span>
                              </div>
                              <p className="text-[11px] opacity-70">{fmtDate(item.conversation.updatedAt)}</p>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </details>
              )) : null}
            </div>
          </aside>

          <section className="admin-v2-center">
            <div className="admin-v2-top-pair">
              <article className="card bg-base-100 shadow-sm">
                <div className="card-body p-5">
                  <h2 className="text-lg font-bold text-primary">{t('sections.summary')}</h2>
                  {pipeline.loading && !selectedItem ? (
                    <div className="admin-skeleton-stack">
                      {Array.from({length: 6}).map((_, idx) => (
                        <div key={idx} className="skeleton h-4 w-full rounded-md" />
                      ))}
                    </div>
                  ) : null}
                  {selectedItem ? (
                    <dl className="admin-kv-grid text-sm">
                      <dt>{t('labels.name')}</dt>
                      <dd>{selectedItem.customer.fullName ?? selectedItem.brief?.fullName ?? '-'}</dd>
                      <dt>{t('labels.company')}</dt>
                      <dd>{selectedItem.customer.company ?? '-'}</dd>
                      <dt>{t('labels.status')}</dt>
                      <dd>{t(`status.${selectedItem.conversation.status}`)}</dd>
                      <dt>{t('labels.score')}</dt>
                      <dd>{selectedItem.conversation.leadIntentScore}</dd>
                      <dt>{t('labels.identityState')}</dt>
                      <dd>{selectedItem.conversation.identityState}</dd>
                      <dt>{t('labels.memoryAccess')}</dt>
                      <dd>{selectedItem.conversation.memoryAccess}</dd>
                      <dt>{t('labels.verification')}</dt>
                      <dd>{selectedItem.verificationLevel}</dd>
                      <dt>{t('labels.pendingLink')}</dt>
                      <dd>{selectedItem.conversation.pendingCustomerId ?? '-'}</dd>
                      <dt>{t('labels.lastInbound')}</dt>
                      <dd>{fmtDate(selectedItem.conversation.lastInboundMessageAt)}</dd>
                      <dt>{t('labels.briefCompleteness')}</dt>
                      <dd>{selectedItem.brief?.completenessScore ?? 0}%</dd>
                      <dt>{t('labels.missingFields')}</dt>
                      <dd>{(selectedItem.brief?.missingFields ?? []).join(', ') || t('common.none')}</dd>
                    </dl>
                  ) : (
                    <p className="text-sm opacity-75">{t('common.selectLead')}</p>
                  )}
                </div>
              </article>

              <article className="card bg-base-100 shadow-sm">
                <div className="card-body p-5">
                  <h2 className="text-lg font-bold text-primary">{t('sections.actions')}</h2>
                  <div className="admin-v2-action-stack admin-v2-action-compact">
                    <label className="input input-bordered input-sm w-full">
                      <input
                        className="grow"
                        placeholder={t('fields.actionNote')}
                        value={actionNote}
                        onChange={(event) => setActionNote(event.target.value)}
                        suppressHydrationWarning
                      />
                    </label>

                    {hasSelectedConversation && canManageActions ? (
                      <>
                        <section className="rounded-box border border-base-300 bg-base-100 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-primary">{t('sections.routing')}</h3>
                            <div className="tooltip tooltip-left" data-tip={t('actions.routingHint')}>
                              <span className="btn btn-ghost btn-circle btn-xs">i</span>
                            </div>
                          </div>
                          <div className="admin-v2-action-row">
                            <button className="btn btn-primary btn-sm" type="button" disabled={actionLoading} onClick={() => void triggerHandoff('normal')}>
                              {t('actions.handoffNormal')}
                            </button>
                            <div className="dropdown dropdown-end">
                              <div tabIndex={0} role="button" className="btn btn-outline btn-sm">
                                {t('actions.menu')}
                              </div>
                              <ul tabIndex={0} className="menu menu-sm dropdown-content z-20 mt-2 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                                <li>
                                  <button type="button" disabled={actionLoading} onClick={() => void triggerHandoff('expedite')}>
                                    {t('actions.handoffExpedite')}
                                  </button>
                                </li>
                              </ul>
                            </div>
                          </div>
                        </section>

                        {showIdentityActions ? (
                          <section className="rounded-box border border-base-300 bg-base-100 p-3">
                            <div className="mb-2 flex items-center justify-between gap-2">
                              <h3 className="text-sm font-semibold text-primary">{t('sections.identityResolution')}</h3>
                              <div className="tooltip tooltip-left" data-tip={t('actions.identityHint')}>
                                <span className="btn btn-ghost btn-circle btn-xs">i</span>
                              </div>
                            </div>
                            <div className="admin-v2-action-row">
                              <button className="btn btn-outline btn-sm" type="button" disabled={actionLoading} onClick={() => void verifyLink('approve')}>
                                {t('actions.approveLink')}
                              </button>
                              <button className="btn btn-outline btn-sm" type="button" disabled={actionLoading} onClick={() => void verifyLink('reject')}>
                                {t('actions.rejectLink')}
                              </button>
                              {isOwner ? (
                                <div className="dropdown dropdown-end">
                                  <div tabIndex={0} role="button" className="btn btn-error btn-soft btn-sm">
                                    {t('actions.danger')}
                                  </div>
                                  <ul tabIndex={0} className="menu menu-sm dropdown-content z-20 mt-2 w-64 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                                    <li>
                                      <button type="button" className="text-error" disabled={actionLoading} onClick={() => void verifyLink('force_merge')}>
                                        {t('actions.forceMerge')}
                                      </button>
                                    </li>
                                  </ul>
                                </div>
                              ) : null}
                            </div>
                          </section>
                        ) : null}

                        <section className="rounded-box border border-base-300 bg-base-100 p-3">
                          <div className="mb-2 flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold text-primary">{t('sections.outcome')}</h3>
                            <div className="tooltip tooltip-left" data-tip={t('actions.outcomeHint')}>
                              <span className="btn btn-ghost btn-circle btn-xs">i</span>
                            </div>
                          </div>
                          <div className="dropdown dropdown-end">
                            <div tabIndex={0} role="button" className="btn btn-success btn-sm">
                              {t('actions.outcomeMenu')}
                            </div>
                            <ul tabIndex={0} className="menu menu-sm dropdown-content z-20 mt-2 w-56 rounded-box border border-base-300 bg-base-100 p-2 shadow">
                              <li>
                                <button type="button" disabled={actionLoading} onClick={() => void markOutcome('won')}>
                                  {t('actions.markWon')}
                                </button>
                              </li>
                              <li>
                                <button type="button" disabled={actionLoading} onClick={() => void markOutcome('lost')}>
                                  {t('actions.markLost')}
                                </button>
                              </li>
                            </ul>
                          </div>
                        </section>
                      </>
                    ) : null}

                    <p className="text-xs text-base-content/70">{actionStatusText}</p>
                  </div>
                </div>
              </article>
            </div>

            <article className="card bg-base-100 shadow-sm">
              <div className="card-body p-5">
                <div className="admin-v2-card-head">
                  <h2 className="text-lg font-bold text-primary">{t('sections.brief')}</h2>
                  <button className="btn btn-primary btn-sm" type="button" disabled={!selectedConversationId || savingBrief} onClick={() => void patchBrief()}>
                    {savingBrief ? t('actions.saving') : t('actions.saveBrief')}
                  </button>
                </div>

                {briefBundle.error ? (
                  <div className="alert alert-error text-sm">
                    <span>{briefBundle.error}</span>
                  </div>
                ) : null}

                {briefBundle.loading ? (
                  <div className="admin-skeleton-stack">
                    {Array.from({length: 5}).map((_, idx) => (
                      <div key={idx} className="skeleton h-10 w-full rounded-box" />
                    ))}
                  </div>
                ) : null}

                <div className="admin-v2-form-grid">
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.fullName')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.fullName} onChange={(e) => setBriefDraft((p) => ({...p, fullName: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.email')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.email} onChange={(e) => setBriefDraft((p) => ({...p, email: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.phone')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.phone} onChange={(e) => setBriefDraft((p) => ({...p, phone: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.telegram')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.telegramHandle} onChange={(e) => setBriefDraft((p) => ({...p, telegramHandle: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.serviceType')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.serviceType} onChange={(e) => setBriefDraft((p) => ({...p, serviceType: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.timeline')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.timelineHint} onChange={(e) => setBriefDraft((p) => ({...p, timelineHint: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.budget')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.budgetHint} onChange={(e) => setBriefDraft((p) => ({...p, budgetHint: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.referralSource')}</span>
                    <input className="input input-bordered input-sm" value={briefDraft.referralSource} onChange={(e) => setBriefDraft((p) => ({...p, referralSource: e.target.value}))} suppressHydrationWarning />
                  </label>
                </div>

                <div className="admin-v2-brief-text-grid">
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.firstDeliverable')}</span>
                    <textarea className="textarea textarea-bordered textarea-sm min-h-20" value={briefDraft.firstDeliverable} onChange={(e) => setBriefDraft((p) => ({...p, firstDeliverable: e.target.value}))} suppressHydrationWarning />
                  </label>
                  <label className="form-control gap-1">
                    <span className="label-text text-xs">{t('fields.primaryGoal')}</span>
                    <textarea className="textarea textarea-bordered textarea-sm min-h-24" value={briefDraft.primaryGoal} onChange={(e) => setBriefDraft((p) => ({...p, primaryGoal: e.target.value}))} suppressHydrationWarning />
                  </label>
                </div>
                <label className="form-control gap-1">
                  <span className="label-text text-xs">{t('fields.constraints')}</span>
                  <textarea className="textarea textarea-bordered textarea-sm min-h-20" value={briefDraft.constraints} onChange={(e) => setBriefDraft((p) => ({...p, constraints: e.target.value}))} suppressHydrationWarning />
                </label>
                <label className="form-control gap-1">
                  <span className="label-text text-xs">{t('fields.revisionNote')}</span>
                  <input className="input input-bordered input-sm" value={briefDraft.note} onChange={(e) => setBriefDraft((p) => ({...p, note: e.target.value}))} suppressHydrationWarning />
                </label>

                <div>
                  <strong className="text-sm text-primary">{t('sections.auditLog')}</strong>
                  {(briefBundle.data?.revisions ?? []).length ? (
                    <ul className="timeline timeline-vertical timeline-compact mt-2 max-h-60 overflow-y-auto pr-1">
                      {(briefBundle.data?.revisions ?? []).map((row, index, arr) => (
                        <li key={row.id}>
                          {index > 0 ? <hr /> : null}
                          <div className="timeline-start text-[11px] opacity-75">{fmtDate(row.created_at)}</div>
                          <div className="timeline-middle">
                            <span className="badge badge-primary badge-xs"> </span>
                          </div>
                          <div className="timeline-end timeline-box text-xs">
                            <p className="font-semibold">{row.changed_by_type}</p>
                            <p className="opacity-80">{row.note ?? '-'}</p>
                          </div>
                          {index < arr.length - 1 ? <hr /> : null}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 text-xs opacity-70">{t('common.none')}</p>
                  )}
                </div>
              </div>
            </article>

            <article className="card bg-base-100 shadow-sm">
              <div className="card-body p-5">
                <h2 className="text-lg font-bold text-primary">{t('sections.chatHistory')}</h2>
                {messages.error ? (
                  <div className="alert alert-error text-sm">
                    <span>{messages.error}</span>
                  </div>
                ) : null}
                {messages.loading ? (
                  <div className="admin-skeleton-stack">
                    {Array.from({length: 4}).map((_, idx) => (
                      <div key={idx} className={`skeleton h-12 rounded-box ${idx % 2 === 0 ? 'w-3/4' : 'ml-auto w-2/3'}`} />
                    ))}
                  </div>
                ) : null}
                <div className="admin-chat">
                  {messages.data.map((item) => {
                    const isUser = item.role === 'user';
                    return (
                      <div key={item.id} className={`chat ${isUser ? 'chat-end' : 'chat-start'}`}>
                        <div className="chat-header text-[11px] opacity-70">
                          {item.role}
                          <time className="ml-2">{fmtDate(item.created_at)}</time>
                        </div>
                        <div className={`chat-bubble ${isUser ? 'chat-bubble-primary' : 'chat-bubble-neutral'}`}>{item.content}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </article>
          </section>

          <aside className="admin-v2-side">
            <article className="card bg-base-100 shadow-sm">
              <div className="card-body p-5">
                <h2 className="text-lg font-bold text-primary">{t('sections.clientContext')}</h2>
                {customerContext.error ? (
                  <div className="alert alert-error text-sm">
                    <span>{customerContext.error}</span>
                  </div>
                ) : null}

                {customerContext.loading ? (
                  <div className="admin-skeleton-stack">
                    {Array.from({length: 6}).map((_, idx) => (
                      <div key={idx} className="skeleton h-9 w-full rounded-box" />
                    ))}
                  </div>
                ) : null}

                {customerContext.data?.customer ? (
                  <div className="space-y-4 text-sm">
                    <dl className="admin-kv-grid">
                      <dt>{t('labels.name')}</dt>
                      <dd>{customerContext.data.customer.full_name ?? '-'}</dd>
                      <dt>{t('labels.company')}</dt>
                      <dd>{customerContext.data.customer.company ?? '-'}</dd>
                      <dt>{t('labels.locale')}</dt>
                      <dd>{customerContext.data.customer.locale_pref ?? '-'}</dd>
                      <dt>{t('labels.account')}</dt>
                      <dd>{customerContext.data.customer.account_id ?? '-'}</dd>
                      <dt>{t('fields.referralSource')}</dt>
                      <dd>{customerContext.data.leadBrief?.referralSource ?? '-'}</dd>
                    </dl>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.contacts')}</h3>
                      <dl className="admin-kv-grid text-xs">
                        <dt>{t('labels.primaryEmail')}</dt>
                        <dd>{customerContext.data.contacts?.primaryEmail ?? '-'}</dd>
                        <dt>{t('labels.primaryPhone')}</dt>
                        <dd>{customerContext.data.contacts?.primaryPhone ?? '-'}</dd>
                        <dt>{t('labels.allEmails')}</dt>
                        <dd>{(customerContext.data.contacts?.allEmails ?? []).join(', ') || '-'}</dd>
                        <dt>{t('labels.allPhones')}</dt>
                        <dd>{(customerContext.data.contacts?.allPhones ?? []).join(', ') || '-'}</dd>
                        <dt>{t('labels.capturedEmails')}</dt>
                        <dd>{(customerContext.data.contactsCaptured?.emails ?? []).join(', ') || '-'}</dd>
                        <dt>{t('labels.capturedPhones')}</dt>
                        <dd>{(customerContext.data.contactsCaptured?.phones ?? []).join(', ') || '-'}</dd>
                        <dt>{t('labels.capturedTelegram')}</dt>
                        <dd>{(customerContext.data.contactsCaptured?.telegramHandles ?? []).join(', ') || '-'}</dd>
                      </dl>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.readSummary')}</h3>
                      <div className="stats stats-horizontal w-full border border-base-300 bg-base-100">
                        <div className="stat p-3">
                          <div className="stat-title text-xs">{t('labels.personalUnread')}</div>
                          <div className="stat-value text-lg">{customerContext.data.readStateSummary?.personalUnread ?? 0}</div>
                        </div>
                        <div className="stat p-3">
                          <div className="stat-title text-xs">{t('labels.teamUnread')}</div>
                          <div className="stat-value text-lg">{customerContext.data.readStateSummary?.globalUnread ?? 0}</div>
                        </div>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.technicalSignals')}</h3>
                      {customerContext.data.technicalSignals ? (
                        <>
                          <dl className="admin-kv-grid text-xs">
                            <dt>{t('labels.firstSeen')}</dt>
                            <dd>{fmtDate(customerContext.data.technicalSignals.firstSeenAt)}</dd>
                            <dt>{t('labels.lastSeen')}</dt>
                            <dd>{fmtDate(customerContext.data.technicalSignals.lastSeenAt)}</dd>
                            <dt>{t('labels.lastIp')}</dt>
                            <dd>{customerContext.data.technicalSignals.lastIpMasked ?? '-'}</dd>
                            <dt>{t('labels.lastCountry')}</dt>
                            <dd>{customerContext.data.technicalSignals.lastCountry ?? '-'}</dd>
                            <dt>{t('labels.lastBrowser')}</dt>
                            <dd>{customerContext.data.technicalSignals.lastBrowser ?? '-'}</dd>
                            <dt>{t('labels.lastDevice')}</dt>
                            <dd>{customerContext.data.technicalSignals.lastDeviceType ?? '-'}</dd>
                          </dl>

                          <div className="stats stats-horizontal w-full border border-base-300 bg-base-100">
                            <div className="stat p-3">
                              <div className="stat-title text-xs">{t('labels.uniqueIps90d')}</div>
                              <div className="stat-value text-lg">{customerContext.data.technicalSignals.uniqueIpCount90d}</div>
                            </div>
                            <div className="stat p-3">
                              <div className="stat-title text-xs">{t('labels.uniqueCountries90d')}</div>
                              <div className="stat-value text-lg">{customerContext.data.technicalSignals.uniqueCountryCount90d}</div>
                            </div>
                            <div className="stat p-3">
                              <div className="stat-title text-xs">{t('labels.uniqueDevices90d')}</div>
                              <div className="stat-value text-lg">{customerContext.data.technicalSignals.uniqueDeviceCount90d}</div>
                            </div>
                          </div>

                          <div className="overflow-x-auto rounded-box border border-base-300">
                            <table className="table table-sm">
                              <thead>
                                <tr>
                                  <th>{t('labels.recentIps')}</th>
                                  <th>{t('labels.hits')}</th>
                                  <th>{t('labels.updated')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {customerContext.data.technicalSignals.recentIps.length ? customerContext.data.technicalSignals.recentIps.map((row, index) => (
                                  <tr key={`${row.ipMasked ?? 'unknown'}-${index}`}>
                                    <td>{row.ipMasked ?? '-'}</td>
                                    <td>{row.hits}</td>
                                    <td>{fmtDate(row.lastSeenAt)}</td>
                                  </tr>
                                )) : (
                                  <tr>
                                    <td colSpan={3} className="text-center text-xs opacity-70">{t('common.none')}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          <div className="overflow-x-auto rounded-box border border-base-300">
                            <table className="table table-sm">
                              <thead>
                                <tr>
                                  <th>{t('labels.recentCountries')}</th>
                                  <th>{t('labels.hits')}</th>
                                  <th>{t('labels.updated')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {customerContext.data.technicalSignals.recentCountries.length ? customerContext.data.technicalSignals.recentCountries.map((row, index) => (
                                  <tr key={`${row.countryCode}-${row.region ?? ''}-${row.city ?? ''}-${index}`}>
                                    <td>{[row.countryCode, row.region, row.city].filter(Boolean).join(', ')}</td>
                                    <td>{row.hits}</td>
                                    <td>{fmtDate(row.lastSeenAt)}</td>
                                  </tr>
                                )) : (
                                  <tr>
                                    <td colSpan={3} className="text-center text-xs opacity-70">{t('common.none')}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>

                          <div className="overflow-x-auto rounded-box border border-base-300">
                            <table className="table table-sm">
                              <thead>
                                <tr>
                                  <th>{t('labels.recentAgents')}</th>
                                  <th>{t('labels.hits')}</th>
                                  <th>{t('labels.updated')}</th>
                                </tr>
                              </thead>
                              <tbody>
                                {customerContext.data.technicalSignals.recentAgents.length ? customerContext.data.technicalSignals.recentAgents.map((row, index) => (
                                  <tr key={`${row.browserFamily ?? 'unknown'}-${row.osFamily ?? 'unknown'}-${index}`}>
                                    <td>
                                      {[row.browserFamily, row.browserVersion].filter(Boolean).join(' ') || 'Unknown'} · {row.deviceType}
                                      {row.osFamily ? ` · ${[row.osFamily, row.osVersion].filter(Boolean).join(' ')}` : ''}
                                      {row.isBot ? ' · bot' : ''}
                                    </td>
                                    <td>{row.hits}</td>
                                    <td>{fmtDate(row.lastSeenAt)}</td>
                                  </tr>
                                )) : (
                                  <tr>
                                    <td colSpan={3} className="text-center text-xs opacity-70">{t('common.none')}</td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                        </>
                      ) : (
                        <p className="text-xs opacity-70">{t('common.none')}</p>
                      )}
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.identities')}</h3>
                      <div className="overflow-x-auto rounded-box border border-base-300">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>{t('labels.channel')}</th>
                              <th>{t('labels.id')}</th>
                              <th>{t('labels.details')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {customerContext.data.identities.length ? customerContext.data.identities.map((idn) => (
                              <tr key={idn.id}>
                                <td>{idn.channel}</td>
                                <td>{idn.channel_user_id}</td>
                                <td className="whitespace-normal">
                                  {idn.username ? `@${String(idn.username).replace(/^@/, '')}` : '-'}
                                  {idn.email ? ` · ${idn.email}` : ''}
                                  {idn.phone ? ` · ${idn.phone}` : ''}
                                </td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={3} className="text-center text-xs opacity-70">{t('common.none')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.identityVerification')}</h3>
                      <p className="text-xs">
                        <strong>{t('labels.highestVerification')}:</strong> {customerContext.data.identityVerification?.highestVerification ?? 'unverified'}
                      </p>
                      <div className="overflow-x-auto rounded-box border border-base-300">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>{t('labels.channel')}</th>
                              <th>{t('labels.id')}</th>
                              <th>{t('labels.verification')}</th>
                              <th>{t('labels.source')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(customerContext.data.identityVerification?.items ?? []).length ? (customerContext.data.identityVerification?.items ?? []).map((item) => (
                              <tr key={item.id}>
                                <td>{item.channel}</td>
                                <td>{item.channelUserId}</td>
                                <td>{item.verificationLevel}</td>
                                <td>{item.verificationSource ?? '-'}</td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={4} className="text-center text-xs opacity-70">{t('common.none')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.claims')}</h3>
                      <div className="overflow-x-auto rounded-box border border-base-300">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>{t('labels.status')}</th>
                              <th>{t('labels.value')}</th>
                              <th>{t('labels.source')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(customerContext.data.claims ?? []).slice(0, 20).length ? (customerContext.data.claims ?? []).slice(0, 20).map((claim) => (
                              <tr key={claim.id}>
                                <td>{claim.claim_type} · {claim.claim_status}</td>
                                <td>{claim.normalized_value}</td>
                                <td>{claim.source_channel}</td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={3} className="text-center text-xs opacity-70">{t('common.none')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.mergeAudit')}</h3>
                      <div className="overflow-x-auto rounded-box border border-base-300">
                        <table className="table table-sm">
                          <thead>
                            <tr>
                              <th>{t('labels.updated')}</th>
                              <th>{t('labels.channel')}</th>
                              <th>{t('labels.details')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {(customerContext.data.mergeAudit ?? []).slice(0, 20).length ? (customerContext.data.mergeAudit ?? []).slice(0, 20).map((row) => (
                              <tr key={row.id}>
                                <td>{fmtDate(row.created_at)}</td>
                                <td>{row.trigger_channel}</td>
                                <td>{row.reason}</td>
                              </tr>
                            )) : (
                              <tr>
                                <td colSpan={3} className="text-center text-xs opacity-70">{t('common.none')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </section>

                    <section className="space-y-2">
                      <h3 className="text-sm font-semibold text-primary">{t('sections.memory')}</h3>
                      <p className="rounded-box border border-base-300 bg-base-200/60 p-3 text-xs leading-relaxed">
                        {customerContext.data.memory?.summary ?? '-'}
                      </p>
                    </section>
                  </div>
                ) : null}
              </div>
            </article>
          </aside>
        </section>
      </div>
    </main>
  );
}
