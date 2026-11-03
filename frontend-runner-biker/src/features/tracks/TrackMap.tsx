/**
 * Embedded preview map for a sketch: the raw sketch projection (amber)
 * plus the snapped road route (white) when routing succeeded. Schematic
 * fallback when the Maps key is missing — never a blank box.
 */
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Note } from '../../components/ui';
import { detachMarker, type LatLng, type MapsMarker, type MapsPolyline } from '../../lib/maps';
import { useMapView } from './useMapView';

export function TrackMap(args: {
  center: LatLng;
  sketch: LatLng[];
  snapped: LatLng[] | null;
}): React.JSX.Element {
  const { center, sketch, snapped } = args;
  const { t } = useTranslation();
  const view = useMapView({ center, zoom: 15 });

  // Static drawing: rebuilds only when the sketch changes (preview memos
  // keep array identity stable, so typing a track name never redraws).
  useEffect(() => {
    if (!view.maps || !view.map) return;
    const drawn: MapsPolyline[] = [];
    const pins: MapsMarker[] = [];
    const bounds = new view.maps.maps.LatLngBounds();
    const show = snapped && snapped.length >= 2 ? snapped : sketch;
    for (const p of show) bounds.extend(p);
    if (show.length > 0) view.map.fitBounds(bounds, 48);
    if (sketch.length >= 2) {
      drawn.push(
        new view.maps.maps.Polyline({
          map: view.map,
          path: sketch,
          geodesic: true,
          strokeColor: '#fbbf24',
          strokeOpacity: 0.9,
          strokeWeight: 4,
        }),
      );
    }
    if (snapped && snapped.length >= 2) {
      drawn.push(
        new view.maps.maps.Polyline({
          map: view.map,
          path: snapped,
          geodesic: true,
          strokeColor: '#ffffff',
          strokeOpacity: 1,
          strokeWeight: 3,
        }),
      );
    }
    const start = show[0];
    if (start) pins.push(new view.maps.maps.Marker({ map: view.map, position: start, title: 'start' }));
    return () => {
      for (const line of drawn) {
        try {
          line.setMap(null);
        } catch {
          // Map already torn down; nothing left to detach.
        }
      }
      for (const pin of pins) detachMarker(pin);
    };
  }, [view.maps, view.map, sketch, snapped]);

  return (
    <div className="tb-map" role="img" aria-label={t('tracks.mapPreview')}>
      <div ref={view.containerRef} />
      {view.status === 'loading' && <p className="tb-map-badge">{t('common.loading')}</p>}
      {view.status === 'error' && (
        <div className="tb-map-badge tb-map-err">
          <Note tone="error">{view.error}</Note>
          <div className="mt-2"><Button variant="soft" onClick={view.retry}>{t('common.retry')}</Button></div>
        </div>
      )}
    </div>
  );
}
