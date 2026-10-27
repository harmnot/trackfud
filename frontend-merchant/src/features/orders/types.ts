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
 * Live dispatch detail attached to an order when the API exposes it
 * (openapi.yaml `Order.delivery`: status, eta, route, courier profile on
 * order detail). Absent on the merchant list today — the courier line falls
 * back to the order status (see `courierLine` in OrdersPage).
 */
export interface OrderDelivery {
  status?: string;
  eta_s?: number | null;
  courier_name?: string;
  courier_mode?: string;
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
  spill_risk: string;
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
