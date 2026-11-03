/**
 * Withdrawals monitor (B5 money real paths, PLAN §4.4 P1): finance review of
 * mock payouts — list by status, hold with a required reason, release back
 * to the queue. All rows come from `GET /v1/admin/withdrawals`; hold/release
 * post to the matching admin endpoints and refetch from the server.
 *
 * Responsive: cards stack 1-col on phones (≤720px), 2-col on tablets, and a
 * roomier 2-col grid on desktop — same `tb-grid-2` language as review detail.
 */
import { useState } from 'react';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { formatValue, MISSING } from '../../lib/format';
import { Button, Dropdown, Item, List, LoadMore, Note, Page, StatusBadge } from '../../components/ui';
import { IdValue } from '../detail/fields';
import {
  fetchWithdrawals,
  holdWithdrawal,
  releaseWithdrawal,
} from './api';
import {
  formatMinor,
  WITHDRAWAL_FILTERS,
  isHoldable,
  isReleasable,
  type Withdrawal,
  type WithdrawalFilter,
} from './types';

const PAGE_SIZE = 10;

export function WithdrawalsPage() {
  const [filter, setFilter] = useState<WithdrawalFilter>('all');
  const q = useInfiniteQuery({
    queryKey: ['admin', 'withdrawals', filter],
    queryFn: ({ pageParam }) => fetchWithdrawals({ filter, page: pageParam, perPage: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
    retry: (n, e) => !(e instanceof ApiError && e.status === 404) && n < 1,
  });

  const rows = q.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = q.data?.pages[0]?.total;

  return (
    <Page>
      <h1 className="tb-display">Withdrawals</h1>
      <p className="tb-sub">
        Mock payouts from courier earnings. Hold a payout to freeze it for review, release it back
        to the queue. Money moves only through the audited API — never from this screen directly.
      </p>

      <div className="tb-toolbar">
        <Dropdown
          label="Withdrawal status filter"
          value={filter}
          options={WITHDRAWAL_FILTERS.map((s) => ({
            value: s,
            label: s === 'all' ? 'All statuses' : s,
          }))}
          onChange={(v) => setFilter(v as WithdrawalFilter)}
        />
        <span className="tb-count">
          {q.isLoading ? '…' : `${rows.length}${total !== undefined ? ` of ${total}` : ''} shown`}
        </span>
      </div>

      {q.isLoading && (
        <List>
          {[0, 1, 2].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 120 }} />
            </Item>
          ))}
        </List>
      )}
      {q.isError && (
        <Note tone="error">
          Could not load withdrawals ({q.error instanceof Error ? q.error.message : 'unknown error'}).{' '}
          <button className="tb-link" onClick={() => void q.refetch()}>
            Retry
          </button>
        </Note>
      )}
      {!q.isLoading && !q.isError && rows.length === 0 && (
        <Note tone="info">No withdrawals in this state.</Note>
      )}
      <div className="tb-grid-2 mt-3">
        {rows.map((w) => (
          <WithdrawalCard key={w.id} w={w} />
        ))}
      </div>
      {!q.isLoading && (
        <LoadMore
          hasMore={q.hasNextPage ?? false}
          loading={q.isFetchingNextPage}
          label="Load more withdrawals"
          onLoad={() => void q.fetchNextPage()}
        />
      )}
    </Page>
  );
}

function WithdrawalCard({ w }: { w: Withdrawal }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  async function refresh() {
    await qc.invalidateQueries({ queryKey: ['admin', 'withdrawals'] });
  }

  async function onHold() {
    setErr('');
    setDone('');
    if (reason.trim() === '') {
      setErr('A hold reason is required.');
      return;
    }
    setBusy(true);
    try {
      // Server is the decider: 409 when the row already moved on.
      await holdWithdrawal({ id: w.id, reason: reason.trim() });
      setDone('Held for review. The debit was reversed into earnings.');
      setReason('');
      await refresh();
    } catch (e) {
      logger.warn('hold withdrawal failed', {});
      setErr(e instanceof Error ? e.message : 'Hold failed.');
    } finally {
      setBusy(false);
    }
  }

  async function onRelease() {
    setErr('');
    setDone('');
    setBusy(true);
    try {
      await releaseWithdrawal({ id: w.id });
      setDone('Released back to the payout queue.');
      await refresh();
    } catch (e) {
      logger.warn('release withdrawal failed', {});
      setErr(e instanceof Error ? e.message : 'Release failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="tb-card">
      <h2 className="tb-h2">{formatMinor(w.amount_minor, w.currency)}</h2>
      <p className="tb-sub tb-tight">
        <StatusBadge status={w.status} />
      </p>
      <dl className="tb-kv mt-3">
        <div className="tb-kv-row">
          <dt>Withdrawal</dt>
          <dd>
            <IdValue id={w.id} label="withdrawal ID" />
          </dd>
        </div>
        <div className="tb-kv-row">
          <dt>Courier</dt>
          <dd>
            <IdValue id={w.courier_id} label="courier ID" />
          </dd>
        </div>
        {w.payout_ref !== '' && (
          <div className="tb-kv-row">
            <dt>Payout ref</dt>
            <dd>{formatValue(w.payout_ref)}</dd>
          </div>
        )}
        {w.hold_reason !== '' && (
          <div className="tb-kv-row">
            <dt>Hold reason</dt>
            <dd>{formatValue(w.hold_reason)}</dd>
          </div>
        )}
        {w.failure_reason !== '' && (
          <div className="tb-kv-row">
            <dt>Failure</dt>
            <dd>{formatValue(w.failure_reason)}</dd>
          </div>
        )}
        <div className="tb-kv-row">
          <dt>Created</dt>
          <dd>{w.created_at !== '' ? formatValue(w.created_at) : MISSING}</dd>
        </div>
      </dl>

      {isHoldable(w.status) && (
        <div className="mt-3">
          <label>
            <span className="tb-label">Hold reason (required, audit-logged)</span>
            <input
              className="tb-input"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. duplicate payout suspected"
              aria-label="Hold reason"
              minLength={1}
            />
          </label>
          <div className="tb-actions">
            <Button variant="soft" small disabled={busy} onClick={() => void onHold()}>
              {busy ? '…' : 'Hold'}
            </Button>
          </div>
        </div>
      )}
      {isReleasable(w.status) && (
        <div className="tb-actions">
          <Button variant="clay" small disabled={busy} onClick={() => void onRelease()}>
            {busy ? '…' : 'Release'}
          </Button>
        </div>
      )}
      {err !== '' && (
        <div className="mt-2">
          <Note tone="error">{err}</Note>
        </div>
      )}
      {done !== '' && (
        <div className="mt-2">
          <Note tone="info">{done}</Note>
        </div>
      )}
    </div>
  );
}
