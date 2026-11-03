/**
 * AI Run Planner types: validated shapes for GET hotspots + POST run-plans
 * (openapi `RunPlanHotspotList`, `RunPlanList`). Guards drop garbage so a
 * mixed-version backend renders cards without plans rather than crashing.
 */
import type { LatLng } from '../../lib/maps';

export type PlannerHotspot = {
  merchant_id: string;
  merchant_name: string;
  lat: number;
  lng: number;
  distance_m: number;
  orders_7d: number;
  currency: string;
};

export type PlannerWaypoint = LatLng;

export type PlannerPlan = {
  id: string;
  name: string;
  mode: string;
  distance_m: number;
  duration_s: number;
  corridor_m: number;
  waypoints: PlannerWaypoint[];
  planned_track: { type: 'LineString'; coordinates: number[][] };
  hotspot_merchant_ids: string[];
  est_orders: number;
  est_earnings: { amount_minor: number; currency: string; per_order_minor: number };
  reasoning: string;
  source: 'ai' | 'heuristic';
};

export type PlannerResult = {
  plans: PlannerPlan[];
  hotspots: PlannerHotspot[];
  live: boolean;
  goal_distance_m: number;
  mode: string;
  window: string;
  corridor_m: number;
  currency: string;
  note: string;
};

function isNum(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function toHotspot(raw: unknown): PlannerHotspot | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.merchant_id !== 'string' || typeof r.merchant_name !== 'string') return null;
  if (!isNum(r.lat) || !isNum(r.lng)) return null;
  return {
    merchant_id: r.merchant_id,
    merchant_name: r.merchant_name,
    lat: r.lat,
    lng: r.lng,
    distance_m: isNum(r.distance_m) ? r.distance_m : 0,
    orders_7d: typeof r.orders_7d === 'number' && Number.isFinite(r.orders_7d) ? Math.max(0, Math.round(r.orders_7d)) : 0,
    currency: typeof r.currency === 'string' && r.currency !== '' ? r.currency : 'IDR',
  };
}

function toWaypoint(raw: unknown): PlannerWaypoint | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!isNum(r.lat) || !isNum(r.lng)) return null;
  if (r.lat < -90 || r.lat > 90 || r.lng < -180 || r.lng > 180) return null;
  return { lat: r.lat, lng: r.lng };
}

function toPlan(raw: unknown): PlannerPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.id !== 'string' || typeof r.name !== 'string') return null;
  const wpRaw = Array.isArray(r.waypoints) ? r.waypoints : [];
  const waypoints = wpRaw.map(toWaypoint).filter((w): w is PlannerWaypoint => w !== null);
  if (waypoints.length < 2) return null;
  const track = (r.planned_track ?? {}) as Record<string, unknown>;
  const coords = Array.isArray(track.coordinates) ? track.coordinates : [];
  const coordsNum = (coords as unknown[][]).filter(
    (c): c is number[] => Array.isArray(c) && c.length >= 2 && c.every((n) => typeof n === 'number' && Number.isFinite(n)),
  );
  const earn = (r.est_earnings ?? {}) as Record<string, unknown>;
  return {
    id: r.id,
    name: r.name,
    mode: typeof r.mode === 'string' ? r.mode : 'runner',
    distance_m: isNum(r.distance_m) ? r.distance_m : 0,
    duration_s: typeof r.duration_s === 'number' && Number.isFinite(r.duration_s) ? Math.round(r.duration_s) : 0,
    corridor_m: isNum(r.corridor_m) ? r.corridor_m : 0,
    waypoints,
    planned_track: { type: 'LineString' as const, coordinates: coordsNum as number[][] },
    hotspot_merchant_ids: Array.isArray(r.hotspot_merchant_ids)
      ? (r.hotspot_merchant_ids as unknown[]).filter((x): x is string => typeof x === 'string')
      : [],
    est_orders: typeof r.est_orders === 'number' && Number.isFinite(r.est_orders) ? Math.round(r.est_orders) : 1,
    est_earnings: {
      amount_minor: typeof earn.amount_minor === 'number' && Number.isFinite(earn.amount_minor) ? Math.round(earn.amount_minor) : 0,
      currency: typeof earn.currency === 'string' && earn.currency !== '' ? earn.currency : 'IDR',
      per_order_minor: typeof earn.per_order_minor === 'number' && Number.isFinite(earn.per_order_minor) ? Math.round(earn.per_order_minor) : 0,
    },
    reasoning: typeof r.reasoning === 'string' ? r.reasoning : '',
    source: r.source === 'ai' ? 'ai' : 'heuristic',
  };
}

export function parseHotspotList(raw: unknown): PlannerHotspot[] {
  if (typeof raw !== 'object' || raw === null) return [];
  const list = (raw as { hotspots?: unknown }).hotspots;
  if (!Array.isArray(list)) return [];
  return list.map(toHotspot).filter((h): h is PlannerHotspot => h !== null);
}

export function parsePlannerResult(raw: unknown): PlannerResult | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.plans)) return null;
  const plans = (r.plans as unknown[]).map(toPlan).filter((p): p is PlannerPlan => p !== null);
  if (plans.length === 0) return null;
  const hotspots = Array.isArray(r.hotspots)
    ? (r.hotspots as unknown[]).map(toHotspot).filter((h): h is PlannerHotspot => h !== null)
    : [];
  return {
    plans,
    hotspots,
    live: r.live === true,
    goal_distance_m: isNum(r.goal_distance_m) ? r.goal_distance_m : 0,
    mode: typeof r.mode === 'string' ? r.mode : 'runner',
    window: typeof r.window === 'string' ? r.window : 'now',
    corridor_m: isNum(r.corridor_m) ? r.corridor_m : 0,
    currency: typeof r.currency === 'string' && r.currency !== '' ? r.currency : 'IDR',
    note: typeof r.note === 'string' ? r.note : '',
  };
}
