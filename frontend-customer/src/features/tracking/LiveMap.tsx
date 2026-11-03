/** LiveMap: live delivery tracking on real Google Maps, schematic fallback.
 * Google Maps only when `VITE_GOOGLE_MAPS_KEY` is set (same loader path as
 * the address picker in `lib/maps.ts`): restaurant + home markers, the
 * server route (`route_polyline`, decoded locally — empty means estimated
 * straight line), the courier dot animated smoothly between GPS fixes, ETA
 * caption, and the Google-required walking/cycling beta disclaimer straight
 * from the server (`route_warning`). Without a key (or when Maps fails to
 * load) the schematic SVG animator below renders the same props instead.
 * Privacy: the courier dot only exists while the backend shares a live
 * position (active delivery); past routes and home details never render. */

import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui';
import {
  decodePolyline,
  detachMarker,
  ensureMaps,
  mapsKey,
  mapsMapId,
  moveMarker,
  resetMapsLoad,
  type GoogleMapsNs,
  type LatLng,
  type MapsMap,
  type MapsMarker,
  type MapsPolyline,
} from '../../lib/maps';
import { logger } from '../../lib/logger';

export type MapPin = { lat: number; lng: number; label: string };

export type LiveCourier = {
  pos: LatLng;
  name: string;
  mode: string;
  photoUrl?: string;
  updatedAt: string | null;
};

/** Live delivery map: Google tiles when configured, schematic otherwise. */
export function LiveMap(args: {
  pickup: MapPin;
  dropoff: MapPin;
  courier: LiveCourier | null;
  routePolyline: string;
  routeWarning: string;
  progress: number;
  etaText: string;
  statusText: string;
}) {
  const { t } = useTranslation();
  const key = mapsKey();
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  function retry() {
    resetMapsLoad();
    setFailed(null);
    setAttempt((a) => a + 1);
  }

  const updated = args.courier?.updatedAt
    ? new Date(args.courier.updatedAt)
    : null;
  const updatedText = updated && !Number.isNaN(updated.getTime())
    ? t('track.updatedAt').replace(
        '{time}',
        new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit', second: '2-digit' }).format(updated),
      )
    : '';

  return (
    <figure className="tb-map" aria-label={t('track.liveMap').replace('{status}', args.statusText)}>
      {key && !failed ? (
        <GoogleLiveMap
          pickup={args.pickup}
          dropoff={args.dropoff}
          courier={args.courier}
          routePolyline={args.routePolyline}
          attempt={attempt}
          onFailed={(detail) => setFailed(detail)}
        />
      ) : (
        <SchematicMap
          pickup={args.pickup}
          dropoff={args.dropoff}
          courierPos={args.courier?.pos ?? null}
          progress={args.progress}
        />
      )}
      {failed && (
        <div className="mt-2 px-3 pb-1">
          <Button variant="soft" size="sm" block onClick={retry}>{t('track.mapRetry')}</Button>
        </div>
      )}
      {!key && <p className="tb-sub px-3 pb-1">{t('track.schematicMap')}</p>}
      <figcaption className="tb-map-cap">
        <span className="tb-map-eta">{args.etaText}</span>
        <span>{args.statusText}</span>
        {updatedText && args.courier && <span className="tb-sub">{updatedText}</span>}
      </figcaption>
      {args.routeWarning && <p className="tb-sub px-3 pb-2" role="note">{args.routeWarning}</p>}
    </figure>
  );
}

/* ------------------------- Google live map ------------------------- */

function courierContent(courier: LiveCourier): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tb-live-courier';
  el.title = courier.name;
  if (courier.photoUrl) {
    const img = document.createElement('img');
    img.src = courier.photoUrl;
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    el.appendChild(img);
  } else {
    el.textContent = (courier.name || '?').slice(0, 1).toUpperCase();
  }
  return el;
}

function makeCourierMarker(args: {
  g: GoogleMapsNs;
  map: MapsMap;
  mapId: string | null;
  courier: LiveCourier;
}): MapsMarker {
  const title = `${args.courier.name} · ${args.courier.mode}`;
  // Advanced markers need a Cloud Console map id; without one the classic
  // marker below renders the same dot on any key.
  if (args.mapId) {
    try {
      const Advanced = args.g.marker?.AdvancedMarkerElement;
      if (Advanced) {
        return new Advanced({
          map: args.map,
          position: args.courier.pos,
          content: courierContent(args.courier),
          title,
        });
      }
    } catch (err) {
      logger.warn('advanced courier marker unavailable, classic fallback', {
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return new args.g.Marker({
    map: args.map,
    position: args.courier.pos,
    title,
    label: { text: (args.courier.name || '?').slice(0, 1).toUpperCase(), color: '#09090b', fontWeight: '800' },
  });
}

/** Ease-out interpolation of the courier dot between GPS fixes. */
function animateMarker(args: {
  marker: MapsMarker;
  from: LatLng;
  to: LatLng;
  stop: { cancelled: boolean };
}): void {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) {
    moveMarker(args.marker, args.to);
    return;
  }
  const start = performance.now();
  const dur = 700;
  function tick(now: number) {
    if (args.stop.cancelled) return;
    const k = Math.min((now - start) / dur, 1);
    const ease = 1 - (1 - k) * (1 - k);
    moveMarker(args.marker, {
      lat: args.from.lat + (args.to.lat - args.from.lat) * ease,
      lng: args.from.lng + (args.to.lng - args.from.lng) * ease,
    });
    if (k < 1) requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
}

function GoogleLiveMap(args: {
  pickup: MapPin;
  dropoff: MapPin;
  courier: LiveCourier | null;
  routePolyline: string;
  attempt: number;
  onFailed: (detail: string) => void;
}) {
  const { t } = useTranslation();
  const divRef = useRef<HTMLDivElement>(null);
  const failedRef = useRef(args.onFailed);
  failedRef.current = args.onFailed;
  const liveRef = useRef<{
    g: GoogleMapsNs;
    map: MapsMap;
    mapId: string | null;
    courierMarker: MapsMarker | null;
    courierShown: LatLng | null;
    anim: { cancelled: boolean };
    casing: MapsPolyline | null;
    route: MapsPolyline | null;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const propsRef = useRef(args);
  propsRef.current = args;

  useEffect(() => {
    if (!divRef.current) return;
    let cancelled = false;
    setLoading(true);
    async function build(): Promise<void> {
      try {
        // Resolves only once the `maps` library initialised, so a fresh
        // first visit can no longer outrun the bootstrap (Retry path).
        const g = (await ensureMaps()).maps;
        if (cancelled || !divRef.current) return;
        const mapId = mapsMapId();
        const map = new g.Map(divRef.current, {
          center: { lat: args.pickup.lat, lng: args.pickup.lng },
          zoom: 14,
          ...(mapId ? { mapId } : {}),
          streetViewControl: false,
          mapTypeControl: false,
        });
        const pickupMarker = new g.Marker({
          map,
          position: { lat: args.pickup.lat, lng: args.pickup.lng },
          title: args.pickup.label,
          label: { text: '◉', color: '#065f46', fontSize: '14px' },
        });
        const dropMarker = new g.Marker({
          map,
          position: { lat: args.dropoff.lat, lng: args.dropoff.lng },
          title: args.dropoff.label,
          label: { text: '⌂', color: '#09090b', fontSize: '14px' },
        });
        void pickupMarker;
        void dropMarker;
        const casing = new g.Polyline({
          map,
          path: [],
          geodesic: true,
          strokeColor: '#ffffff',
          strokeOpacity: 0.9,
          strokeWeight: 7,
        });
        const route = new g.Polyline({
          map,
          path: [],
          geodesic: true,
          strokeColor: '#09090b',
          strokeOpacity: 1,
          strokeWeight: 4,
        });
        liveRef.current = { g, map, mapId, courierMarker: null, courierShown: null, anim: { cancelled: false }, casing, route };
        setLoading(false);
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        logger.error('live map failed to load', { detail });
        if (!cancelled) {
          setLoading(false);
          failedRef.current(detail);
        }
      }
    }
    void build();
    return () => {
      cancelled = true;
      const live = liveRef.current;
      liveRef.current = null;
      if (live) {
        live.anim.cancelled = true;
        if (live.courierMarker) detachMarker(live.courierMarker);
        try {
          live.casing?.setMap(null);
          live.route?.setMap(null);
        } catch {
          /* map already torn down */
        }
      }
    };
    // Rebuild only on Retry; live data flows through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.attempt]);

  useEffect(() => {
    const live = liveRef.current;
    if (!live || loading) return;
    const { g, map } = live;
    const path = propsRef.current.routePolyline
      ? decodePolyline(propsRef.current.routePolyline)
      : [propsRef.current.pickup, propsRef.current.dropoff];
    live.casing?.setPath(path);
    live.route?.setPath(path);
    const bounds = new g.LatLngBounds();
    bounds.extend({ lat: propsRef.current.pickup.lat, lng: propsRef.current.pickup.lng });
    bounds.extend({ lat: propsRef.current.dropoff.lat, lng: propsRef.current.dropoff.lng });
    if (propsRef.current.courier) bounds.extend(propsRef.current.courier.pos);
    map.fitBounds(bounds, 48);
  }, [loading, args.pickup, args.dropoff, args.routePolyline, args.courier?.pos.lat, args.courier?.pos.lng]);

  useEffect(() => {
    const live = liveRef.current;
    if (!live || loading) return;
    const fix = propsRef.current.courier;
    if (!fix) return;
    if (!live.courierMarker) {
      live.courierMarker = makeCourierMarker({ g: live.g, map: live.map, mapId: live.mapId, courier: fix });
      live.courierShown = fix.pos;
      return;
    }
    const from = live.courierShown ?? fix.pos;
    live.anim.cancelled = true;
    const stop = { cancelled: false };
    live.anim = stop;
    live.courierShown = fix.pos;
    animateMarker({ marker: live.courierMarker, from, to: fix.pos, stop });
  }, [loading, args.courier?.pos.lat, args.courier?.pos.lng]);

  return (
    <div>
      <div ref={divRef} className="tb-gmap" role="application" aria-label={t('track.liveMap').replace('{status}', '')} />
      {loading && <p className="tb-sub mt-2 px-3">{t('track.mapLoading')}</p>}
    </div>
  );
}

/* ------------------------- schematic fallback ------------------------- */

const W = 400;
const H = 300;
const PAD = 44;

function project(pins: MapPin[]): Array<{ x: number; y: number }> {
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  let minLat = Math.min(...lats);
  let maxLat = Math.max(...lats);
  let minLng = Math.min(...lngs);
  let maxLng = Math.max(...lngs);
  if (maxLat - minLat < 0.002) {
    minLat -= 0.001;
    maxLat += 0.001;
  }
  if (maxLng - minLng < 0.002) {
    minLng -= 0.001;
    maxLng += 0.001;
  }
  return pins.map((p) => ({
    x: PAD + ((p.lng - minLng) / (maxLng - minLng)) * (W - PAD * 2),
    y: PAD + ((maxLat - p.lat) / (maxLat - minLat)) * (H - PAD * 2),
  }));
}

function routePath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2 - Math.abs(to.x - from.x) * 0.12 - 14;
  return `M ${from.x} ${from.y} Q ${mx} ${my} ${to.x} ${to.y}`;
}

/** Schematic map with an animated courier marker along the route. */
function SchematicMap(args: {
  pickup: MapPin;
  dropoff: MapPin;
  courierPos: LatLng | null;
  progress: number;
}) {
  const [pickupPt, dropPt] = project([args.pickup, args.dropoff]);
  const pathRef = useRef<SVGPathElement>(null);
  const target = args.courierPos ? null : Math.min(Math.max(args.progress, 0), 1);
  const fracRef = useRef(0);
  const [dot, setDot] = useState({ x: pickupPt.x, y: pickupPt.y });

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const total = path.getTotalLength();
    let goal = target ?? 0;
    if (args.courierPos) {
      const [c] = project([args.pickup, args.dropoff, { ...args.courierPos, label: '' }]);
      const guess = total === 0 ? 0 : nearestFraction(path, total, c ?? { x: 0, y: 0 });
      goal = guess;
    }
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduce) {
      fracRef.current = goal;
      const pt = path.getPointAtLength(goal * total);
      setDot({ x: pt.x, y: pt.y });
      return;
    }
    let raf = 0;
    const tick = () => {
      const cur = fracRef.current;
      const next = cur + (goal - cur) * 0.08;
      fracRef.current = Math.abs(goal - next) < 0.002 ? goal : next;
      const pt = path.getPointAtLength(fracRef.current * total);
      setDot({ x: pt.x, y: pt.y });
      if (fracRef.current !== goal) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [args.courierPos, args.dropoff, args.pickup, target]);

  const d = routePath(pickupPt, dropPt);
  const gridLines = (() => {
    const lines = [];
    for (let x = 20; x < W; x += 40) lines.push(<line key={`v${x}`} x1={x} y1={0} x2={x} y2={H} className="tb-map-grid" />);
    for (let y = 20; y < H; y += 40) lines.push(<line key={`h${y}`} x1={0} y1={y} x2={W} y2={H} className="tb-map-grid" />);
    return lines;
  })();
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
      {gridLines}
      <path d={d} className="tb-map-route-bg" />
      <path d={d} className="tb-map-route" ref={pathRef} />
      <g className="tb-map-pin">
        <circle cx={pickupPt.x} cy={pickupPt.y} r="9" />
        <text x={pickupPt.x} y={pickupPt.y + 4}>◉</text>
      </g>
      <g className="tb-map-home">
        <circle cx={dropPt.x} cy={dropPt.y} r="9" />
        <text x={dropPt.x} y={dropPt.y + 4}>⌂</text>
      </g>
      <g className="tb-map-courier" style={{ transform: `translate(${dot.x}px, ${dot.y}px)` }}>
        <circle r="13" className="tb-map-courier-halo" />
        <circle r="13" />
        <text y={5}>●</text>
      </g>
    </svg>
  );
}

/** Fraction along the path closest to a GPS fix (for the live feed). */
function nearestFraction(path: SVGPathElement, total: number, c: { x: number; y: number }): number {
  let best = 0;
  let bestDist = Number.POSITIVE_INFINITY;
  for (let f = 0; f <= 1.0001; f += 0.05) {
    const pt = path.getPointAtLength(f * total);
    const dist = (pt.x - c.x) ** 2 + (pt.y - c.y) ** 2;
    if (dist < bestDist) {
      bestDist = dist;
      best = f;
    }
  }
  return Math.min(best, 1);
}
