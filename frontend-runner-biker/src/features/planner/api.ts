/**
 * AI Run Planner API: thin typed wrappers over the live backend
 * (`GET /courier/run-plans/hotspots`, `POST /courier/run-plans`,
 * openapi `listHotspots`/`createRunPlans`). No demo fallbacks here —
 * callers render honest loading/error/empty states.
 */
import { api } from '../../lib/api';
import { parseHotspotList, parsePlannerResult, type PlannerHotspot, type PlannerResult } from './types';

export type PlanWindow = 'now' | 'lunch' | 'dinner';

export async function fetchHotspots(args: {
  lat: number;
  lng: number;
  radiusM?: number;
  limit?: number;
}): Promise<PlannerHotspot[]> {
  const q = new URLSearchParams({
    lat: String(args.lat),
    lng: String(args.lng),
    radius_m: String(args.radiusM ?? 3000),
    limit: String(args.limit ?? 8),
  });
  const res = await api<unknown>(`/courier/run-plans/hotspots?${q.toString()}`);
  return parseHotspotList(res);
}

/** The planner waits on the model (backend budget 25 s, plannerAIBudget) plus
 * street routing, so it gets longer than the app-wide 20 s request timeout;
 * past the budget the server answers with deterministic plans, never an error. */
const PLANNER_TIMEOUT_MS = 35_000;

export async function createRunPlans(args: {
  lat: number;
  lng: number;
  mode: 'runner' | 'biker';
  goalDistanceM?: number;
  goalDurationS?: number;
  window?: PlanWindow;
  lang?: string;
}): Promise<PlannerResult> {
  const body: Record<string, unknown> = {
    start: { lat: args.lat, lng: args.lng },
    mode: args.mode,
    window: args.window ?? 'now',
    lang: args.lang ?? 'en',
  };
  if (args.goalDistanceM !== undefined) body.goal_distance_m = args.goalDistanceM;
  if (args.goalDurationS !== undefined) body.goal_duration_s = args.goalDurationS;
  const res = await api<unknown>('/courier/run-plans', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    timeoutMs: PLANNER_TIMEOUT_MS,
  });
  const parsed = parsePlannerResult(res);
  if (!parsed) throw new Error('planner returned no usable plans');
  return parsed;
}
