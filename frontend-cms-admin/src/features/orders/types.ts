/**
 * Order review domain (A7 orders list + detail, PLAN §4.4 P0).
 *
 * Wire shapes come from `GET /v1/admin/orders` (queue rows) and
 * `GET /v1/admin/orders/{id}` (full detail: parties, items, audit timeline,
 * delivery, chat, cheers/ratings, proof photo + checks, money trail, and
 * whether the support refund is available). All money stays integer minor
 * units; `formatMinor` (in `lib/format`) only divides for display.
 * Nothing here is hardcoded: rows that fail validation parse to null.
 */

export const ORDER_FILTERS = [
  'all',
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
export type OrderFilter = (typeof ORDER_FILTERS)[number];

/** True when the backend marks the order refundable (pre-pickup support case). */
export function isRefundable(detail: AdminOrderDetail | null): boolean {
  return detail !== null && detail.refundable === true;
}

export type Money = { amount_minor: number; currency: string };

export type AdminParty = { id: string; name: string };
export type AdminCustomer = { id: string; email: string };

export type AdminDeliveryLine = {
  status: string;
  type: string;
  courier_id: string;
};

/** One CMS queue row: the order plus parties and live dispatch state. */
export type AdminOrder = {
  id: string;
  code: string;
  status: string;
  merchant: AdminParty;
  customer: AdminCustomer;
  currency: string;
  subtotal: Money;
  delivery_fee: Money;
  service_fee: Money;
  tip: Money;
  total: Money;
  commission: Money;
  payment_method: string;
  payment_status: string;
  /** Handover secrets for support (talk through a stuck handover). */
  pickup_code: string;
  delivery_pin: string;
  delivery: AdminDeliveryLine | null;
  cancel_reason: string;
  created_at: string;
};

export type OrderItem = {
  menu_item_id: string;
  name: Record<string, string>;
  unit_price: Money;
  qty: number;
  line_total: Money;
};

export type OrderEvent = {
  from: string;
  to: string;
  actor: string;
  actor_id: string;
  reason: string;
  at: string;
};

export type OrderMessage = {
  id: string;
  sender: string;
  body: string;
  lang: string;
  translated_body: string;
  moderated: boolean;
  flagged: boolean;
  created_at: string;
};

export type OrderCheers = { count: number; recent: Array<{ message: string; created_at: string }> };

export type OrderRatings = {
  courier_stars: number | null;
  courier_tags: string[];
  restaurant_stars: number | null;
  topics: string[];
  abusive: boolean;
  created_at: string;
};

export type ProofCheck = {
  file_id: string;
  verdict: string;
  note: string;
  fallback: boolean;
  created_at: string;
};

export type OrderProof = { file_id: string | null; checks: ProofCheck[] };

export type MoneyPosting = {
  kind: string;
  account: { owner_type: string; owner_id: string; kind: string };
  amount_minor: number;
  currency: string;
  created_at: string;
};

export type OrderPayments = { method: string; status: string; postings: MoneyPosting[] };

export type AdminDelivery = {
  status: string;
  type: string;
  id: string;
  courier_id: string;
  courier_email: string;
  courier: { first_name: string; mode: string } | null;
  eta_s: number | null;
  trip_m: number | null;
  assigned_at: string | null;
  picked_up_at: string | null;
  delivered_at: string | null;
  cancel_note: string;
  route_warning: string;
};

/** Full CMS detail: the order view plus timeline, chat, proof and money. */
export type AdminOrderDetail = {
  order: AdminOrder;
  items: OrderItem[];
  events: OrderEvent[];
  delivery: AdminDelivery | null;
  messages: OrderMessage[];
  cheers: OrderCheers;
  ratings: OrderRatings | null;
  proof: OrderProof;
  payments: OrderPayments;
  refundable: boolean;
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function num(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function bool(raw: unknown): boolean {
  return raw === true;
}

function moneyOf(raw: unknown, fallbackCurrency: string): Money | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['amount_minor'] !== 'number' || !Number.isFinite(raw['amount_minor'])) return null;
  const currency = typeof raw['currency'] === 'string' ? (raw['currency'] as string) : fallbackCurrency;
  return { amount_minor: raw['amount_minor'] as number, currency };
}

function partyOf(raw: unknown): AdminParty | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['id'] !== 'string' || typeof raw['name'] !== 'string') return null;
  return { id: raw['id'], name: raw['name'] };
}

function customerOf(raw: unknown): AdminCustomer | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['id'] !== 'string' || typeof raw['email'] !== 'string') return null;
  return { id: raw['id'], email: raw['email'] };
}

/** Parse one queue row; null when id/status/money shape is unusable. */
export function parseAdminOrder(raw: unknown): AdminOrder | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['id'] !== 'string' || typeof raw['status'] !== 'string') return null;
  const currency = typeof raw['currency'] === 'string' ? raw['currency'] : '';
  const subtotal = moneyOf(raw['subtotal'], currency);
  const total = moneyOf(raw['total'], currency);
  const merchant = partyOf(raw['merchant']);
  const customer = customerOf(raw['customer']);
  if (!subtotal || !total || !merchant || !customer) return null;
  const deliveryFee = moneyOf(raw['delivery_fee'], currency) ?? { amount_minor: 0, currency };
  const serviceFee = moneyOf(raw['service_fee'], currency) ?? { amount_minor: 0, currency };
  const tip = moneyOf(raw['tip'], currency) ?? { amount_minor: 0, currency };
  const commission = moneyOf(raw['commission'], currency) ?? { amount_minor: 0, currency };
  let delivery: AdminDeliveryLine | null = null;
  if (isRecord(raw['delivery']) && typeof raw['delivery']['status'] === 'string') {
    delivery = {
      status: raw['delivery']['status'] as string,
      type: str(raw['delivery']['type']),
      courier_id: str(raw['delivery']['courier_id']),
    };
  }
  return {
    id: raw['id'],
    code: str(raw['code']),
    status: raw['status'],
    merchant,
    customer,
    currency,
    subtotal,
    delivery_fee: deliveryFee,
    service_fee: serviceFee,
    tip,
    total,
    commission,
    payment_method: str(raw['payment_method']),
    payment_status: str(raw['payment_status']),
    pickup_code: str(raw['pickup_code']),
    delivery_pin: str(raw['delivery_pin']),
    delivery,
    cancel_reason: str(raw['cancel_reason']),
    created_at: str(raw['created_at']),
  };
}

function parseItems(raw: unknown, currency: string): OrderItem[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderItem[] = [];
  for (const it of raw) {
    if (!isRecord(it)) continue;
    const unit = moneyOf(it['unit_price'], currency);
    const line = moneyOf(it['line_total'], currency);
    if (typeof it['menu_item_id'] !== 'string' || !unit || !line) continue;
    const name: Record<string, string> = {};
    if (isRecord(it['name'])) {
      for (const [k, v] of Object.entries(it['name'])) {
        if (typeof v === 'string') name[k] = v;
      }
    }
    out.push({
      menu_item_id: it['menu_item_id'],
      name,
      unit_price: unit,
      qty: typeof it['qty'] === 'number' ? it['qty'] : 0,
      line_total: line,
    });
  }
  return out;
}

function parseEvents(raw: unknown): OrderEvent[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderEvent[] = [];
  for (const e of raw) {
    if (!isRecord(e)) continue;
    out.push({
      from: str(e['from']),
      to: str(e['to']),
      actor: str(e['actor']),
      actor_id: str(e['actor_id']),
      reason: str(e['reason']),
      at: str(e['at']),
    });
  }
  return out;
}

function parseMessages(raw: unknown): OrderMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: OrderMessage[] = [];
  for (const m of raw) {
    if (!isRecord(m) || typeof m['id'] !== 'string') continue;
    out.push({
      id: m['id'],
      sender: str(m['sender']),
      body: str(m['body']),
      lang: str(m['lang']),
      translated_body: str(m['translated_body']),
      moderated: bool(m['moderated']),
      flagged: bool(m['flagged']),
      created_at: str(m['created_at']),
    });
  }
  return out;
}

function parseCheers(raw: unknown): OrderCheers {
  if (!isRecord(raw)) return { count: 0, recent: [] };
  const recent: OrderCheers['recent'] = [];
  if (Array.isArray(raw['recent'])) {
    for (const r of raw['recent']) {
      if (isRecord(r)) recent.push({ message: str(r['message']), created_at: str(r['created_at']) });
    }
  }
  return { count: num(raw['count']), recent };
}

function parseRatings(raw: unknown): OrderRatings | null {
  if (!isRecord(raw)) return null;
  const tags = Array.isArray(raw['courier_tags'])
    ? raw['courier_tags'].filter((t): t is string => typeof t === 'string')
    : [];
  const topics = Array.isArray(raw['topics'])
    ? raw['topics'].filter((t): t is string => typeof t === 'string')
    : [];
  return {
    courier_stars: typeof raw['courier_stars'] === 'number' ? raw['courier_stars'] : null,
    courier_tags: tags,
    restaurant_stars: typeof raw['restaurant_stars'] === 'number' ? raw['restaurant_stars'] : null,
    topics,
    abusive: bool(raw['abusive']),
    created_at: str(raw['created_at']),
  };
}

function parseProof(raw: unknown): OrderProof {
  if (!isRecord(raw)) return { file_id: null, checks: [] };
  const checks: ProofCheck[] = [];
  if (Array.isArray(raw['checks'])) {
    for (const c of raw['checks']) {
      if (!isRecord(c)) continue;
      checks.push({
        file_id: str(c['file_id']),
        verdict: str(c['verdict']),
        note: str(c['note']),
        fallback: bool(c['fallback']),
        created_at: str(c['created_at']),
      });
    }
  }
  return {
    file_id: typeof raw['file_id'] === 'string' ? (raw['file_id'] as string) : null,
    checks,
  };
}

function parsePayments(raw: unknown): OrderPayments {
  if (!isRecord(raw)) return { method: '', status: '', postings: [] };
  const postings: MoneyPosting[] = [];
  if (Array.isArray(raw['postings'])) {
    for (const p of raw['postings']) {
      if (!isRecord(p) || !isRecord(p['account'])) continue;
      postings.push({
        kind: str(p['kind']),
        account: {
          owner_type: str(p['account']['owner_type']),
          owner_id: str(p['account']['owner_id']),
          kind: str(p['account']['kind']),
        },
        amount_minor: num(p['amount_minor']),
        currency: str(p['currency']),
        created_at: str(p['created_at']),
      });
    }
  }
  return { method: str(raw['method']), status: str(raw['status']), postings };
}

function parseDelivery(raw: unknown): AdminDelivery | null {
  if (!isRecord(raw) || typeof raw['status'] !== 'string') return null;
  let courier: AdminDelivery['courier'] = null;
  if (isRecord(raw['courier'])) {
    courier = { first_name: str(raw['courier']['first_name']), mode: str(raw['courier']['mode']) };
  }
  const eta = raw['eta_s'];
  const trip = raw['trip_m'];
  return {
    status: raw['status'],
    type: str(raw['type']),
    id: str(raw['id']),
    courier_id: str(raw['courier_id']),
    courier_email: str(raw['courier_email']),
    courier,
    eta_s: typeof eta === 'number' ? eta : null,
    trip_m: typeof trip === 'number' ? trip : null,
    assigned_at: typeof raw['assigned_at'] === 'string' ? (raw['assigned_at'] as string) : null,
    picked_up_at: typeof raw['picked_up_at'] === 'string' ? (raw['picked_up_at'] as string) : null,
    delivered_at: typeof raw['delivered_at'] === 'string' ? (raw['delivered_at'] as string) : null,
    cancel_note: str(raw['cancel_note']),
    route_warning: str(raw['route_warning']),
  };
}

/**
 * Parse the full detail envelope `{"order": {...}}`: the order view plus
 * items/events/delivery and the support sections. Null when the order row
 * itself is unusable — sections degrade to empties, never to a crash.
 *
 * Accepts either the full envelope (`{order: {...}}`, as served by
 * `GET /v1/admin/orders/{id}`) or an already-unwrapped detail object, so a
 * caller that passes `data.order` by mistake still renders instead of
 * reporting "not found".
 */
export function parseAdminOrderDetail(raw: unknown): AdminOrderDetail | null {
  const body: unknown = isRecord(raw) && isRecord(raw['order']) ? raw['order'] : raw;
  if (!isRecord(body)) return null;
  const order = parseAdminOrder(body);
  if (!order) return null;
  return {
    order,
    items: parseItems(body['items'], order.currency),
    events: parseEvents(body['events']),
    delivery: parseDelivery(body['delivery']),
    messages: parseMessages(body['messages']),
    cheers: parseCheers(body['cheers']),
    ratings: parseRatings(body['ratings']),
    proof: parseProof(body['proof']),
    payments: parsePayments(body['payments']),
    refundable: body['refundable'] === true,
  };
}
