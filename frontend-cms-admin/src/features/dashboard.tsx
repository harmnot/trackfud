import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError, api } from '../lib/api';
import { logger } from '../lib/logger';
import type { CourierApplication, MerchantRecord, StatusFilter } from '../lib/types';
import { STATUS_FILTERS } from '../lib/types';
import { Dropdown, Item, List, Note, Page, StatusBadge, faceColor } from '../components/ui';

async function fetchCouriers(status: StatusFilter): Promise<CourierApplication[]> {
  const q = status === 'all' ? '' : `?status=${status}`;
  const d = await api<{ applications: CourierApplication[] }>(`/admin/courier-applications${q}`);
  return d.applications;
}

/**
 * Merchant review queue served by GET /v1/admin/merchants. A 404
 * degrades to an empty queue with a notice instead of hardcoded rows.
 */
export async function fetchMerchants(status: StatusFilter): Promise<{ rows: MerchantRecord[]; unavailable: boolean }> {
  const q = status === 'all' ? '' : `?status=${status}`;
  try {
    const d = await api<{ merchants: MerchantRecord[] }>(`/admin/merchants${q}`);
    return { rows: d.merchants, unavailable: false };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      logger.warn('admin merchants endpoint missing', {});
      return { rows: [], unavailable: true };
    }
    throw e;
  }
}

function counts(rows: Array<{ status: string }>): Record<string, number> {
  const c: Record<string, number> = { all: rows.length, pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) {
    if (r.status in c) c[r.status] = (c[r.status] as number) + 1;
  }
  return c;
}

/** Dashboard: courier + merchant queues with status filters. All rows come from the API. */
export function Dashboard() {
  const [tab, setTab] = useState<'couriers' | 'merchants'>('couriers');
  const [filter, setFilter] = useState<StatusFilter>('pending');

  const couriers = useQuery({
    queryKey: ['admin', 'couriers', filter],
    queryFn: () => fetchCouriers(filter),
    enabled: tab === 'couriers',
  });
  const merchants = useQuery({
    queryKey: ['admin', 'merchants', filter],
    queryFn: () => fetchMerchants(filter),
    enabled: tab === 'merchants',
  });

  const cRows = couriers.data ?? [];
  const mRows = merchants.data?.rows ?? [];
  const cc = counts(cRows);
  const mc = counts(mRows);

  return (
    <Page>
      <h1 className="tb-display">Partner review</h1>
      <p className="tb-sub">Approve or reject courier applications and merchant partnerships.</p>

      <div className="tb-tabs" role="tablist" aria-label="Review queues">
        {(['couriers', 'merchants'] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            className="tb-tab"
            onClick={() => setTab(t)}
          >
            {t === 'couriers' ? 'Couriers' : 'Merchants'}
          </button>
        ))}
      </div>

      <div className="tb-toolbar">
        <Dropdown
          label="Status filter"
          value={filter}
          options={STATUS_FILTERS.map((s) => ({ value: s, label: s === 'all' ? 'All statuses' : s }))}
          onChange={(v) => setFilter(v as StatusFilter)}
        />
        <span className="tb-count">
          {(tab === 'couriers' ? cc[filter] : mc[filter]) ?? 0} shown
        </span>
      </div>

      {tab === 'couriers' ? (
        <CourierList state={couriers} rows={cRows} />
      ) : (
        <MerchantList state={merchants} rows={mRows} unavailable={merchants.data?.unavailable ?? false} />
      )}
    </Page>
  );
}

type Q<T> = { isLoading: boolean; isError: boolean; error: unknown; refetch: () => void };

function Retry({ onRetry }: { onRetry: () => void }) {
  return (
    <button className="tb-link" onClick={onRetry}>
      Retry
    </button>
  );
}

function CourierList({ state, rows }: { state: Q<CourierApplication[]>; rows: CourierApplication[] }) {
  if (state.isLoading) {
    return (
      <List>
        {[0, 1, 2].map((i) => (
          <Item key={i} index={i}>
            <div className="tb-skel" style={{ height: 76 }} />
          </Item>
        ))}
      </List>
    );
  }
  if (state.isError) {
    return (
      <Note tone="error">
        Could not load courier applications ({state.error instanceof Error ? state.error.message : 'unknown error'}).{' '}
        <Retry onRetry={state.refetch} />
      </Note>
    );
  }
  if (rows.length === 0) return <Note tone="info">No courier applications in this state.</Note>;
  return (
    <List>
      {rows.map((a, i) => (
        <Item key={a.user_id} index={i}>
          <Link to={`/couriers/${a.user_id}`} className="tb-person" style={{ textDecoration: 'none', color: 'inherit' }}>
            <span className="tb-face" style={{ background: faceColor(a.email) }} aria-hidden>
              {a.email.slice(0, 1).toUpperCase()}
            </span>
            <span className="tb-person-main">
              <span className="tb-person-name">{a.email}</span>
              <span className="tb-person-sub">
                {a.mode} · fitness {a.fitness.passed ? 'passed' : 'not passed'} · {a.fitness.checkpoints} checkpoints
              </span>
            </span>
            <StatusBadge status={a.status} />
          </Link>
        </Item>
      ))}
    </List>
  );
}

function MerchantList({
  state,
  rows,
  unavailable,
}: {
  state: Q<{ rows: MerchantRecord[]; unavailable: boolean }>;
  rows: MerchantRecord[];
  unavailable: boolean;
}) {
  if (state.isLoading) {
    return (
      <List>
        {[0, 1, 2].map((i) => (
          <Item key={i} index={i}>
            <div className="tb-skel" style={{ height: 76 }} />
          </Item>
        ))}
      </List>
    );
  }
  if (state.isError) {
    return (
      <Note tone="error">
        Could not load merchants ({state.error instanceof Error ? state.error.message : 'unknown error'}).{' '}
        <Retry onRetry={state.refetch} />
      </Note>
    );
  }
  return (
    <>
      {unavailable && (
        <Note tone="info">
          The admin merchant review endpoint is not available on this backend yet — courier review below is live, and
          merchant rows will appear here once GET /v1/admin/merchants ships.
        </Note>
      )}
      {rows.length === 0 && !unavailable && <Note tone="info">No merchants in this state.</Note>}
      <List>
        {rows.map((m, i) => (
          <Item key={m.id} index={i}>
            <Link to={`/merchants/${m.id}`} className="tb-person" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="tb-face" style={{ background: faceColor(m.name) }} aria-hidden>
                {m.name.slice(0, 1).toUpperCase()}
              </span>
              <span className="tb-person-main">
                <span className="tb-person-name">{m.name}</span>
                <span className="tb-person-sub">
                  {[m.country, m.currency].filter(Boolean).join(' · ') || 'merchant'}
                </span>
              </span>
              <StatusBadge status={m.status} />
            </Link>
          </Item>
        ))}
      </List>
    </>
  );
}
