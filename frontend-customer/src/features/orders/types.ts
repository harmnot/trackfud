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
  merchant_name?: string;
  currency: string;
  subtotal: Money;
  delivery_fee: Money;
  service_fee: Money;
  tip: Money;
  total: Money;
  commission: Money;
  size_class: string;
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

/** Live delivery attached to order detail (`delivery` from the same endpoint).
 * `customerPickup` is true once the customer chose to collect the order
 * themselves after no courier was found (the server status reads `cancelled`). */
export type DeliveryInfo = {
  status: string;
  kind: string;
  customerPickup: boolean;
  etaS: number | null;
  routePolyline: string;
  routeWarning: string;
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
    customerPickup: m['customer_pickup'] === true,
    etaS: typeof m['eta_s'] === 'number' ? m['eta_s'] : null,
    routePolyline: typeof m['route_polyline'] === 'string' ? m['route_polyline'] : '',
    routeWarning: typeof m['route_warning'] === 'string' ? m['route_warning'] : '',
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

/** Typed `courier.location` WebSocket frame: the live courier dot the backend
 * sends the customer once per accepted GPS batch while a delivery is active.
 * `position.at` is the server receive time (same clock as `courier_last.at`). */
export type WsCourierLocation = {
  orderId: string;
  deliveryId: string;
  position: CourierPosition;
  heading: number | null;
};

const MAX_LAT_DEG = 90;
const MAX_LNG_DEG = 180;

function isCoord(raw: unknown, maxAbs: number): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && Math.abs(raw) <= maxAbs;
}

/** Narrow an unknown WS payload to a `courier.location` frame: in-range
 * coordinates plus a parseable server timestamp, otherwise null. */
export function parseWsCourierLocation(raw: unknown): WsCourierLocation | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (m['type'] !== 'courier.location') return null;
  if (typeof m['order_id'] !== 'string' || m['order_id'] === '') return null;
  const lat = m['lat'];
  const lng = m['lng'];
  if (!isCoord(lat, MAX_LAT_DEG) || !isCoord(lng, MAX_LNG_DEG)) return null;
  const ts = m['ts'];
  if (typeof ts !== 'string' || Number.isNaN(Date.parse(ts))) return null;
  const heading = m['heading'];
  return {
    orderId: m['order_id'],
    deliveryId: typeof m['delivery_id'] === 'string' ? m['delivery_id'] : '',
    position: { lat, lng, at: ts },
    heading: typeof heading === 'number' && Number.isFinite(heading) ? heading : null,
  };
}

/** Epoch ms of a courier fix; an unparsable time sorts oldest. */
function fixMs(pos: CourierPosition): number {
  const ms = Date.parse(pos.at);
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms;
}

function sameCourier(a: DeliveryCourier | null, b: DeliveryCourier | null): boolean {
  if (!a || !b) return false;
  return a.firstName === b.firstName && a.mode === b.mode;
}

/** Move the cached courier dot to a live WS fix. Returns `detail` itself
 * (nothing to update) when the frame is for another order, no delivery is
 * cached yet (the poll fills it in), or the dot shown is already newer. */
export function applyCourierFix(args: { detail: OrderDetail; fix: WsCourierLocation }): OrderDetail {
  const { detail, fix } = args;
  const delivery = detail.delivery;
  if (detail.order.id !== fix.orderId || !delivery) return detail;
  if (delivery.courierLast && fixMs(delivery.courierLast) > fixMs(fix.position)) return detail;
  return { ...detail, delivery: { ...delivery, courierLast: fix.position } };
}

/** Keep the newer courier dot when a poll response lands after a fresher WS
 * fix, so a slow poll never drags the marker backwards. The server wins when
 * it shares no dot or names a different courier (reassignment). */
export function keepNewerCourierFix(args: { fresh: OrderDetail; cached: OrderDetail | undefined }): OrderDetail {
  const shown = args.cached?.delivery?.courierLast ?? null;
  const delivery = args.fresh.delivery;
  if (!shown || !delivery?.courierLast) return args.fresh;
  if (!sameCourier(args.cached?.delivery?.courier ?? null, delivery.courier)) return args.fresh;
  if (fixMs(shown) <= fixMs(delivery.courierLast)) return args.fresh;
  return { ...args.fresh, delivery: { ...delivery, courierLast: shown } };
}

/** Narrow an unknown order payload to an `Order`. */
export function parseOrder(raw: unknown): Order | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || typeof m['status'] !== 'string') return null;
  if (!(ORDER_STATUSES as readonly string[]).includes(m['status'])) return null;
  return m as unknown as Order;
}
