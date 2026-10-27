/** Pure geodesic helpers. No GPS interpolation lives here — gaps stay gaps. */

export type LatLng = { lat: number; lng: number };

const EARTH_M = 6371000;

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Geodesic distance between two fixes in meters. */
export function haversineM(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.sqrt(s));
}

/** Bearing from a to b in degrees (0 = north). Used for wrong-way hints. */
export function bearingDeg(a: LatLng, b: LatLng): number {
  const dLng = toRad(b.lng - a.lng);
  const y = Math.sin(dLng) * Math.cos(toRad(b.lat));
  const x =
    Math.cos(toRad(a.lat)) * Math.sin(toRad(b.lat)) -
    Math.sin(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.cos(dLng);
  return (Math.atan2(y, x) * 180) / Math.PI;
}

/** Smallest angle between two headings in degrees (0–180). */
export function angleDiffDeg(a: number, b: number): number {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

export type SegmentClass = 'moving' | 'rest' | 'gap';

/**
 * Classify one segment between accepted fixes. Segments over
 * `gapAfterS` are gaps (recorded, never filled in); slow segments are
 * rest; the rest is moving time. Speeds past `teleportMps` are rejected
 * outright (teleport / spoof signal, app-context anti-cheat).
 */
export function classifySegment(args: {
  distM: number;
  dtS: number;
  gapAfterS: number;
  teleportMps: number;
}): SegmentClass | 'teleport' {
  if (args.dtS <= 0) return 'rest';
  if (args.dtS > args.gapAfterS) return 'gap';
  if (args.distM / args.dtS > args.teleportMps) return 'teleport';
  if (args.distM / args.dtS >= 0.5) return 'moving';
  return 'rest';
}
