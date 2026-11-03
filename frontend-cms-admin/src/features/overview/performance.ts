/** Courier performance domain (A8, PLAN §8.6).
 *
 * Wire shape comes from `GET /v1/admin/couriers/{user_id}/performance`:
 * 30-day acceptance/completion/in-window rates, pickup/delivery timing,
 * Bayesian rating + complaints, distance/active minutes + WHO-week trend,
 * overexertion guards, earnings, anti-cheat flags, peer rank, and recent
 * session + delivery history. Rates are fractions or null (never a damning
 * 0% for "no data"); rows that fail validation parse to null and never
 * render.
 */

export type PerfRate = { have: number; total: number; rate: number | null };

export type PerfCourier = {
  user_id: string;
  email: string;
  mode: string;
  standing: string;
  rating_bayes: number;
  rating_count: number;
  deliveries_count: number;
  lifetime_distance_m: number;
  lifetime_moving_s: number;
  lifetime_active_s: number;
};

export type PerfWeek = {
  week: string;
  active_s: number;
  sessions: number;
  goal_met: boolean;
};

export type PerfSession = {
  id: string;
  kind: string;
  mode: string;
  status: string;
  started_at: string;
  ended_at: string;
  distance_m: number;
  moving_s: number;
  active_s: number;
  flags: string;
  last_lat: number | null;
  last_lng: number | null;
};

export type PerfDelivery = {
  id: string;
  order_id: string;
  order_code: string;
  status: string;
  type: string;
  assigned_at: string;
  picked_up_at: string;
  delivered_at: string;
  distance_m: number;
  active_s: number;
  courier_stars: number | null;
  in_window: boolean | null;
};

export type CourierPerformance = {
  courier: PerfCourier;
  window_days: number;
  acceptance: PerfRate;
  completion: PerfRate;
  in_window: PerfRate;
  pickup_wait_s_avg: number | null;
  delivery_s_avg: number | null;
  rating_bayes: number;
  rating_count: number;
  complaints: number;
  complaints_per_100: number | null;
  top_tags: Array<{ tag: string; count: number }>;
  top_topics: Array<{ topic: string; count: number }>;
  work_distance_m: number;
  work_active_s: number;
  per_delivery_m: number;
  weekly: PerfWeek[];
  weeks_at_goal: number;
  goal_min: number;
  days_over_cap: number;
  long_sessions: number;
  daily_cap_min: number;
  earnings: Array<{ currency: string; amount_minor: number }>;
  per_active_hour: { currency: string; amount_minor: number } | null;
  sessions_flagged: number;
  latest_flags: Array<{
    session_id: string;
    kind: string;
    flags: string;
    started_at: string;
  }>;
  peer_rank: number;
  peer_of: number;
  peer_percentile: number | null;
  sessions: PerfSession[];
  deliveries: PerfDelivery[];
};

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/** Parse one {have, total, rate} block; null when the shape is unusable. */
export function parsePerfRate(raw: unknown): PerfRate | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const have = num(m['have'] ?? m['accepted'] ?? m['delivered'] ?? m['in_window']);
  const total = num(m['total'] ?? m['offers'] ?? m['assigned'] ?? m['delivered']);
  if (have === null || total === null) return null;
  const rate = m['rate'];
  return {
    have,
    total,
    rate: typeof rate === 'number' && Number.isFinite(rate) ? rate : null,
  };
}

/** Parse the courier header; null when the id is missing. */
export function parsePerfCourier(raw: unknown): PerfCourier | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['user_id'] !== 'string' || m['user_id'] === '') return null;
  return {
    user_id: m['user_id'],
    email: str(m['email']),
    mode: str(m['mode']) || 'runner',
    standing: str(m['standing']),
    rating_bayes: num(m['rating_bayes']) ?? 4.5,
    rating_count: num(m['rating_count']) ?? 0,
    deliveries_count: num(m['deliveries_count']) ?? 0,
    lifetime_distance_m: num(m['lifetime_distance_m']) ?? 0,
    lifetime_moving_s: num(m['lifetime_moving_s']) ?? 0,
    lifetime_active_s: num(m['lifetime_active_s']) ?? 0,
  };
}

function tagList(raw: unknown): Array<{ tag: string; count: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ tag: string; count: number }> = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m['tag'] !== 'string') continue;
    const count = num(m['count']);
    if (count === null) continue;
    out.push({ tag: m['tag'], count });
  }
  return out;
}

function topicList(raw: unknown): Array<{ topic: string; count: number }> {
  if (!Array.isArray(raw)) return [];
  const out: Array<{ topic: string; count: number }> = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const m = item as Record<string, unknown>;
    if (typeof m['topic'] !== 'string') continue;
    const count = num(m['count']);
    if (count === null) continue;
    out.push({ topic: m['topic'], count });
  }
  return out;
}

/** Parse the full performance envelope; null when the courier block is missing. */
export function parsePerformance(raw: unknown): CourierPerformance | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  const courier = parsePerfCourier(m['courier']);
  if (!courier) return null;

  const acceptance = parsePerfRate(m['acceptance']) ?? { have: 0, total: 0, rate: null };
  const completion = parsePerfRate(m['completion']) ?? { have: 0, total: 0, rate: null };
  const inWindow = parsePerfRate(m['in_window']) ?? { have: 0, total: 0, rate: null };

  const rating = (m['rating'] ?? {}) as Record<string, unknown>;
  const work = (m['work'] ?? {}) as Record<string, unknown>;
  const over = (m['overexertion'] ?? {}) as Record<string, unknown>;
  const earn = (m['earnings'] ?? {}) as Record<string, unknown>;
  const flags = (m['flags'] ?? {}) as Record<string, unknown>;
  const peers = (m['peers'] ?? {}) as Record<string, unknown>;

  const weekly: PerfWeek[] = [];
  if (Array.isArray(work['weekly'])) {
    for (const w of work['weekly']) {
      if (typeof w !== 'object' || w === null) continue;
      const wm = w as Record<string, unknown>;
      if (typeof wm['week'] !== 'string') continue;
      weekly.push({
        week: wm['week'],
        active_s: num(wm['active_s']) ?? 0,
        sessions: num(wm['sessions']) ?? 0,
        goal_met: wm['goal_met'] === true,
      });
    }
  }

  const earnings: Array<{ currency: string; amount_minor: number }> = [];
  const byCur = earn['by_currency'];
  if (Array.isArray(byCur)) {
    for (const line of byCur) {
      if (typeof line !== 'object' || line === null) continue;
      const lm = line as Record<string, unknown>;
      const amount = num(lm['amount_minor']);
      if (typeof lm['currency'] !== 'string' || amount === null) continue;
      earnings.push({ currency: lm['currency'], amount_minor: amount });
    }
  }
  let perHour: { currency: string; amount_minor: number } | null = null;
  const pah = earn['per_active_hour'];
  if (typeof pah === 'object' && pah !== null) {
    const pm = pah as Record<string, unknown>;
    const amount = num(pm['amount_minor']);
    if (typeof pm['currency'] === 'string' && amount !== null) {
      perHour = { currency: pm['currency'], amount_minor: amount };
    }
  }

  const latestFlags: CourierPerformance['latest_flags'] = [];
  if (Array.isArray(flags['latest'])) {
    for (const f of flags['latest']) {
      if (typeof f !== 'object' || f === null) continue;
      const fm = f as Record<string, unknown>;
      if (typeof fm['session_id'] !== 'string') continue;
      latestFlags.push({
        session_id: fm['session_id'],
        kind: str(fm['kind']),
        flags: str(fm['flags']),
        started_at: str(fm['started_at']),
      });
    }
  }

  const sessions: PerfSession[] = [];
  if (Array.isArray(m['sessions'])) {
    for (const ses of m['sessions']) {
      if (typeof ses !== 'object' || ses === null) continue;
      const sm = ses as Record<string, unknown>;
      if (typeof sm['id'] !== 'string') continue;
      sessions.push({
        id: sm['id'],
        kind: str(sm['kind']),
        mode: str(sm['mode']),
        status: str(sm['status']),
        started_at: str(sm['started_at']),
        ended_at: str(sm['ended_at']),
        distance_m: num(sm['distance_m']) ?? 0,
        moving_s: num(sm['moving_s']) ?? 0,
        active_s: num(sm['active_s']) ?? 0,
        flags: str(sm['flags']),
        last_lat: num(sm['last_lat']),
        last_lng: num(sm['last_lng']),
      });
    }
  }

  const deliveries: PerfDelivery[] = [];
  if (Array.isArray(m['deliveries'])) {
    for (const del of m['deliveries']) {
      if (typeof del !== 'object' || del === null) continue;
      const dm = del as Record<string, unknown>;
      if (typeof dm['id'] !== 'string') continue;
      deliveries.push({
        id: dm['id'],
        order_id: str(dm['order_id']),
        order_code: str(dm['order_code']),
        status: str(dm['status']),
        type: str(dm['type']),
        assigned_at: str(dm['assigned_at']),
        picked_up_at: str(dm['picked_up_at']),
        delivered_at: str(dm['delivered_at']),
        distance_m: num(dm['distance_m']) ?? 0,
        active_s: num(dm['active_s']) ?? 0,
        courier_stars: num(dm['courier_stars']),
        in_window: typeof dm['in_window'] === 'boolean' ? dm['in_window'] : null,
      });
    }
  }

  const complaintsPer100 = rating['complaints_per_100'];
  return {
    courier,
    window_days: num(m['window_days']) ?? 30,
    acceptance,
    completion,
    in_window: inWindow,
    pickup_wait_s_avg: num(m['pickup_wait_s_avg']),
    delivery_s_avg: num(m['delivery_s_avg']),
    rating_bayes: num(rating['bayes']) ?? courier.rating_bayes,
    rating_count: num(rating['count']) ?? courier.rating_count,
    complaints: num(rating['complaints']) ?? 0,
    complaints_per_100:
      typeof complaintsPer100 === 'number' && Number.isFinite(complaintsPer100)
        ? complaintsPer100
        : null,
    top_tags: tagList(rating['top_tags']),
    top_topics: topicList(rating['top_topics']),
    work_distance_m: num(work['distance_m']) ?? 0,
    work_active_s: num(work['active_s']) ?? 0,
    per_delivery_m: num(work['per_delivery_m']) ?? 0,
    weekly,
    weeks_at_goal: num(work['weeks_at_goal']) ?? 0,
    goal_min: num(work['goal_min']) ?? 150,
    days_over_cap: num(over['days_over_cap']) ?? 0,
    long_sessions: num(over['long_sessions']) ?? 0,
    daily_cap_min: num(over['daily_cap_min']) ?? 180,
    earnings,
    per_active_hour: perHour,
    sessions_flagged: num(flags['sessions_flagged']) ?? 0,
    latest_flags: latestFlags,
    peer_rank: num(peers['rank']) ?? 0,
    peer_of: num(peers['of']) ?? 0,
    peer_percentile:
      typeof peers['percentile'] === 'number' && Number.isFinite(peers['percentile'])
        ? (peers['percentile'] as number)
        : null,
    sessions,
    deliveries,
  };
}
