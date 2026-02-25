'use client';

import {useCallback, useEffect, useMemo, useState} from 'react';
import Link from 'next/link';
import {useTranslations} from 'next-intl';
import {AdminLocaleSwitcher} from '@/components/AdminLocaleSwitcher';

type Outcome = 'won' | 'lost';

type OutcomeItem = {
  outcome: Outcome;
  event: {
    id: string;
    createdAt: string;
    priority: string;
    intentScore: number;
  };
  conversation: {
    id: string;
    channel: string;
    status: string;
    leadIntentScore: number;
    updatedAt: string;
  };
  customer: {
    id: string;
    fullName: string | null;
    company: string | null;
    emails: string[];
    phones: string[];
  };
  brief: {
    serviceType: string | null;
    primaryGoal: string | null;
    firstDeliverable: string | null;
  } | null;
};

type FetchState<T> = {
  loading: boolean;
  error: string | null;
  data: T;
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
};

export function AdminOutcomesDashboard({locale}: Props) {
  const t = useTranslations('Admin');
  const [token, setToken] = useState('');
  const [query, setQuery] = useState('');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | Outcome>('all');
  const [state, setState] = useState<FetchState<OutcomeItem[]>>({loading: true, error: null, data: []});

  const headers = useMemo(() => {
    if (!token.trim()) {
      return undefined;
    }
    return {authorization: `Bearer ${token.trim()}`};
  }, [token]);

  const load = useCallback(async () => {
    setState((prev) => ({...prev, loading: true, error: null}));
    try {
      const params = new URLSearchParams();
      params.set('view', 'outcomes');
      params.set('limit', '300');
      if (outcomeFilter !== 'all') {
        params.set('outcome', outcomeFilter);
      }
      if (query.trim()) {
        params.set('q', query.trim());
      }

      const res = await fetch(`/api/admin/leads?${params.toString()}`, {
        method: 'GET',
        headers,
        cache: 'no-store'
      });
      if (!res.ok) {
        throw new Error(`${res.status} ${res.statusText}: ${await res.text()}`);
      }
      const payload = (await res.json()) as {data: OutcomeItem[]};
      setState({loading: false, error: null, data: payload.data ?? []});
    } catch (error) {
      setState({
        loading: false,
        error: error instanceof Error ? error.message : t('errors.outcomesLoad'),
        data: []
      });
    }
  }, [headers, outcomeFilter, query, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => ({
    won: state.data.filter((item) => item.outcome === 'won').length,
    lost: state.data.filter((item) => item.outcome === 'lost').length
  }), [state.data]);

  return (
    <main className="lp-main">
      <div className="page-shell admin-page-shell admin-shell admin-v2-shell">
        <section className="card bg-base-100 shadow-sm admin-v2-topbar">
          <div className="card-body gap-4 p-5">
            <div className="admin-headline admin-v2-headline">
              <div>
                <h1 className="text-2xl font-black text-primary">{t('outcomes.title')}</h1>
                <p className="text-sm text-base-content/70">{t('outcomes.subtitle')}</p>
              </div>
              <div className="admin-head-actions admin-v2-head-actions">
                <div className="join">
                  <AdminLocaleSwitcher locale={locale} className="join-item" />
                  <button className="btn btn-primary btn-sm join-item" type="button" onClick={() => void load()}>
                    {t('actions.refresh')}
                  </button>
                </div>
              </div>
            </div>

            <div role="tablist" className="tabs tabs-box w-fit">
              <Link role="tab" className="tab" href={`/${locale}/admin`}>
                {t('nav.pipeline')}
              </Link>
              <Link role="tab" className="tab tab-active" href={`/${locale}/admin/outcomes`}>
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
                />
              </label>
              <div className="join admin-v2-filter-join">
                <select className="select select-bordered join-item" value={outcomeFilter} onChange={(event) => setOutcomeFilter(event.target.value as 'all' | Outcome)}>
                  <option value="all">{t('filters.outcomesAll')}</option>
                  <option value="won">{t('status.won')}</option>
                  <option value="lost">{t('status.lost')}</option>
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

        <section className="stats stats-vertical border border-base-300 bg-base-100 shadow-sm lg:stats-horizontal">
          <div className="stat py-4">
            <div className="stat-title">{t('status.won')}</div>
            <div className="stat-value text-success">{stats.won}</div>
          </div>
          <div className="stat py-4">
            <div className="stat-title">{t('status.lost')}</div>
            <div className="stat-value text-warning">{stats.lost}</div>
          </div>
          <div className="stat py-4">
            <div className="stat-title">{t('filters.outcomesAll')}</div>
            <div className="stat-value text-primary">{state.data.length}</div>
          </div>
        </section>

        <section className="card bg-base-100 shadow-sm">
          <div className="card-body p-5">
            {state.error ? (
              <div className="alert alert-error text-sm">
                <span>{state.error}</span>
              </div>
            ) : null}
            {state.loading ? (
              <div className="admin-skeleton-stack">
                {Array.from({length: 8}).map((_, idx) => (
                  <div key={idx} className="skeleton h-32 w-full rounded-box" />
                ))}
              </div>
            ) : null}
            {!state.loading && !state.error && state.data.length === 0 ? (
              <div className="admin-empty-state">
                <p className="text-sm opacity-75">{t('outcomes.empty')}</p>
              </div>
            ) : null}
            <div className="admin-outcomes-grid">
              {state.data.map((item) => (
                <article key={item.event.id} className="card border border-base-300 bg-base-100 shadow-sm">
                  <div className="card-body gap-3 p-4">
                    <div className="admin-outcome-head">
                      <span className={`badge badge-sm ${item.outcome === 'won' ? 'badge-success' : 'badge-warning'}`}>
                        {item.outcome === 'won' ? t('status.won') : t('status.lost')}
                      </span>
                      <span className="badge badge-outline badge-sm">{item.conversation.channel}</span>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <h3 className="text-base font-bold text-primary">{item.customer.fullName ?? t('common.unknown')}</h3>
                      <span className="text-xs opacity-70">{fmtDate(item.event.createdAt)}</span>
                    </div>

                    <dl className="admin-kv-grid text-xs">
                      <dt>{t('labels.company')}</dt>
                      <dd>{item.customer.company ?? '-'}</dd>
                      <dt>{t('labels.score')}</dt>
                      <dd>{item.conversation.leadIntentScore}</dd>
                      <dt>{t('labels.service')}</dt>
                      <dd>{item.brief?.serviceType ?? '-'}</dd>
                      <dt>{t('labels.goal')}</dt>
                      <dd>{item.brief?.primaryGoal ?? '-'}</dd>
                      <dt>{t('labels.primaryEmail')}</dt>
                      <dd>{item.customer.emails[0] ?? '-'}</dd>
                      <dt>{t('labels.primaryPhone')}</dt>
                      <dd>{item.customer.phones[0] ?? '-'}</dd>
                    </dl>

                    <div className="admin-outcome-actions">
                      <Link className="btn btn-outline btn-sm" href={`/${locale}/admin`}>
                        {t('actions.openPipeline')}
                      </Link>
                      <code className="rounded-box bg-base-200 px-2 py-1 text-[11px] opacity-75">{item.conversation.id}</code>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
