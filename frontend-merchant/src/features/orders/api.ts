/** Typed order calls for the kitchen (openapi.yaml merchant order paths). */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { OrderEnvelope, Order, OrderStatus } from './types';

/** Scroll page of the kitchen queue: rows plus the server envelope. */
export type OrderPage = {
  orders: Order[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

function numOf(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

/** List this store's orders, newest first, scroll-paginated (10 per page). */
export async function listOrders(args: {
  page: number;
  perPage: number;
  status?: OrderStatus;
  q?: string;
}): Promise<OrderPage> {
  try {
    const params = new URLSearchParams();
    if (args.status) params.set('status', args.status);
    const q = (args.q ?? '').trim();
    if (q !== '') params.set('q', q);
    params.set('page', String(args.page));
    params.set('per_page', String(args.perPage));
    const data = await api<{
      orders: unknown;
      page: unknown;
      per_page: unknown;
      total: unknown;
      has_more: unknown;
    }>(`/merchant/orders?${params.toString()}`);
    const orders = Array.isArray(data.orders) ? (data.orders as Order[]) : [];
    return {
      orders,
      page: numOf(data.page, args.page),
      perPage: numOf(data.per_page, args.perPage),
      total: numOf(data.total, orders.length),
      hasMore: data.has_more === true,
    };
  } catch (e) {
    logger.warn('listOrders failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/**
 * Accept a placed order. The backend reads the store's saved `prep_minutes`
 * for `ready_at_est`, so callers must persist prep time first (see
 * `setPrepMinutes` in the menu feature).
 */
export async function acceptOrder(params: { id: string }): Promise<OrderEnvelope> {
  try {
    return await api<OrderEnvelope>(`/merchant/orders/${params.id}/accept`, { method: 'POST' });
  } catch (e) {
    logger.warn('acceptOrder failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Reject a placed order; the customer is refunded in full automatically. */
export async function rejectOrder(params: { id: string; reason: string }): Promise<OrderEnvelope> {
  try {
    return await api<OrderEnvelope>(`/merchant/orders/${params.id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.reason ? { reason: params.reason } : {}),
    });
  } catch (e) {
    logger.warn('rejectOrder failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Mark an accepted order as ready; nudges the assigned courier at once. */
export async function readyOrder(params: { id: string }): Promise<OrderEnvelope> {
  try {
    return await api<OrderEnvelope>(`/merchant/orders/${params.id}/ready`, { method: 'POST' });
  } catch (e) {
    logger.warn('readyOrder failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/**
 * Cancel an accepted/ready order before pickup. The backend refunds the
 * customer in full, cancels the delivery so the courier can no longer pick
 * up, and pushes notices to both sides.
 */
export async function cancelMerchantOrder(params: { id: string; reason: string }): Promise<OrderEnvelope> {
  try {
    return await api<OrderEnvelope>(`/merchant/orders/${params.id}/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params.reason ? { reason: params.reason } : {}),
    });
  } catch (e) {
    logger.warn('cancelMerchantOrder failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}
