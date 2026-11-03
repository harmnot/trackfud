/** Withdrawal review domain (finance queue, B5 money real paths).
 *
 * Wire shape comes from `GET /v1/admin/withdrawals` (`WithdrawalList` in
 * `backend/api/openapi.yaml`): each row carries `id`, `courier_id`,
 * `status`, `amount { amount_minor, currency }`, plus optional
 * `hold_reason` / `failure_reason` / `payout_ref` / `created_at`.
 * All money stays integer minor units; display formatting only divides.
 */

export type WithdrawalStatus =
  | 'pending'
  | 'processing'
  | 'held'
  | 'paid'
  | 'failed'
  | 'cancelled';

export type Withdrawal = {
  id: string;
  courier_id: string;
  status: WithdrawalStatus;
  amount_minor: number;
  currency: string;
  hold_reason: string;
  failure_reason: string;
  payout_ref: string;
  created_at: string;
};

export const WITHDRAWAL_FILTERS = [
  'all',
  'pending',
  'processing',
  'held',
  'paid',
  'failed',
] as const;
export type WithdrawalFilter = (typeof WITHDRAWAL_FILTERS)[number];

/** True when the admin may hold this row (backend 409s anything else). */
export function isHoldable(status: string): boolean {
  return status === 'pending' || status === 'processing';
}

/** True when the admin may release this row back to the payout queue. */
export function isReleasable(status: string): boolean {
  return status === 'held';
}

function isStatus(s: string): s is WithdrawalStatus {
  return (
    s === 'pending' ||
    s === 'processing' ||
    s === 'held' ||
    s === 'paid' ||
    s === 'failed' ||
    s === 'cancelled'
  );
}

function moneyOf(raw: unknown): { amount_minor: number; currency: string } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['amount_minor'] !== 'number' || typeof m['currency'] !== 'string') return null;
  return { amount_minor: m['amount_minor'], currency: m['currency'] };
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/** Parse one wire row; null when the id/status/amount shape is unusable. */
export function parseWithdrawal(raw: unknown): Withdrawal | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || typeof m['courier_id'] !== 'string') return null;
  if (typeof m['status'] !== 'string' || !isStatus(m['status'])) return null;
  const amount = moneyOf(m['amount']);
  if (!amount) return null;
  return {
    id: m['id'],
    courier_id: m['courier_id'],
    status: m['status'],
    amount_minor: amount.amount_minor,
    currency: amount.currency,
    hold_reason: str(m['hold_reason']),
    failure_reason: str(m['failure_reason']),
    payout_ref: str(m['payout_ref']),
    created_at: str(m['created_at']),
  };
}

/** Format integer minor units for display only (never for math). */
export { formatMinor } from '../../lib/format';
