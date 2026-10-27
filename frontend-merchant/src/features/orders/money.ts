/** Pure money helpers: minor-unit formatting and kitchen earnings summaries. */
import type { Order } from './types';
import { isDead } from './types';

/** Format integer minor units in the order's own currency. */
export function formatMinor(params: { amountMinor: number; currency: string }): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: params.currency,
      maximumFractionDigits: params.currency === 'IDR' ? 0 : 2,
    }).format(params.amountMinor / (params.currency === 'IDR' ? 1 : 100));
  } catch {
    return `${String(params.amountMinor)} ${params.currency}`;
  }
}

export interface EarningsTotal {
  currency: string;
  orders: number;
  grossMinor: number;
  commissionMinor: number;
  netMinor: number;
}

export interface WeekBucket {
  weekStart: string;
  currency: string;
  orders: number;
  grossMinor: number;
  netMinor: number;
}

export interface EarningsSummary {
  totals: EarningsTotal[];
  weeks: WeekBucket[];
}

function mondayOf(date: Date): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

/**
 * Summarize settled kitchen earnings from the order list. Refunded and dead
 * orders are excluded; the payout itself is mocked in demo (see note in UI).
 */
export function summarizeEarnings(params: { orders: Order[]; weeks: number }): EarningsSummary {
  const byCurrency = new Map<string, EarningsTotal>();
  const byWeek = new Map<string, WeekBucket & { currency: string }>();
  for (const o of params.orders) {
    if (isDead(o.status) || o.payment_status === 'refunded') continue;
    if (o.status === 'awaiting_payment' || o.status === 'placed') continue;
    const cur = byCurrency.get(o.currency) ?? {
      currency: o.currency,
      orders: 0,
      grossMinor: 0,
      commissionMinor: 0,
      netMinor: 0,
    };
    cur.orders += 1;
    cur.grossMinor += o.subtotal.amount_minor;
    cur.commissionMinor += o.commission.amount_minor;
    cur.netMinor += o.subtotal.amount_minor - o.commission.amount_minor;
    byCurrency.set(o.currency, cur);
    const weekStart = mondayOf(new Date(o.created_at));
    const wk = byWeek.get(weekStart) ?? { weekStart, orders: 0, grossMinor: 0, netMinor: 0, currency: o.currency };
    wk.orders += 1;
    wk.grossMinor += o.subtotal.amount_minor;
    wk.netMinor += o.subtotal.amount_minor - o.commission.amount_minor;
    byWeek.set(weekStart, wk);
  }
  const weeks = [...byWeek.values()]
    .sort((a, b) => (a.weekStart < b.weekStart ? 1 : -1))
    .slice(0, params.weeks)
    .map((w) => ({ weekStart: w.weekStart, currency: w.currency, orders: w.orders, grossMinor: w.grossMinor, netMinor: w.netMinor }));
  return { totals: [...byCurrency.values()], weeks };
}

/** Countdown text to food-ready; empty string when no estimate exists. */
export function readyCountdown(params: { readyAtEst?: string; now: number }): string {
  if (!params.readyAtEst) return '';
  const diffS = Math.round((Date.parse(params.readyAtEst) - params.now) / 1000);
  if (diffS <= 0) return 'due now';
  const mins = Math.floor(diffS / 60);
  if (mins < 1) return `${String(diffS)}s left`;
  return `${String(mins)} min left`;
}
