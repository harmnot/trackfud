/** LiveMap: schematic live map (courier marker, route, ETA).
 * Uses real order data only: pickup/dropoff pins + a marker that animates
 * toward the latest known position (GPS fix from B4, else status waypoint).
 * Swap-in point for `@vis.gl/react-google-maps` keeps these same props. */

import { useEffect, useRef, useState } from 'react';

export type MapPin = { lat: number; lng: number; label: string };

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

/** Live map with an animated courier marker along the route. */
export function LiveMap(args: {
  pickup: MapPin;
  dropoff: MapPin;
  courier: { lat: number; lng: number } | null;
  progress: number;
  etaText: string;
  statusText: string;
}) {
  const [pickupPt, dropPt] = project([args.pickup, args.dropoff]);
  const pathRef = useRef<SVGPathElement>(null);
  const target = args.courier ? null : Math.min(Math.max(args.progress, 0), 1);
  const fracRef = useRef(0);
  const [dot, setDot] = useState({ x: pickupPt.x, y: pickupPt.y });

  useEffect(() => {
    const path = pathRef.current;
    if (!path) return;
    const total = path.getTotalLength();
    let goal = target ?? 0;
    if (args.courier) {
      const [c] = project([args.pickup, args.dropoff, { ...args.courier, label: '' }]);
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
  }, [args.courier, args.dropoff, args.pickup, target]);

  const d = routePath(pickupPt, dropPt);
  return (
    <figure className="tb-map" aria-label={`Live delivery map: ${args.statusText}`}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-hidden="true">
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
          <circle r="13" />
          <text y={5}>●</text>
        </g>
      </svg>
      <figcaption className="tb-map-cap">
        <span className="tb-map-eta">{args.etaText}</span>
        <span>{args.statusText}</span>
      </figcaption>
    </figure>
  );
}

/** Fraction along the path closest to a GPS fix (for the B4 live feed). */
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
