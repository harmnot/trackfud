/**
 * Saved tracks: draw a loop with a finger, save it, pick it at session
 * start. Compact on purpose — normalized pad points plus a rough length
 * estimate, not a GIS store. The run engine still streams real GPS; the
 * saved shape is only the dispatch hint (`planned_track` in B3 sessions).
 */
import { create } from 'zustand';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import type { LatLng } from '../../lib/maps';

/** One pad point, 0–100 in both axes (device-independent). */
export type PadPoint = { x: number; y: number };

/** Map placement for a saved track (Strava-art anchor + projected paths). */
export type TrackGeo = {
  center: LatLng;
  /** Real width/height of the pad in meters at the anchor. */
  spanM: number;
  /** Pad width ÷ height measured at draw time (1 = square pad or legacy). */
  aspect: number;
  /** Sketch projected onto the map (straight connectors). */
  path: LatLng[];
  /** Road-snapped route, when Directions succeeded. */
  snapped: LatLng[] | null;
  travelMode: 'walking' | 'bicycling';
};

/** A saved track (drawn loop or saved past session). */
export type SavedTrack = {
  id: string;
  name: string;
  createdAt: number;
  points: PadPoint[];
  /** Rough loop length in meters (clearly an estimate, see estimator). */
  estimateM: number;
  /** Map placement, present when the track was drawn against a map anchor. */
  geo?: TrackGeo;
};

type TrackState = {
  tracks: SavedTrack[];
  loaded: boolean;
  load: () => Promise<void>;
  save: (args: { name: string; points: PadPoint[]; geo?: TrackGeo }) => Promise<SavedTrack | null>;
  remove: (args: { id: string }) => Promise<void>;
};

/** Rough length: pad diagonal ≈ 1 km city block. Labelled estimate in UI. */
export function estimateTrackLengthM(points: PadPoint[]): number {
  if (points.length < 2) return 0;
  let units = 0;
  for (const [i, p] of points.entries()) {
    if (i === 0) continue;
    const q = points[i - 1];
    if (!q) continue;
    units += Math.hypot(p.x - q.x, p.y - q.y);
  }
  return Math.round(units * 10);
}

/** Simplify a drawn stroke to at most 64 points (compact storage). */
export function simplifyStroke(points: PadPoint[]): PadPoint[] {
  if (points.length <= 64) return points;
  const step = points.length / 64;
  const out: PadPoint[] = [];
  for (let i = 0; i < 64; i += 1) {
    const p = points[Math.floor(i * step)];
    if (p) out.push({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  }
  return out;
}

/**
 * Find the session's saved track: stable ids first, legacy names as the
 * fallback (sessions started before id-based picks only stored a name).
 */
export function selectSessionTrack(args: {
  tracks: SavedTrack[];
  trackId: string | null;
  trackName: string | null;
}): SavedTrack | null {
  const { tracks, trackId, trackName } = args;
  if (trackId) {
    const byId = tracks.find((tr) => tr.id === trackId);
    if (byId) return byId;
  }
  if (trackName) return tracks.find((tr) => tr.name === trackName) ?? null;
  return null;
}

export const useTracks = create<TrackState>((set, get) => ({
  tracks: [],
  loaded: false,
  load: async () => {
    try {
      const rows = await db.tracks.orderBy('createdAt').reverse().toArray();
      set({ tracks: rows, loaded: true });
    } catch (err) {
      logger.error('tracks load failed', err);
      set({ loaded: true });
    }
  },
  save: async ({ name, points, geo }) => {
    const clean = simplifyStroke(points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)));
    if (name.trim().length === 0 || clean.length < 3) return null;
    const track: SavedTrack = {
      id: crypto.randomUUID(),
      name: name.trim().slice(0, 40),
      createdAt: Date.now(),
      points: clean,
      estimateM: estimateTrackLengthM(clean),
      ...(geo ? { geo } : {}),
    };
    try {
      await db.tracks.add(track);
    } catch (err) {
      logger.error('track save failed', err);
      return null;
    }
    set({ tracks: [track, ...get().tracks] });
    return track;
  },
  remove: async ({ id }) => {
    try {
      await db.tracks.delete(id);
    } catch (err) {
      logger.warn('track delete failed', err);
      return;
    }
    set({ tracks: get().tracks.filter((t) => t.id !== id) });
  },
}));
