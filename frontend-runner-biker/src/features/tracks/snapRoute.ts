/**
 * Snap a sketch-derived path to real roads/paths via the Maps JS
 * `DirectionsService` (same browser key as every other map in this app —
 * no secret, no extra dependency). Returns the snapped polyline or null
 * when routing fails; callers keep the straight sketch line in that case
 * and say so honestly.
 */
import { logger } from '../../lib/logger';
import { readPos, type LatLng } from '../../lib/maps';
import { downsamplePath, isLoopLike, type TravelMode } from './sketchToGeo';

type DirectionsRequest = {
  origin: LatLng;
  destination: LatLng;
  waypoints: Array<{ location: LatLng; stopover: boolean }>;
  travelMode: string;
};

type DirectionsService = {
  route: (
    req: DirectionsRequest,
    cb: (res: unknown, status: string) => void,
  ) => void;
};

function serviceCtor(): (new () => DirectionsService) | null {
  const g = window.google as unknown as {
    maps?: { DirectionsService?: new () => DirectionsService; TravelMode?: Record<string, string> };
  };
  const Ctor = g.maps?.DirectionsService;
  return typeof Ctor === 'function' ? Ctor : null;
}

function travelModeOf(mode: TravelMode): string {
  const g = window.google as unknown as {
    maps?: { TravelMode?: Record<string, string> };
  };
  const table = g.maps?.TravelMode;
  if (mode === 'bicycling') return table?.['BICYCLING'] ?? 'BICYCLING';
  return table?.['WALKING'] ?? 'WALKING';
}

/** Pull `overview_path` (or leg/step paths as fallback) out of a response. */
function extractPath(res: unknown): LatLng[] {
  if (typeof res !== 'object' || res === null) return [];
  const routes = (res as { routes?: unknown }).routes;
  if (!Array.isArray(routes) || routes.length === 0) return [];
  const first = routes[0] as {
    overview_path?: unknown;
    legs?: Array<{ steps?: Array<{ path?: unknown }> }>;
  };
  const fromOverview = toLatLngList(first.overview_path);
  if (fromOverview.length >= 2) return fromOverview;
  const out: LatLng[] = [];
  for (const leg of first.legs ?? []) {
    for (const step of leg.steps ?? []) {
      for (const p of toLatLngList(step.path)) out.push(p);
    }
  }
  return out;
}

function toLatLngList(value: unknown): LatLng[] {
  if (!Array.isArray(value)) return [];
  const out: LatLng[] = [];
  for (const item of value) {
    const pos = readPos(item);
    if (pos) out.push(pos);
  }
  return out;
}

/**
 * Route the sketch through Directions (origin → waypoints → destination).
 * Loops close on the start point so a drawn circle becomes a round trip.
 */
export function snapSketchToRoads(args: {
  path: LatLng[];
  travelMode: TravelMode;
}): Promise<LatLng[] | null> {
  const { path, travelMode } = args;
  const Ctor = serviceCtor();
  if (!Ctor || path.length < 2) return Promise.resolve(null);
  const first = path[0];
  const last = path[path.length - 1];
  if (!first || !last) return Promise.resolve(null);
  const loop = isLoopLike({ path });
  const origin = first;
  const destination = loop ? first : last;
  const inner = loop ? path.slice(1) : path.slice(1, -1);
  const stops = downsamplePath({ path: inner, max: 20 });
  const svc = new Ctor();
  return new Promise((resolve) => {
    try {
      svc.route(
        {
          origin,
          destination,
          waypoints: stops.map((location) => ({ location, stopover: true })),
          travelMode: travelModeOf(travelMode),
        },
        (res: unknown, status: string) => {
          if (status !== 'OK') {
            logger.warn('sketch snap failed', { status });
            resolve(null);
            return;
          }
          const snapped = extractPath(res);
          resolve(snapped.length >= 2 ? snapped : null);
        },
      );
    } catch (err) {
      logger.warn('sketch snap error', err);
      resolve(null);
    }
  });
}
