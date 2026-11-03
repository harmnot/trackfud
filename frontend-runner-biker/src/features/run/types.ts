/** Run-session domain types (pure data, no side effects). */
import type { CourierMode } from '../../lib/format';

export type TrackKind = 'free' | 'saved' | 'ai';
export type GoalKind = 'distance' | 'time' | 'open';
export type SessionPhase = 'idle' | 'active' | 'stale' | 'done';

/** Session setup chosen on the start screen. */
export type SessionSetup = {
  mode: CourierMode;
  goalKind: GoalKind;
  /** Goal in meters (distance) or seconds (time); 0 for open runs. */
  goalValue: number;
  trackKind: TrackKind;
  trackName: string | null;
  /** Saved-track id for `trackKind === 'saved'` (names are display-only). */
  trackId: string | null;
  /** AI-plan GeoJSON LineString for `trackKind === 'ai'` (drives dispatch). */
  plannedTrack: { type: 'LineString'; coordinates: number[][] } | null;
  /** Chosen AI plan id + name (display only; the GeoJSON is the contract). */
  planId: string | null;
  planName: string | null;
};

/** One accepted GPS fix inside the live session. */
export type Fix = { lat: number; lng: number; ts: number; acc: number; speedMps: number | null };

/** A recorded silence: the app marks it, never fills it in. */
export type Gap = { from: number; to: number };

/** Live counters for the Run Mode screen. */
export type RunStats = {
  distanceM: number;
  movingS: number;
  elapsedS: number;
  activeS: number;
  gapCount: number;
  gapS: number;
  lastTs: number | null;
  lastLat: number | null;
  lastLng: number | null;
  stale: boolean;
};

export const EMPTY_STATS: RunStats = {
  distanceM: 0,
  movingS: 0,
  elapsedS: 0,
  activeS: 0,
  gapCount: 0,
  gapS: 0,
  lastTs: null,
  lastLat: null,
  lastLng: null,
  stale: false,
};
