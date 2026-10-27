/** Order domain types for the Customer app (mirrors `backend/api/openapi.yaml`). */

export const ORDER_STATUSES = [
  'awaiting_payment',
  'placed',
  'accepted',
  'ready',
  'picked_up',
  'delivered',
  'completed',
  'rejected',
  'cancelled',
] as const;

/** Lifecycle status of a customer order (two linked machines, customer view). */
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Active statuses keep polling + WS live; others are terminal or need no track. */
export function isLiveStatus(status: OrderStatus): boolean {
  return status === 'awaiting_payment' || status === 'placed' || status === 'accepted' ||
    status === 'ready' || status === 'picked_up';
}

/** Integer minor units with ISO-4217 currency; never floats. */
export type Money = { amount_minor: number; currency: string };

/** Dropoff pin from the API. */
export type GeoPoint = { lat: number; lng: number; note?: string };

/** One order as returned by the customer endpoints. */
export type Order = {
  id: string;
  code: string;
  status: OrderStatus;
  merchant_id: string;
  currency: string;
  subtotal: Money;
  delivery_fee: Money;
  service_fee: Money;
  tip: Money;
  total: Money;
  commission: Money;
  size_class: string;
  spill_risk: string;
  payment_method: string;
  payment_status: string;
  dropoff?: GeoPoint;
  delivery_pin?: string;
  ready_at_est: string | null;
  window_start: string | null;
  window_end: string | null;
  created_at: string;
};

/** Full order detail: order + line items + status history + live delivery. */
export type OrderDetail = {
  order: Order;
  delivery: DeliveryInfo | null;
  items: Array<{
    menu_item_id: string;
    name: Record<string, string>;
    unit_price: Money;
    qty: number;
    line_total: Money;
  }>;
  events: Array<{ from: string; to: string; actor: string; at: string }>;
};

/** Paddle payment row backing a wallet top-up or a card order. */
export type Payment = {
  id: string;
  kind: 'topup' | 'order';
  status: 'pending' | 'paid' | 'failed' | 'refunded' | 'cancelled';
  amountMinor: number;
  currency: string;
  orderId: string | null;
  sandboxNote: string | null;
  createdAt: string;
};

/** Narrow an unknown payload to a `Payment`. */
export function parsePayment(raw: unknown): Payment | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string') return null;
  if (m['kind'] !== 'topup' && m['kind'] !== 'order') return null;
  const st = m['status'];
  if (st !== 'pending' && st !== 'paid' && st !== 'failed' && st !== 'refunded' && st !== 'cancelled') return null;
  const amount = m['amount'];
  if (typeof amount !== 'object' || amount === null) return null;
  const am = amount as Record<string, unknown>;
  if (typeof am['amount_minor'] !== 'number' || typeof am['currency'] !== 'string') return null;
  return {
    id: m['id'],
    kind: m['kind'],
    status: st,
    amountMinor: am['amount_minor'],
    currency: am['currency'],
    orderId: typeof m['order_id'] === 'string' ? m['order_id'] : null,
    sandboxNote: typeof m['sandbox_note'] === 'string' ? m['sandbox_note'] : null,
    createdAt: typeof m['created_at'] === 'string' ? m['created_at'] : '',
  };
}

/** Courier as shown to the customer. Null until dispatch assigns one. */
export type CourierInfo = {
  id: string;
  name: string;
  mode: 'runner' | 'biker' | 'staff';
  photo_url?: string;
  rating: number;
  deliveries: number;
  lifetime_km: number;
  weeks: number[];
};

/** Live courier position; present only during an active delivery. */
export type CourierPosition = { lat: number; lng: number; at: string };

/** Public courier profile from `GET /v1/customer/orders/{id}` (`delivery.courier`). */
export type DeliveryCourier = {
  mode: 'runner' | 'biker' | 'staff';
  firstName: string;
  rating: number;
  deliveries: number;
  lifetimeKm: number;
  weeksKm: number[];
};

/** Live delivery attached to order detail (`delivery` from the same endpoint). */
export type DeliveryInfo = {
  status: string;
  kind: string;
  etaS: number | null;
  courier: DeliveryCourier | null;
  courierLast: CourierPosition | null;
};

/** Narrow an unknown `delivery` payload to a `DeliveryInfo`. */
export function parseDeliveryInfo(raw: unknown): DeliveryInfo | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['status'] !== 'string') return null;
  let courier: DeliveryCourier | null = null;
  const c = m['courier'];
  if (typeof c === 'object' && c !== null) {
    const cm = c as Record<string, unknown>;
    const mode = cm['mode'];
    const distM = cm['lifetime_distance_m'];
    const weeks = cm['weeks_8'];
    const weeksKm: number[] = [];
    if (Array.isArray(weeks)) {
      for (const w of weeks) {
        if (typeof w === 'object' && w !== null && typeof (w as Record<string, unknown>)['distance_m'] === 'number') {
          weeksKm.push(((w as Record<string, unknown>)['distance_m'] as number) / 1000);
        }
      }
    }
    courier = {
      mode: mode === 'runner' || mode === 'biker' ? mode : 'staff',
      firstName: typeof cm['first_name'] === 'string' ? cm['first_name'] : '',
      rating: typeof cm['rating'] === 'number' ? cm['rating'] : 0,
      deliveries: typeof cm['deliveries'] === 'number' ? cm['deliveries'] : 0,
      lifetimeKm: typeof distM === 'number' ? distM / 1000 : 0,
      weeksKm,
    };
  }
  let courierLast: CourierPosition | null = null;
  const cl = m['courier_last'];
  if (typeof cl === 'object' && cl !== null) {
    const lm = cl as Record<string, unknown>;
    if (typeof lm['lat'] === 'number' && typeof lm['lng'] === 'number' && typeof lm['at'] === 'string') {
      courierLast = { lat: lm['lat'], lng: lm['lng'], at: lm['at'] };
    }
  }
  return {
    status: m['status'],
    kind: typeof m['type'] === 'string' ? m['type'] : '',
    etaS: typeof m['eta_s'] === 'number' ? m['eta_s'] : null,
    courier,
    courierLast,
  };
}

/** Map a `DeliveryCourier` to the profile card shape (avatar initial fallback). */
export function toCourierInfo(c: DeliveryCourier): CourierInfo {
  return {
    id: '',
    name: c.firstName === '' ? '?' : c.firstName,
    mode: c.mode,
    rating: c.rating,
    deliveries: c.deliveries,
    lifetime_km: c.lifetimeKm,
    weeks: c.weeksKm,
  };
}

/** Client-side price estimate. The server quote is authoritative at pay time. */
export type QuoteEstimate = {
  currency: string;
  subtotalMinor: number;
  deliveryMinor: number;
  serviceMinor: number;
  tipMinor: number;
  totalMinor: number;
  distanceKm: number;
  estimated: true;
};

/** Typed `order.status` WebSocket message after `unknown` narrowing. */
export type WsOrderStatus = { order_id: string; status: OrderStatus };

/** Narrow an unknown WS payload to an `order.status` message. */
export function parseWsOrderStatus(raw: unknown): WsOrderStatus | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['type'] !== 'order.status') return null;
  if (typeof m['order_id'] !== 'string') return null;
  if (typeof m['status'] !== 'string') return null;
  const ok = (ORDER_STATUSES as readonly string[]).includes(m['status']);
  if (!ok) return null;
  return { order_id: m['order_id'], status: m['status'] as OrderStatus };
}

/** Narrow an unknown order payload to an `Order`. */
export function parseOrder(raw: unknown): Order | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || typeof m['status'] !== 'string') return null;
  if (!(ORDER_STATUSES as readonly string[]).includes(m['status'])) return null;
  return m as unknown as Order;
}
