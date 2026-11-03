import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { ApiError, api } from '../lib/api';
import { logger } from '../lib/logger';
import type { CourierApplication, MerchantRecord, StatusFilter } from '../lib/types';
import { STATUS_FILTERS } from '../lib/types';
import { Dropdown, Item, List, LoadMore, Note, Page, StatusBadge, TextInput, faceColor, useDebouncedValue } from '../components/ui';

const PAGE_SIZE = 10;

function numOf(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function pageParams(q: URLSearchParams, args: { page: number; perPage: number }): void {
  q.set('page', String(args.page));
  q.set('per_page', String(args.perPage));
}

type QueuePage<T> = {
  rows: T[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

async function fetchCouriers(args: {
  status: StatusFilter;
  q: string;
  page: number;
  perPage: number;
}): Promise<QueuePage<CourierApplication>> {
  const params = new URLSearchParams();
  if (args.status !== 'all') params.set('status', args.status);
  const q = args.q.trim();
  if (q !== '') params.set('q', q);
  pageParams(params, args);
  const d = await api<{ applications: unknown; page: unknown; per_page: unknown; total: unknown; has_more: unknown }>(
    `/admin/courier-applications?${params.toString()}`,
  );
  const rows = Array.isArray(d.applications) ? (d.applications as CourierApplication[]) : [];
  return {
    rows,
    page: numOf(d.page, args.page),
    perPage: numOf(d.per_page, args.perPage),
    total: numOf(d.total, rows.length),
    hasMore: d.has_more === true,
  };
}

/**
 * Merchant review queue served by GET /v1/admin/merchants. A 404
 * degrades to an empty queue with a notice instead of hardcoded rows.
 */
export async function fetchMerchants(args: {
  status: StatusFilter;
  q: string;
  page: number;
  perPage: number;
}): Promise<QueuePage<MerchantRecord> & { unavailable: boolean }> {
  const params = new URLSearchParams();
  if (args.status !== 'all') params.set('status', args.status);
  const q = args.q.trim();
  if (q !== '') params.set('q', q);
  pageParams(params, args);
  try {
    const d = await api<{ merchants: unknown; page: unknown; per_page: unknown; total: unknown; has_more: unknown }>(
      `/admin/merchants?${params.toString()}`,
    );
    const rows = Array.isArray(d.merchants) ? (d.merchants as MerchantRecord[]) : [];
    return {
      rows,
      unavailable: false,
      page: numOf(d.page, args.page),
      perPage: numOf(d.per_page, args.perPage),
      total: numOf(d.total, rows.length),
      hasMore: d.has_more === true,
    };
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      logger.warn('admin merchants endpoint missing', {});
      return { rows: [], unavailable: true, page: args.page, perPage: args.perPage, total: 0, hasMore: false };
    }
    throw e;
  }
}

/** Dashboard: courier + merchant queues with status filters. All rows come from the API. */
export function Dashboard() {
  const [tab, setTab] = useState<'couriers' | 'merchants'>('couriers');
  // Default to "All Status" so reviewers see the full queue on first load;
  // the filter narrows from there.
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 300);

  const couriers = useInfiniteQuery({
    queryKey: ['admin', 'couriers', filter, q],
    queryFn: ({ pageParam }) => fetchCouriers({ status: filter, q, page: pageParam, perPage: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: tab === 'couriers',
  });
  const merchants = useInfiniteQuery({
    queryKey: ['admin', 'merchants', filter, q],
    queryFn: ({ pageParam }) => fetchMerchants({ status: filter, q, page: pageParam, perPage: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    enabled: tab === 'merchants',
  });

  const cRows = couriers.data?.pages.flatMap((p) => p.rows) ?? [];
  const mPage = merchants.data?.pages[0];
  const mRows = merchants.data?.pages.flatMap((p) => p.rows) ?? [];
  const cTotal = couriers.data?.pages[0]?.total;
  const mTotal = mPage?.total;
  const shown = tab === 'couriers' ? cRows.length : mRows.length;
  const total = tab === 'couriers' ? cTotal : mTotal;

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
        <TextInput
          aria-label={tab === 'couriers' ? 'Search couriers by email' : 'Search merchants by name or email'}
          placeholder={tab === 'couriers' ? 'Search courier email…' : 'Search name or email…'}
          value={search}
          onChange={setSearch}
        />
        <span className="tb-count">
          {tab === 'couriers'
            ? couriers.isLoading
              ? '…'
              : `${shown}${total !== undefined ? ` of ${total}` : ''} shown`
            : merchants.isLoading
              ? '…'
              : `${shown}${total !== undefined ? ` of ${total}` : ''} shown`}
        </span>
      </div>

      {tab === 'couriers' ? (
        <CourierList
          isLoading={couriers.isLoading}
          isError={couriers.isError}
          error={couriers.error}
          onRetry={() => void couriers.refetch()}
          rows={cRows}
          hasMore={couriers.hasNextPage ?? false}
          loadingMore={couriers.isFetchingNextPage}
          onLoadMore={() => void couriers.fetchNextPage()}
        />
      ) : (
        <MerchantList
          isLoading={merchants.isLoading}
          isError={merchants.isError}
          error={merchants.error}
          onRetry={() => void merchants.refetch()}
          rows={mRows}
          unavailable={merchants.data?.pages[0]?.unavailable ?? false}
          hasMore={merchants.hasNextPage ?? false}
          loadingMore={merchants.isFetchingNextPage}
          onLoadMore={() => void merchants.fetchNextPage()}
        />
      )}
    </Page>
  );
}

function Retry({ onRetry }: { onRetry: () => void }) {
  return (
    <button className="tb-link" onClick={onRetry}>
      Retry
    </button>
  );
}

/** One-line courier summary that tolerates a missing fitness payload. */
function courierSub(a: CourierApplication): string {
  const fitness = a.fitness;
  if (!fitness) return `${a.mode ?? 'courier'} · fitness unknown`;
  const verdict = fitness.passed ? 'passed' : 'not passed';
  const points = typeof fitness.checkpoints === 'number' && fitness.checkpoints > 0 ? ` · ${fitness.checkpoints} checkpoints` : '';
  return `${a.mode} · fitness ${verdict}${points}`;
}

/** Sanctions override the review state in the queue: a frozen courier's
 * application still reads approved, so the badge shows the standing. */
function queueStatus(a: CourierApplication): string {
  return a.standing === 'frozen' || a.standing === 'banned' ? a.standing : a.status;
}

function CourierList({
  isLoading,
  isError,
  error,
  onRetry,
  rows,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  rows: CourierApplication[];
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (isLoading) {
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
  if (isError) {
    return (
      <Note tone="error">
        Could not load courier applications ({error instanceof Error ? error.message : 'unknown error'}).{' '}
        <Retry onRetry={onRetry} />
      </Note>
    );
  }
  if (rows.length === 0) return <Note tone="info">No courier applications in this state.</Note>;
  return (
    <>
      <List>
        {rows.map((a, i) => (
          <Item key={a.user_id} index={i}>
            <Link to={`/couriers/${a.user_id}`} className="tb-person" style={{ textDecoration: 'none', color: 'inherit' }}>
              <span className="tb-face" style={{ background: faceColor(a.email ?? '?') }} aria-hidden>
                {(a.email ?? '?').slice(0, 1).toUpperCase()}
              </span>
              <span className="tb-person-main">
                <span className="tb-person-name">{a.email}</span>
                <span className="tb-person-sub">{courierSub(a)}</span>
              </span>
              <StatusBadge status={queueStatus(a)} />
            </Link>
          </Item>
        ))}
      </List>
      <LoadMore hasMore={hasMore} loading={loadingMore} label="Load more applications" onLoad={onLoadMore} />
    </>
  );
}

function MerchantList({
  isLoading,
  isError,
  error,
  onRetry,
  rows,
  unavailable,
  hasMore,
  loadingMore,
  onLoadMore,
}: {
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  onRetry: () => void;
  rows: MerchantRecord[];
  unavailable: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
}) {
  if (isLoading) {
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
  if (isError) {
    return (
      <Note tone="error">
        Could not load merchants ({error instanceof Error ? error.message : 'unknown error'}).{' '}
        <Retry onRetry={onRetry} />
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
      {!unavailable && (
        <LoadMore hasMore={hasMore} loading={loadingMore} label="Load more merchants" onLoad={onLoadMore} />
      )}
    </>
  );
}
