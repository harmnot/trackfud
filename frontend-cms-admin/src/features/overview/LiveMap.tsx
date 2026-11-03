/** Live ops map: online couriers + active dropoffs on one view.
 *
 * Google Maps JS when a browser key is set (`VITE_GOOGLE_MAPS_KEY`), with
 * classic markers (no map id needed); otherwise a schematic SVG fallback
 * that plots the same dots on a relative grid — reviewers always see the
 * couriers, key or no key. Markers refresh in place on every poll; the map
 * fits once and offers Recenter instead of yanking the admin's pan.
 */
import { useEffect, useRef, useState } from 'react';
import {
  loadMaps,
  mapsMapId,
  resetMapsLoad,
  type MapsMap,
  type MapsMarker,
} from '../../lib/maps';
import { Note } from '../../components/ui';
import type { ActiveOrder, LiveCourier } from './types';

type Props = {
  couriers: LiveCourier[];
  orders: ActiveOrder[];
};

type MapState = 'loading' | 'ready' | 'schematic' | 'error';

const BUSY = new Set(['assigned', 'at_pickup', 'picked_up', 'at_dropoff']);

function busyOf(c: LiveCourier): boolean {
  return c.delivery_id !== '' || BUSY.has(c.delivery_status);
}

export function LiveMap({ couriers, orders }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapsMap | null>(null);
  const markersRef = useRef(new Map<string, MapsMarker>());
  const fittedRef = useRef(false);
  const gRef = useRef<Awaited<ReturnType<typeof loadMaps>> | null>(null);
  const [state, setState] = useState<MapState>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    setState('loading');
    loadMaps()
      .then((g) => {
        if (!live || !elRef.current) return;
        gRef.current = g;
        const center =
          couriers.length > 0
            ? { lat: couriers[0]?.lat ?? 0, lng: couriers[0]?.lng ?? 0 }
            : { lat: -6.2, lng: 106.85 };
        const opts: { center: typeof center; zoom: number; mapId?: string } = {
          center,
          zoom: 13,
        };
        const mapId = mapsMapId();
        if (mapId) opts.mapId = mapId;
        mapRef.current = new g.maps.Map(elRef.current, opts);
        fittedRef.current = false;
        setState('ready');
      })
      .catch(() => {
        if (live) setState('schematic');
      });
    return () => {
      live = false;
    };
    // Boot once per retry; live dots update through the sync effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  // Sync markers with the latest poll without rebuilding the map.
  useEffect(() => {
    const g = gRef.current;
    const map = mapRef.current;
    if (state !== 'ready' || !g || !map) return;
    const seen = new Set<string>();
    for (const c of couriers) {
      const key = `c:${c.user_id}`;
      seen.add(key);
      const pos = { lat: c.lat, lng: c.lng };
      const existing = markersRef.current.get(key);
      if (existing) {
        existing.setPosition(pos);
        existing.setTitle(`${c.email} · ${c.mode}${busyOf(c) ? ' · on delivery' : ''}`);
      } else {
        markersRef.current.set(
          key,
          new g.maps.Marker({
            map,
            position: pos,
            title: `${c.email} · ${c.mode}`,
            label: { text: busyOf(c) ? '●' : '○', color: busyOf(c) ? '#fbbf24' : '#34d399' },
          }),
        );
      }
    }
    for (const o of orders) {
      if (!o.dropoff) continue;
      const key = `o:${o.id}`;
      seen.add(key);
      if (!markersRef.current.has(key)) {
        markersRef.current.set(
          key,
          new g.maps.Marker({
            map,
            position: o.dropoff,
            title: `${o.code} · ${o.status}`,
            label: { text: '■', color: '#e2e8f0' },
          }),
        );
      } else {
        markersRef.current.get(key)?.setPosition(o.dropoff);
      }
    }
    for (const [key, marker] of markersRef.current) {
      if (!seen.has(key)) {
        marker.setMap(null);
        markersRef.current.delete(key);
      }
    }
    if (!fittedRef.current && (couriers.length > 0 || orders.length > 0)) {
      fittedRef.current = true;
      const bounds = new g.maps.LatLngBounds();
      for (const c of couriers) bounds.extend({ lat: c.lat, lng: c.lng });
      for (const o of orders) {
        if (o.dropoff) bounds.extend(o.dropoff);
      }
      map.fitBounds(bounds, 48);
    }
  }, [state, couriers, orders]);

  useEffect(() => {
    const markers = markersRef.current;
    return () => {
      for (const marker of markers.values()) {
        try {
          marker.setMap(null);
        } catch {
          // Map already torn down.
        }
      }
      markers.clear();
      mapRef.current = null;
      gRef.current = null;
    };
  }, []);

  function retry() {
    resetMapsLoad();
    markersRef.current.clear();
    mapRef.current = null;
    gRef.current = null;
    setAttempt((n) => n + 1);
  }

  function recenter() {
    const g = gRef.current;
    const map = mapRef.current;
    if (!g || !map) return;
    const bounds = new g.maps.LatLngBounds();
    for (const c of couriers) bounds.extend({ lat: c.lat, lng: c.lng });
    for (const o of orders) {
      if (o.dropoff) bounds.extend(o.dropoff);
    }
    map.fitBounds(bounds, 48);
  }

  if (state === 'schematic') {
    return <SchematicMap couriers={couriers} orders={orders} onRetry={retry} />;
  }

  return (
    <div className="tb-mapwrap">
      <div ref={elRef} className="tb-map" role="application" aria-label="Live courier map" />
      {state === 'loading' && <div className="tb-skel tb-map" aria-label="Map loading" />}
      {state === 'error' && (
        <Note tone="error">
          The live map failed to start. <button className="tb-link" onClick={retry}>Retry</button>
        </Note>
      )}
      {state === 'ready' && (
        <div className="tb-mapbar">
          <span className="tb-legend">
            <i className="dot free" aria-hidden /> free
            <i className="dot busy" aria-hidden /> on delivery
            <i className="sq" aria-hidden /> dropoff
          </span>
          <button type="button" className="tb-link" onClick={recenter}>
            Recenter
          </button>
        </div>
      )}
    </div>
  );
}

/** Key-less fallback: the same dots plotted on a relative grid. */
function SchematicMap({
  couriers,
  orders,
  onRetry,
}: Props & { onRetry: () => void }) {
  const W = 100;
  const H = 62;
  const points = [
    ...couriers.map((c) => ({ lat: c.lat, lng: c.lng })),
    ...orders.flatMap((o) => (o.dropoff ? [o.dropoff] : [])),
  ];
  if (points.length === 0) {
    return (
      <div className="tb-card">
        <p className="tb-sub">No live positions right now — couriers appear here while their sessions stream GPS.</p>
        <p className="tb-sub">
          <button type="button" className="tb-link" onClick={onRetry}>
            Try the full map
          </button>
        </p>
      </div>
    );
  }
  let minLat = Infinity;
  let maxLat = -Infinity;
  let minLng = Infinity;
  let maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  if (maxLat - minLat < 0.002) {
    const mid = (maxLat + minLat) / 2;
    minLat = mid - 0.001;
    maxLat = mid + 0.001;
  }
  if (maxLng - minLng < 0.002) {
    const mid = (maxLng + minLng) / 2;
    minLng = mid - 0.001;
    maxLng = mid + 0.001;
  }
  const padLat = (maxLat - minLat) * 0.12;
  const padLng = (maxLng - minLng) * 0.12;
  minLat -= padLat;
  maxLat += padLat;
  minLng -= padLng;
  maxLng += padLng;
  const x = (lng: number): number => ((lng - minLng) / (maxLng - minLng)) * W;
  const y = (lat: number): number => ((maxLat - lat) / (maxLat - minLat)) * H;

  return (
    <div className="tb-mapwrap">
      <svg
        className="tb-map tb-schematic"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Schematic map: ${couriers.length} couriers, ${orders.length} active orders`}
      >
        {Array.from({ length: 7 }, (_, i) => (
          <line key={`v${i}`} x1={(W / 6) * i} y1={0} x2={(W / 6) * i} y2={H} className="grid" />
        ))}
        {Array.from({ length: 5 }, (_, i) => (
          <line key={`h${i}`} x1={0} y1={(H / 4) * i} x2={W} y2={(H / 4) * i} className="grid" />
        ))}
        {orders.flatMap((o, i) =>
          o.dropoff ? [<rect key={o.id} x={x(o.dropoff.lng) - 1} y={y(o.dropoff.lat) - 1} width={2} height={2} className="pin" />] : [<g key={i} />],
        )}
        {couriers.map((c) => (
          <g key={c.user_id}>
            <circle cx={x(c.lng)} cy={y(c.lat)} r={2.2} className={busyOf(c) ? 'courier busy' : 'courier free'} />
            <text x={x(c.lng) + 3} y={y(c.lat) + 1.2} className="tag">
              {c.email.split('@')[0]?.slice(0, 12) ?? 'courier'}
            </text>
          </g>
        ))}
      </svg>
      <div className="tb-mapbar">
        <span className="tb-legend">
          <i className="dot free" aria-hidden /> free
          <i className="dot busy" aria-hidden /> on delivery
          <i className="sq" aria-hidden /> dropoff
          <span className="tb-faint">schematic — add VITE_GOOGLE_MAPS_KEY for streets</span>
        </span>
        <button type="button" className="tb-link" onClick={onRetry}>
          Try the full map
        </button>
      </div>
    </div>
  );
}
