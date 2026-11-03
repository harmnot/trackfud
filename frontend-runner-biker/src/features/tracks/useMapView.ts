/**
 * Shared Google Maps view: one container, one load, one map. Creation lives
 * here; drawing lives with the caller (static preview vs live tracking draw
 * different things on top of the same ready map).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { loadMaps, resetMapsLoad, type GoogleMaps, type LatLng, type MapsMap } from '../../lib/maps';

export type MapStatus = 'loading' | 'ready' | 'error';

export type MapView = {
  containerRef: React.RefObject<HTMLDivElement | null>;
  maps: GoogleMaps | null;
  map: MapsMap | null;
  status: MapStatus;
  error: string;
  retry: () => void;
};

export function useMapView(args: { center: LatLng; zoom: number }): MapView {
  const { center, zoom } = args;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [maps, setMaps] = useState<GoogleMaps | null>(null);
  const [map, setMap] = useState<MapsMap | null>(null);
  const [status, setStatus] = useState<MapStatus>('loading');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    resetMapsLoad();
    setAttempt((n) => n + 1);
  }, []);

  useEffect(() => {
    let live = true;
    const el = containerRef.current;
    if (!el) {
      setStatus('error');
      setError('map container missing');
      return () => undefined;
    }
    setStatus('loading');
    setError('');
    setMaps(null);
    setMap(null);
    void (async () => {
      try {
        const g = await loadMaps();
        if (!live) return;
        const m = new g.maps.Map(el, { center: { ...center }, zoom });
        if (!live) return;
        setMaps(g);
        setMap(m);
        setStatus('ready');
      } catch (err) {
        if (!live) return;
        setError(err instanceof Error ? err.message : 'map failed to load');
        setStatus('error');
      }
    })();
    return () => {
      live = false;
      el.replaceChildren();
    };
    // Re-create only on anchor/zoom change or explicit retry — live drawing
    // updates paths/markers in place so the map never rebuilds mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [center.lat, center.lng, zoom, attempt]);

  return { containerRef, maps, map, status, error, retry };
}
