/** Order shapes for live kitchen operations (mirrors backend/api/openapi.yaml). */

export type OrderStatus =
  | 'awaiting_payment'
  | 'placed'
  | 'accepted'
  | 'ready'
  | 'picked_up'
  | 'delivered'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export interface Money {
  amount_minor: number;
  currency: string;
}

/**
 * Live dispatch detail attached to an order (openapi.yaml `Order.delivery`).
 * Merchant list rows carry the light `{status, eta_s}` line plus the assigned
 * courier's public first name + mode once someone accepts (both null while
 * dispatch is still searching); order detail (`GET /v1/merchant/orders/{id}`)
 * carries the full view with route and courier profile. Absent before
 * dispatch creates the delivery — the courier line then falls back to the
 * order status (see `courierLine`).
 */
export interface OrderDelivery {
  status?: string;
  eta_s?: number | null;
  courier_name?: string | null;
  courier_mode?: string | null;
  courierName?: string | null;
  courierMode?: string | null;
}

export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  merchant_id: string;
  delivery?: OrderDelivery | null;
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
  dropoff?: { lat: number; lng: number; note?: string };
  /** Merchant handover code (merchant view only). Empty until accepted. */
  pickup_code?: string;
  ready_at_est?: string;
  window_start?: string;
  window_end?: string;
  cancel_reason?: string;
  created_at: string;
}

export interface OrderEnvelope {
  order: Order;
  refunded?: boolean;
}

export interface OrderList {
  orders: Order[];
}

/** Orders the kitchen can act on right now. */
export function isIncoming(status: OrderStatus): boolean {
  return status === 'placed';
}

/** Orders being cooked (courier search runs while the kitchen cooks). */
export function isCooking(status: OrderStatus): boolean {
  return status === 'accepted';
}

/** Orders waiting for courier pickup. */
export function isAwaitingPickup(status: OrderStatus): boolean {
  return status === 'ready';
}

/** Orders finished from the kitchen's view (handed over or done). */
export function isHandedOver(status: OrderStatus): boolean {
  return status === 'picked_up' || status === 'delivered' || status === 'completed';
}

/** Orders that ended without cooking. */
export function isDead(status: OrderStatus): boolean {
  return status === 'rejected' || status === 'cancelled';
}
