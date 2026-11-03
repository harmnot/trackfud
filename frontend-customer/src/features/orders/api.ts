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

/** Scroll page of the customer's order history: rows plus the server envelope. */
export type OrderListPage = {
  orders: Order[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

/** Scroll page of wallet top-ups: rows plus the server envelope. */
export type TopupPage = {
  topups: Payment[];
  page: number;
  perPage: number;
  total: number;
  hasMore: boolean;
};

function numOf(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 ? raw : fallback;
}

function pageParams(params: URLSearchParams, args: { page: number; perPage: number }): void {
  params.set('page', String(args.page));
  params.set('per_page', String(args.perPage));
}

/** List the customer's recent orders, scroll-paginated newest first. */
export async function listOrders(args: {
  page: number;
  perPage: number;
  status?: OrderStatus;
  q?: string;
}): Promise<OrderListPage> {
  const params = new URLSearchParams();
  if (args.status) params.set('status', args.status);
  const q = (args.q ?? '').trim();
  if (q !== '') params.set('q', q);
  pageParams(params, args);
  const res = await api<{
    orders: unknown;
    page: unknown;
    per_page: unknown;
    total: unknown;
    has_more: unknown;
  }>(`/customer/orders?${params.toString()}`);
  const orders: Order[] = [];
  if (Array.isArray(res.orders)) {
    for (const raw of res.orders) {
      const order = parseOrder(raw);
      if (order) orders.push(order);
    }
  }
  return {
    orders,
    page: numOf(res.page, args.page),
    perPage: numOf(res.per_page, args.perPage),
    total: numOf(res.total, orders.length),
    hasMore: res.has_more === true,
  };
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

/** Recent top-ups, scroll-paginated newest first. */
export async function listTopups(args: { page: number; perPage: number }): Promise<TopupPage> {
  const params = new URLSearchParams();
  pageParams(params, args);
  const res = await api<{
    topups: unknown;
    page: unknown;
    per_page: unknown;
    total: unknown;
    has_more: unknown;
  }>(`/customer/wallet/topups?${params.toString()}`);
  const topups: Payment[] = [];
  if (Array.isArray(res.topups)) {
    for (const raw of res.topups) {
      const payment = parsePayment(raw);
      if (payment) topups.push(payment);
    }
  }
  return {
    topups,
    page: numOf(res.page, args.page),
    perPage: numOf(res.per_page, args.perPage),
    total: numOf(res.total, topups.length),
    hasMore: res.has_more === true,
  };
}

/** FX conversion preview for the top-up form: what Paddle will charge when
 * the wallet currency is not directly chargeable (e.g. IDR → USD). The
 * server computes the converted minor units — the PWA never duplicates the
 * minor-unit scales. Returns null when the pair has no rate. */
export async function getFxPreview(args: {
  from: string;
  to: string;
  amountMinor: number;
}): Promise<{ rate: number; convertedMinor: number; convertedCurrency: string } | null> {
  const params = new URLSearchParams({
    from: args.from,
    to: args.to,
    amount: String(args.amountMinor),
  });
  try {
    const res = await api<{
      rate: unknown;
      paddle_supported_from: unknown;
      paddle_supported_to: unknown;
      converted: unknown;
    }>(`/fx/rate?${params.toString()}`);
    if (typeof res.rate !== 'number') return null;
    if (res.paddle_supported_from !== false || res.paddle_supported_to !== true) return null;
    const c = res.converted as Record<string, unknown> | null;
    if (!c || typeof c['converted_minor'] !== 'number' || typeof c['converted_currency'] !== 'string') return null;
    return { rate: res.rate, convertedMinor: c['converted_minor'] as number, convertedCurrency: c['converted_currency'] as string };
  } catch (err) {
    logger.warn('fx preview unavailable', { err: err instanceof Error ? err.message : 'unknown' });
    return null;
  }
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

/** Mint a Paddle transaction for a pending payment (preferred card path).
 * The PWA opens the overlay with the returned transaction id. Without a
 * server Paddle API key this is 503 — callers fall back to demo confirm. */
export async function createPaymentCheckout(args: { paymentId: string }): Promise<{ transactionId: string; paddleEnv: string; payment: Payment }> {
  const res = await api<{ transaction_id: unknown; paddle_env: unknown; payment: unknown }>(
    `/customer/payments/${args.paymentId}/checkout`,
    { method: 'POST' },
  );
  const transactionId = typeof res.transaction_id === 'string' ? res.transaction_id : '';
  if (!transactionId) {
    logger.error('payment checkout missing transaction id', { payment: args.paymentId });
    throw new Error('Unexpected checkout response from server.');
  }
  const paddleEnv = typeof res.paddle_env === 'string' ? res.paddle_env : 'sandbox';
  return { transactionId, paddleEnv, payment: toPayment(res.payment, 'createPaymentCheckout') };
}

/** One payment owned by the caller. Poll after the overlay closes — the
 * webhook confirms asynchronously. */
export async function fetchPayment(args: { id: string }): Promise<Payment> {
  const res = await api<{ payment: unknown }>(`/customer/payments/${args.id}`);
  return toPayment(res.payment, 'fetchPayment');
}
