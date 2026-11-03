/**
 * Live route map for Run Mode: the planned track (amber sketch, white
 * snapped road route) plus the runner's live GPS trail (green) and moving
 * position dot. The map is created once — trail and dot update in place so
 * tracking never rebuilds mid-run. Follow mode pans to the runner; turning
 * it off frees the map for inspection.
 */
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Note } from '../../components/ui';
import { moveMarker, type LatLng, type MapsMarker, type MapsPolyline } from '../../lib/maps';
import { useMapView } from './useMapView';

export function LiveTrackMap(args: {
  center: LatLng;
  planned: LatLng[];
  snapped: LatLng[] | null;
  trail: LatLng[];
  live: LatLng | null;
  follow: boolean;
  onToggleFollow: () => void;
}): React.JSX.Element {
  const { center, planned, snapped, trail, live, follow, onToggleFollow } = args;
  const { t } = useTranslation();
  const view = useMapView({ center, zoom: 15 });
  const trailLine = useRef<{ map: object; line: MapsPolyline } | null>(null);
  const liveDot = useRef<{ map: object; pin: MapsMarker } | null>(null);

  // Planned route: drawn once per track (stable array identity from the caller).
  useEffect(() => {
    if (!view.maps || !view.map) return;
    const drawn: MapsPolyline[] = [];
    const bounds = new view.maps.maps.LatLngBounds();
    for (const p of planned) bounds.extend(p);
    if (planned.length > 0) view.map.fitBounds(bounds, 48);
    drawn.push(
      new view.maps.maps.Polyline({
        map: view.map,
        path: planned,
        geodesic: true,
        strokeColor: '#fbbf24',
        strokeOpacity: 0.85,
        strokeWeight: 4,
      }),
    );
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
    return () => {
      for (const line of drawn) {
        try {
          line.setMap(null);
        } catch {
          // Map already torn down; nothing left to detach.
        }
      }
    };
  }, [view.maps, view.map, planned, snapped]);

  // GPS trail + position dot: in-place updates, never a map rebuild.
  // Each handle is pinned to the map instance that owns it, so a map
  // re-create (new anchor) draws fresh instead of touching a dead map.
  useEffect(() => {
    if (!view.maps || !view.map) return;
    const owned = trailLine.current;
    if (!owned || owned.map !== view.map) {
      trailLine.current = {
        map: view.map,
        line: new view.maps.maps.Polyline({
          map: view.map,
          path: [],
          geodesic: true,
          strokeColor: '#34d399',
          strokeOpacity: 1,
          strokeWeight: 5,
        }),
      };
    }
    trailLine.current?.line.setPath(trail);
  }, [view.maps, view.map, trail]);

  useEffect(() => {
    if (!view.maps || !view.map || !live) return;
    const owned = liveDot.current;
    if (!owned || owned.map !== view.map) {
      liveDot.current = {
        map: view.map,
        pin: new view.maps.maps.Marker({ map: view.map, position: live, title: 'you' }),
      };
    } else {
      moveMarker(owned.pin, live);
    }
    if (follow) view.map.panTo(live);
  }, [view.maps, view.map, live, follow]);

  if (planned.length < 2) {
    return (
      <div className="mt-3"><Note tone="info">{t('run.noGeoTrack')}</Note></div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="tb-map" role="img" aria-label={t('run.liveRoute')}>
        <div ref={view.containerRef} />
        {view.status === 'loading' && <p className="tb-map-badge">{t('common.loading')}</p>}
        {view.status === 'error' && (
          <div className="tb-map-badge tb-map-err">
            <Note tone="error">{view.error}</Note>
            <div className="mt-2"><Button variant="soft" onClick={view.retry}>{t('common.retry')}</Button></div>
          </div>
        )}
      </div>
      <Button variant="soft" onClick={onToggleFollow}>
        {follow ? t('run.following') : t('run.follow')}
      </Button>
    </div>
  );
}
