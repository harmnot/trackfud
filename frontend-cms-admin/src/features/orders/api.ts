/**
 * Order review calls (A7 orders list + detail): queue, detail and refund
 * (`GET /v1/admin/orders*`, `POST .../refund`).
 *
 * Every row comes from the API — no hardcoded orders. Refund requires a
 * reason (backend 400s without one, 409s a non-refundable order); the server
 * stays the decider and the UI refetches after.
 */
import { api } from '../../lib/api';
import {
  parseAdminOrder,
  parseAdminOrderDetail,
  type AdminOrder,
  type AdminOrderDetail,
  type OrderFilter,
} from './types';

/** Scroll page of the CMS order queue: rows plus the server envelope. */
export type AdminOrderPage = {
  rows: AdminOrder[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

function numOf(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** List the CMS order queue, newest first; optional `?status=` narrows server-side. */
export async function fetchAdminOrders(args: {
  filter: OrderFilter;
  q: string;
  page: number;
  perPage: number;
}): Promise<AdminOrderPage> {
  const params = new URLSearchParams();
  if (args.filter !== 'all') params.set('status', args.filter);
  const q = args.q.trim();
  if (q !== '') params.set('q', q);
  params.set('page', String(args.page));
  params.set('per_page', String(args.perPage));
  const d = await api<{ orders: unknown; page: unknown; per_page: unknown; total: unknown; has_more: unknown }>(
    `/admin/orders?${params.toString()}`,
  );
  const rows: AdminOrder[] = [];
  if (Array.isArray(d.orders)) {
    for (const raw of d.orders) {
      const o = parseAdminOrder(raw);
      if (o) rows.push(o);
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

/** Load one order with timeline, chat, proof and money trail. */
export async function fetchAdminOrder(id: string): Promise<AdminOrderDetail | null> {
  const trimmed = id.trim();
  if (trimmed === '') return null;
  const d = await api<{ order: unknown }>(`/admin/orders/${encodeURIComponent(trimmed)}`);
  // The backend serves the detail as an envelope `{"order": {...}}` — pass
  // the whole envelope so the parser sees the nested order view plus the
  // sections. Passing `d.order` alone used to unwrap twice and every detail
  // parsed to null ("not found" on a real order).
  return parseAdminOrderDetail(d);
}

/** Cancel an order with a full support refund. The reason is audit-logged. */
export async function refundAdminOrder(args: { id: string; reason: string }): Promise<AdminOrder | null> {
  const reason = args.reason.trim();
  if (reason === '') throw new Error('A refund reason is required.');
  const d = await api<{ order: unknown }>(`/admin/orders/${args.id}/refund`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });
  // The refund response carries the updated order view; callers refetch the
  // full detail for the fresh timeline.
  return parseAdminOrder(d.order);
}
