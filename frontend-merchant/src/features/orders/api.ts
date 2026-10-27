/** Typed order calls for the kitchen (openapi.yaml merchant order paths). */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { OrderEnvelope, OrderList, Order } from './types';

/** List this store's orders, newest first (backend caps at 50). */
export async function listOrders(): Promise<Order[]> {
  try {
    const data = await api<OrderList>('/merchant/orders');
    return data.orders;
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
