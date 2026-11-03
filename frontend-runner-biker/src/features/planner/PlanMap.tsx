/**
 * Plan map: two AI loop options side by side on one embedded map — plan A in
 * amber, plan B in white — plus hotspot pins. Schematic list fallback when
 * the Maps key is missing; never a blank box.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Note } from '../../components/ui';
import { detachMarker, type LatLng, type MapsMarker, type MapsPolyline } from '../../lib/maps';
import { useMapView } from '../tracks/useMapView';
import type { PlannerHotspot, PlannerPlan } from './types';

export function PlanMap(args: {
  center: LatLng;
  plans: PlannerPlan[];
  hotspots: PlannerHotspot[];
  selectedId: string | null;
}): React.JSX.Element {
  const { center, plans, hotspots, selectedId } = args;
  const { t } = useTranslation();
  const view = useMapView({ center, zoom: 14 });

  useEffect(() => {
    const g = view.maps;
    const m = view.map;
    if (!g || !m) return;
    const drawn: MapsPolyline[] = [];
    const pins: MapsMarker[] = [];
    const bounds = new g.maps.LatLngBounds();
    const colors: Array<{ main: string; dim: string }> = [
      { main: '#fbbf24', dim: 'rgba(251,191,36,0.35)' },
      { main: '#ffffff', dim: 'rgba(255,255,255,0.35)' },
    ];
    plans.slice(0, 2).forEach((p, i) => {
      const c = colors[i] ?? colors[0];
      if (!c) return;
      const active = selectedId === null || selectedId === p.id;
      for (const w of p.waypoints) bounds.extend(w);
      drawn.push(
        new g.maps.Polyline({
          map: m,
          path: p.waypoints,
          geodesic: true,
          strokeColor: c.main,
          strokeOpacity: active ? 0.95 : 0.4,
          strokeWeight: selectedId === p.id ? 5 : 3,
        }),
      );
    });
    for (const h of hotspots.slice(0, 8)) {
      bounds.extend({ lat: h.lat, lng: h.lng });
      try {
        pins.push(new g.maps.Marker({ map: m, position: { lat: h.lat, lng: h.lng }, title: h.merchant_name }));
      } catch {
        // Marker construction is best-effort on partial Maps loads.
      }
    }
    if (plans.length > 0) {
      try {
        m.fitBounds(bounds, 48);
      } catch {
        // Fit is best-effort; the list below stays usable.
      }
    }
    return () => {
      for (const line of drawn) {
        try {
          line.setMap(null);
        } catch {
          // Map already torn down.
        }
      }
      for (const pin of pins) detachMarker(pin);
    };
  }, [view.maps, view.map, plans, hotspots, selectedId, center.lat, center.lng]);

  if (view.status === 'error') {
    return (
      <div className="tb-map" role="img" aria-label={t('planner.mapPreview')}>
        <div className="tb-map-badge tb-map-err">
          <Note tone="error">{view.error}</Note>
          <div className="mt-2">
            <Button variant="soft" onClick={view.retry}>{t('common.retry')}</Button>
          </div>
          <ul className="tb-plan-fallback">
            {plans.map((p) => (
              <li key={p.id}>{p.name} · {(p.distance_m / 1000).toFixed(1)} km</li>
            ))}
          </ul>
        </div>
      </div>
    );
  }
  return (
    <div className="tb-map" role="img" aria-label={t('planner.mapPreview')}>
      <div ref={view.containerRef} />
      {view.status === 'loading' && <p className="tb-map-badge">{t('common.loading')}</p>}
    </div>
  );
}
