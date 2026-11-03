/** Ops overview calls: dashboard + courier performance (`/v1/admin/*`).
 *
 * Every row comes from the API — the live map, today's numbers and the §8.6
 * performance page never hardcode couriers, orders or metrics. Responses are
 * validated before they render (garbage parses to null and shows an empty
 * state, never a crash).
 */
import { api } from '../../lib/api';
import {
  parseDashboard,
  type Dashboard,
} from './types';
import {
  parsePerformance,
  type CourierPerformance,
} from './performance';

/** Fetch today's numbers, live courier dots and active orders in one call. */
export async function fetchDashboard(): Promise<Dashboard | null> {
  const d = await api<unknown>('/admin/dashboard');
  return parseDashboard(d);
}

/** Fetch one courier's 30-day §8.6 performance page. */
export async function fetchPerformance(userId: string): Promise<CourierPerformance | null> {
  const d = await api<unknown>(`/admin/couriers/${userId}/performance`);
  return parsePerformance(d);
}
