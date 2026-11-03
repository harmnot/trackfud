/** Finance queue calls: list + hold + release (`/v1/admin/withdrawals*`).
 *
 * Every row comes from the API — no hardcoded withdrawals. Hold requires a
 * reason (backend 400s without one, 409s a non-pending/processing row);
 * release only accepts a held row.
 */
import { api } from '../../lib/api';
import { parseWithdrawal, type Withdrawal, type WithdrawalFilter } from './types';

/** Scroll page of the finance queue: rows plus the server envelope. */
export type WithdrawalPage = {
  rows: Withdrawal[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

function numOf(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** List the finance queue, newest first; optional `?status=` narrows server-side. */
export async function fetchWithdrawals(args: {
  filter: WithdrawalFilter;
  page: number;
  perPage: number;
}): Promise<WithdrawalPage> {
  const params = new URLSearchParams();
  if (args.filter !== 'all') params.set('status', args.filter);
  params.set('page', String(args.page));
  params.set('per_page', String(args.perPage));
  const d = await api<{ withdrawals: unknown; page: unknown; per_page: unknown; total: unknown; has_more: unknown }>(
    `/admin/withdrawals?${params.toString()}`,
  );
  const rows: Withdrawal[] = [];
  if (Array.isArray(d.withdrawals)) {
    for (const raw of d.withdrawals) {
      const w = parseWithdrawal(raw);
      if (w) rows.push(w);
    }
  }
  return {
    rows,
    page: numOf(d.page, args.page),
    perPage: numOf(d.per_page, args.perPage),
    total: numOf(d.total, rows.length),
    hasMore: d.has_more === true,
  };
}

/** Hold one payout for review: reason is required and audit-logged. */
export async function holdWithdrawal(args: { id: string; reason: string }): Promise<Withdrawal | null> {
  const reason = args.reason.trim();
  if (reason === '') throw new Error('A hold reason is required.');
  const d = await api<{ withdrawal: unknown }>(`/admin/withdrawals/${args.id}/hold`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  return parseWithdrawal(d.withdrawal);
}

/** Release a held payout back to the mock payout queue. */
export async function releaseWithdrawal(args: { id: string }): Promise<void> {
  await api(`/admin/withdrawals/${args.id}/release`, { method: 'POST' });
}
