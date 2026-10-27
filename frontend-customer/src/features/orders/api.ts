/** Typed calls to the customer order + wallet endpoints (`/v1/customer/...`). */

import { api } from '../../lib/api';
import { logger } from '../../lib/logger';
import {
  parseDeliveryInfo,
  parseOrder,
  parsePayment,
  type DeliveryInfo,
  type Order,
  type OrderDetail,
  type OrderStatus,
  type Payment,
} from './types';

type OrderEnvelope = { order: unknown; refunded?: boolean; payment?: unknown };

function toOrder(envelope: OrderEnvelope, where: string): Order {
  const order = parseOrder(envelope.order);
  if (!order) {
    logger.error('order payload failed validation', { where });
    throw new Error('Unexpected order response from server.');
  }
  return order;
}

function toPayment(raw: unknown, where: string): Payment {
  const payment = parsePayment(raw);
  if (!payment) {
    logger.error('payment payload failed validation', { where });
    throw new Error('Unexpected payment response from server.');
  }
  return payment;
}

type OrderItem = OrderDetail['items'][number];
type OrderEvent = OrderDetail['events'][number];

function toItems(raw: unknown): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderItem[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const m = row as Record<string, unknown>;
    if (typeof m['menu_item_id'] !== 'string' || typeof m['qty'] !== 'number') continue;
    const name = m['name'];
    const unit = m['unit_price'];
    const total = m['line_total'];
    if (typeof name !== 'object' || name === null) continue;
    if (!isMoney(unit) || !isMoney(total)) continue;
    out.push({
      menu_item_id: m['menu_item_id'],
      name: name as Record<string, string>,
      unit_price: unit,
      qty: m['qty'],
      line_total: total,
    });
  }
  return out;
}

function isMoney(raw: unknown): raw is { amount_minor: number; currency: string } {
  if (typeof raw !== 'object' || raw === null) return false;
  const m = raw as Record<string, unknown>;
  return typeof m['amount_minor'] === 'number' && typeof m['currency'] === 'string';
}

function toEvents(raw: unknown): OrderEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderEvent[] = [];
  for (const row of raw) {
    if (typeof row !== 'object' || row === null) continue;
    const m = row as Record<string, unknown>;
    if (typeof m['from'] !== 'string' || typeof m['to'] !== 'string') continue;
    out.push({
      from: m['from'],
      to: m['to'],
      actor: typeof m['actor'] === 'string' ? m['actor'] : (typeof m['actor_type'] === 'string' ? m['actor_type'] : ''),
      at: typeof m['at'] === 'string' ? m['at'] : (typeof m['created_at'] === 'string' ? m['created_at'] : ''),
    });
  }
  return out;
}

function toDelivery(raw: unknown): DeliveryInfo | null {
  return parseDeliveryInfo(raw);
}

type OrderArgs = {
  merchantId: string;
  items: Array<{ menu_item_id: string; qty: number }>;
  addressId?: string;
  lat?: number;
  lng?: number;
  note?: string;
  tipMinor: number;
  idempotencyKey: string;
};

function orderBody(args: OrderArgs, paymentMethod: 'wallet' | 'card'): Record<string, unknown> {
  const body: Record<string, unknown> = {
    merchant_id: args.merchantId,
    items: args.items,
    tip_minor: args.tipMinor,
    payment_method: paymentMethod,
  };
  if (args.addressId) body['address_id'] = args.addressId;
  if (args.lat !== undefined && args.lng !== undefined) {
    body['lat'] = args.lat;
    body['lng'] = args.lng;
  }
  if (args.note) body['note'] = args.note;
  return body;
}

/** Create + wallet-pay an order. Retries reuse the key: never double-charges. */
export async function createWalletOrder(args: OrderArgs): Promise<Order> {
  const res = await api<OrderEnvelope>('/customer/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': args.idempotencyKey },
    body: JSON.stringify(orderBody(args, 'wallet')),
  });
  return toOrder(res, 'createWalletOrder');
}

/** Create a card order (`awaiting_payment` + pending Paddle payment). */
export async function createCardOrder(args: OrderArgs): Promise<{ order: Order; payment: Payment }> {
  const res = await api<OrderEnvelope>('/customer/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': args.idempotencyKey },
    body: JSON.stringify(orderBody(args, 'card')),
  });
  return { order: toOrder(res, 'createCardOrder'), payment: toPayment(res.payment, 'createCardOrder') };
}

/** Fetch one order with items + events + live delivery (all nested under `order`). */
export async function fetchOrder(args: { id: string }): Promise<OrderDetail> {
  const res = await api<{ order: unknown }>(`/customer/orders/${args.id}`);
  const order = parseOrder(res.order);
  if (!order) {
    logger.error('order detail failed validation', { id: args.id });
    throw new Error('Unexpected order response from server.');
  }
  const inner = res.order as Record<string, unknown>;
  return {
    order,
    items: toItems(inner['items']),
    events: toEvents(inner['events']),
    delivery: toDelivery(inner['delivery']),
  };
}

/** List the customer's recent orders (newest first). */
export async function listOrders(): Promise<Order[]> {
  const res = await api<{ orders: unknown }>('/customer/orders');
  if (!Array.isArray(res.orders)) return [];
  const out: Order[] = [];
  for (const raw of res.orders) {
    const order = parseOrder(raw);
    if (order) out.push(order);
  }
  return out;
}

/** Cancel before merchant accept. Returns the updated status + refund flag. */
export async function cancelOrder(args: { id: string }): Promise<{ status: OrderStatus; refunded: boolean }> {
  const res = await api<OrderEnvelope>(`/customer/orders/${args.id}/cancel`, { method: 'POST' });
  const order = toOrder(res, 'cancelOrder');
  return { status: order.status, refunded: res.refunded ?? false };
}

/* ---------- wallet + top-ups (POST /v1/customer/wallet/...) ---------- */

export type WalletBalance = { currency: string; balanceMinor: number };

/** Per-currency wallet balances (minor units, never floats). */
export async function getWallet(): Promise<WalletBalance[]> {
  const res = await api<{ wallets: unknown }>('/customer/wallet');
  if (!Array.isArray(res.wallets)) return [];
  const out: WalletBalance[] = [];
  for (const row of res.wallets) {
    if (typeof row !== 'object' || row === null) continue;
    const balance = (row as Record<string, unknown>)['balance'];
    if (!isMoney(balance)) continue;
    out.push({ currency: balance.currency, balanceMinor: balance.amount_minor });
  }
  return out;
}

/** Start a wallet top-up: a pending Paddle payment the webhook (or demo
 * confirm) credits. Retries reuse the key: never double-charges. */
export async function createTopup(args: {
  amountMinor: number;
  currency: string;
  idempotencyKey: string;
}): Promise<Payment> {
  const res = await api<{ payment: unknown }>('/customer/wallet/topups', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': args.idempotencyKey },
    body: JSON.stringify({ amount_minor: args.amountMinor, currency: args.currency }),
  });
  return toPayment(res.payment, 'createTopup');
}

/** Recent top-ups, newest first. */
export async function listTopups(): Promise<Payment[]> {
  const res = await api<{ topups: unknown }>('/customer/wallet/topups');
  if (!Array.isArray(res.topups)) return [];
  const out: Payment[] = [];
  for (const raw of res.topups) {
    const payment = parsePayment(raw);
    if (payment) out.push(payment);
  }
  return out;
}

/** Demo-mode confirm for a pending payment: runs the same claim-and-apply
 * path as the Paddle webhook. Returns 404 outside demo mode. */
export async function confirmPaymentDemo(args: { paymentId: string }): Promise<{ payment: Payment; order: Order | null }> {
  const res = await api<{ payment: unknown; order?: unknown }>(`/dev/payments/${args.paymentId}/simulate-paid`, {
    method: 'POST',
  });
  const payment = toPayment(res.payment, 'confirmPaymentDemo');
  const order = res.order === undefined ? null : parseOrder(res.order);
  return { payment, order };
}
