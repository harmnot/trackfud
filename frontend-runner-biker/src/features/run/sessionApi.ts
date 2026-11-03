/**
 * Work-session lifecycle against the live backend (B3 sessions). Starting a
 * session server-side is what makes dispatch see the courier: the goal feeds
 * workout-fit scoring (§6.2) and the row carries the frozen/banned gate, so
 * a local-only session can never receive offers. Ending server-side folds the
 * run into lifetime totals; the IndexedDB summary stays the offline mirror.
 */
import { ApiError, api } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { GoalKind } from './types';
import type { CourierMode } from '../../lib/format';

/** Minimal `SessionEnvelope.session` shape the run flow reads. */
export type ServerSession = {
  id: string;
  kind: string;
  mode: string;
  status: string;
};

/**
 * Open a work session: mode + workout goal reach dispatch scoring.
 * Drawn saved tracks are pad sketches (device-independent 0–100 points), not
 * geography, so `planned_track` stays null — only the goal travels. AI plans
 * are real geography (GeoJSON LineString from POST /courier/run-plans), so
 * they travel as `planned_track` and drive the dispatch corridor (§6.1).
 * Throws ApiError (403 when the account is frozen/banned); callers fall back
 * to a local id whose GPS backlog auto-registers on reconnect.
 */
export async function startWorkSession(args: {
  mode: CourierMode;
  goalKind: GoalKind;
  goalValue: number;
  plannedTrack?: { type: 'LineString'; coordinates: number[][] } | null;
}): Promise<{ sessionId: string }> {
  const body: Record<string, unknown> = {
    kind: 'work',
    mode: args.mode,
  };
  if (args.goalKind === 'distance') body.goal_distance_m = args.goalValue;
  if (args.goalKind === 'time') body.goal_duration_s = args.goalValue;
  if (args.plannedTrack && args.plannedTrack.coordinates.length >= 2) {
    body.planned_track = args.plannedTrack;
  }
  const env = await api<{ session: ServerSession }>('/courier/sessions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!env?.session?.id) throw new ApiError('bad session response', 500);
  return { sessionId: env.session.id };
}

/**
 * Close the work session server-side (lifetime totals, splits, track).
 * Best-effort: a failed close still ends the local run — the server
 * auto-ends silent sessions after 10 min, so nothing is lost, only delayed.
 */
export async function endWorkSession(args: { sessionId: string }): Promise<void> {
  try {
    await api(`/courier/sessions/${args.sessionId}/end`, { method: 'POST' });
  } catch (err) {
    logger.warn('session end failed, server auto-ends idle sessions', err);
  }
}
