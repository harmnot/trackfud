/**
 * Sketch → geography: turn a finger-drawn pad sketch into a real LatLng
 * loop anchored at a map center (Strava-art style).
 *
 * The pad is device-independent (0–100 in both axes). `spanM` is the real
 * width/height of the pad in meters at the anchor — a circle drawn edge to
 * edge becomes a loop roughly `spanM` across. Orientation is preserved:
 * pad-up is map-north, pad-right is map-east, so what you draw is what you
 * see on the map.
 */
import { haversineM } from '../../lib/geo';
import type { LatLng } from '../../lib/maps';
import type { PadPoint } from './trackStore';

const METERS_PER_DEG_LAT = 111_320;

/** Project normalized pad points onto the map around `center`. */
export function sketchToLatLng(args: {
  points: PadPoint[];
  center: LatLng;
  spanM: number;
  /**
   * Pad width ÷ height at draw time (measured, default 1). Meters-per-pixel
   * stay equal on both axes so a drawn circle stays a circle on the map:
   * the longer axis gets the full `spanM`, the shorter scales proportionally.
   */
  aspect?: number;
}): LatLng[] {
  const { points, center, spanM, aspect = 1 } = args;
  if (points.length === 0 || !Number.isFinite(spanM) || spanM <= 0) return [];
  const safeAspect = Number.isFinite(aspect) && aspect > 0 ? aspect : 1;
  const spanX = safeAspect >= 1 ? spanM : spanM * safeAspect;
  const spanY = safeAspect >= 1 ? spanM / safeAspect : spanM;
  const halfX = spanX / 2;
  const halfY = spanY / 2;
  const cosLat = Math.max(0.2, Math.cos((center.lat * Math.PI) / 180));
  return points
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
    .map((p) => {
      const dx = (p.x - 50) / 50;
      const dy = (p.y - 50) / 50;
      return {
        lat: center.lat - (dy * halfY) / METERS_PER_DEG_LAT,
        lng: center.lng + (dx * halfX) / (METERS_PER_DEG_LAT * cosLat),
      };
    });
}

/** Geodesic length of a geographic path in meters (consecutive legs only). */
export function geoLengthM(path: LatLng[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const a = path[i - 1];
    const b = path[i];
    if (!a || !b) continue;
    total += haversineM(a, b);
  }
  return Math.round(total);
}

/** True when the sketch reads as a loop (ends near where it started). */
export function isLoopLike(args: { path: LatLng[] }): boolean {
  const { path } = args;
  if (path.length < 4) return false;
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return false;
  const length = geoLengthM(path);
  if (length <= 0) return false;
  return haversineM(first, last) < length * 0.15;
}

/** Evenly thin a path to at most `max` points (keeps first + last). */
export function downsamplePath(args: { path: LatLng[]; max: number }): LatLng[] {
  const { path, max } = args;
  if (path.length <= max || max < 2) return path.slice();
  const out: LatLng[] = [];
  const step = (path.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    const p = path[Math.round(i * step)];
    if (p) out.push(p);
  }
  return out;
}

export type TravelMode = 'walking' | 'bicycling';

/** External Google Maps directions URL for a path (opens in a new tab). */
export function buildMapsDirUrl(args: {
  path: LatLng[];
  travelMode: TravelMode;
}): string | null {
  const { path, travelMode } = args;
  if (path.length < 2) return null;
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return null;
  const loop = isLoopLike({ path });
  const origin = first;
  const destination = loop ? first : last;
  const middle = downsamplePath({
    path: path.slice(1, loop ? undefined : -1),
    max: 8,
  });
  const fmt = (p: LatLng): string => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const params = new URLSearchParams({
    api: '1',
    origin: fmt(origin),
    destination: fmt(destination),
    travelmode: travelMode,
  });
  if (middle.length > 0) params.set('waypoints', middle.map(fmt).join('|'));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
