/** Ops overview domain (A8 dashboard live map + numbers, PLAN §4.4 P0).
 *
 * Wire shapes come from `GET /v1/admin/dashboard`: today's counts (all from
 * the same `orders`/`deliveries`/`activity_sessions` tables the customer /
 * courier / merchant tracks write), live courier dots (active work sessions
 * with a recent fix) and active orders (placed → picked_up). Nothing here is
 * hardcoded: rows that fail validation parse to null and never render.
 */

export type GmvLine = { currency: string; amount_minor: number };

export type DashboardToday = {
  date: string;
  orders_placed: number;
  orders_delivered: number;
  active_orders: number;
  couriers_online: number;
  pending_applications: number;
  pending_merchants: number;
  gmv_delivered: GmvLine[];
};

export type LiveCourier = {
  user_id: string;
  email: string;
  mode: string;
  standing: string;
  lat: number;
  lng: number;
  last_seen_at: string;
  session_distance_m: number;
  delivery_id: string;
  delivery_status: string;
};

export type ActiveOrder = {
  id: string;
  code: string;
  status: string;
  merchant_name: string;
  customer_email: string;
  created_at: string;
  delivery_status: string;
  courier_email: string;
  dropoff: { lat: number; lng: number } | null;
};

export type Dashboard = {
  today: DashboardToday;
  live_couriers: LiveCourier[];
  active_orders: ActiveOrder[];
};

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/** Parse today's numbers; null when the shape is unusable. */
export function parseDashboardToday(raw: unknown): DashboardToday | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const placed = num(m['orders_placed']);
  const delivered = num(m['orders_delivered']);
  const active = num(m['active_orders']);
  const online = num(m['couriers_online']);
  if (placed === null || delivered === null || active === null || online === null) return null;
  const gmv: GmvLine[] = [];
  if (Array.isArray(m['gmv_delivered'])) {
    for (const line of m['gmv_delivered']) {
      if (typeof line !== 'object' || line === null) continue;
      const l = line as Record<string, unknown>;
      const amount = num(l['amount_minor']);
      if (typeof l['currency'] !== 'string' || amount === null) continue;
      gmv.push({ currency: l['currency'], amount_minor: amount });
    }
  }
  return {
    date: str(m['date']),
    orders_placed: placed,
    orders_delivered: delivered,
    active_orders: active,
    couriers_online: online,
    pending_applications: num(m['pending_applications']) ?? 0,
    pending_merchants: num(m['pending_merchants']) ?? 0,
    gmv_delivered: gmv,
  };
}

function latLng(raw: unknown): { lat: number; lng: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const lat = num(m['lat']);
  const lng = num(m['lng']);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

/** Parse one live courier dot; null when the id/position is unusable. */
export function parseLiveCourier(raw: unknown): LiveCourier | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['user_id'] !== 'string' || m['user_id'] === '') return null;
  const pos = latLng({ lat: m['lat'], lng: m['lng'] });
  if (!pos) return null;
  return {
    user_id: m['user_id'],
    email: str(m['email']),
    mode: str(m['mode']) || 'runner',
    standing: str(m['standing']),
    lat: pos.lat,
    lng: pos.lng,
    last_seen_at: str(m['last_seen_at']),
    session_distance_m: num(m['session_distance_m']) ?? 0,
    delivery_id: str(m['delivery_id']),
    delivery_status: str(m['delivery_status']),
  };
}

/** Parse one active order row; null when the id/status is unusable. */
export function parseActiveOrder(raw: unknown): ActiveOrder | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || typeof m['status'] !== 'string') return null;
  return {
    id: m['id'],
    code: str(m['code']),
    status: m['status'],
    merchant_name: str(m['merchant_name']),
    customer_email: str(m['customer_email']),
    created_at: str(m['created_at']),
    delivery_status: str(m['delivery_status']),
    courier_email: str(m['courier_email']),
    dropoff: latLng(m['dropoff']),
  };
}

/** Parse the full dashboard envelope; null when the `today` block is missing. */
export function parseDashboard(raw: unknown): Dashboard | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const today = parseDashboardToday(m['today']);
  if (!today) return null;
  const live: LiveCourier[] = [];
  if (Array.isArray(m['live_couriers'])) {
    for (const dot of m['live_couriers']) {
      const parsed = parseLiveCourier(dot);
      if (parsed) live.push(parsed);
    }
  }
  const active: ActiveOrder[] = [];
  if (Array.isArray(m['active_orders'])) {
    for (const row of m['active_orders']) {
      const parsed = parseActiveOrder(row);
      if (parsed) active.push(parsed);
    }
  }
  return { today, live_couriers: live, active_orders: active };
}
