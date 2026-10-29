/** Google map pin picker for the customer address book.
 * Google Maps only when `VITE_GOOGLE_MAPS_KEY` is set (tap/drag the pin,
 * Places autocomplete, Google geocode search, or paste "lat, lng");
 * a schematic tap-to-pin fallback otherwise. No secret ever leaves the
 * server: this is the public browser key, restricted by HTTP referrer.
 * NOTE: Vite embeds VITE_* vars at dev-server start — after editing .env,
 * restart `pnpm dev` and hard-refresh (the PWA service worker can serve
 * a stale bundle otherwise).
 *
 * Pick flow: moving the pin (tap / drag / place search) STAGES a candidate
 * and shows "Select this location"; only that button (plus GPS and pasted
 * "lat, lng", which are already explicit) calls onPick. */

import { useEffect, useRef, useState } from 'react';
import { Button, Note } from '../../components/ui';
import { parseLatLng } from './types';

declare global {
  interface Window {
    google?: any;
  }
}

const MAPS_CDN = 'https://maps.googleapis.com/maps/api/js?loading=async&libraries=places,marker';

type Staged = { lat: number; lng: number; address?: string };

function mapsKey(): string {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
  // Tolerate quotes/whitespace from hand-edited .env files.
  const k = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  return k;
}

let loadPromise: Promise<void> | null = null;

/** Load the Maps JS API once (referrer-restricted browser key). */
function loadMaps(): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject(new Error('no window'));
  if (window.google?.maps) return Promise.resolve();
  if (loadPromise) return loadPromise;
  const key = mapsKey();
  if (!key) return Promise.reject(new Error('missing key'));
  loadPromise = new Promise<void>((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = `${MAPS_CDN}&key=${encodeURIComponent(key)}`;
    tag.async = true;
    tag.defer = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      loadPromise = null;
      reject(new Error('maps script failed to load — check network/adblock and the key'));
    };
    document.head.appendChild(tag);
  });
  return loadPromise;
}

/** Bootstrap the libraries we use. The `loading=async` CDN script only
 * installs the bootstrap: `google.maps.Map` and friends are undefined until
 * importLibrary resolves, so building the map straight after script onload
 * fails on a fresh page load (and only works on Retry). */
async function ensureMaps(): Promise<any> {
  await loadMaps();
  const g = window.google;
  if (!g?.maps) throw new Error('Maps JS loaded but google.maps is missing (blocked key?)');
  if (typeof g.maps.importLibrary === 'function') {
    await g.maps.importLibrary('maps');
    try {
      await g.maps.importLibrary('marker');
    } catch (e) {
      console.warn('[GoogleMapPicker] marker library unavailable, classic marker fallback:', e);
    }
    try {
      await g.maps.importLibrary('places');
    } catch (e) {
      console.warn('[GoogleMapPicker] places library unavailable, no autocomplete:', e);
    }
  }
  if (!g.maps.Map) {
    throw new Error('Maps library did not initialise — check key restrictions and billing');
  }
  return g;
}

/** Read a position from either a classic LatLng (lat()/lng() methods) or an
 * AdvancedMarkerElement LatLngAltitude ({lat, lng} numeric props). */
function readPos(p: any): { lat: number; lng: number } | null {
  if (!p) return null;
  const lat = typeof p.lat === 'function' ? p.lat() : p.lat;
  const lng = typeof p.lng === 'function' ? p.lng() : p.lng;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Move either marker kind: classic Markers need setPosition, advanced
 * markers accept a position assignment. */
function moveMarker(marker: any, pos: { lat: number; lng: number }) {
  if (typeof marker.setPosition === 'function') marker.setPosition(pos);
  else marker.position = pos;
}

export function GoogleMapPicker(args: {
  lat: number;
  lng: number;
  onPick: (p: { lat: number; lng: number; address?: string }) => void;
}) {
  const key = mapsKey();
  const mapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mapObj = useRef<any>(null);
  const markerObj = useRef<any>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [msg, setMsg] = useState('');
  const [staged, setStaged] = useState<Staged | null>(null);
  const pickRef = useRef(args.onPick);
  pickRef.current = args.onPick;

  // Bumped by Retry so the loader effect below re-runs and rebuilds the map.
  const [attempt, setAttempt] = useState(0);

  function retry() {
    loadPromise = null;
    setFailed(null);
    setReady(false);
    setStaged(null);
    setAttempt((a) => a + 1);
  }

  /** Stage a candidate: move the pin and show the Select button. */
  function stage(s: Staged) {
    const marker = markerObj.current;
    if (marker) moveMarker(marker, s);
    setStaged(s);
  }

  /** Commit the staged candidate to the parent form. */
  function confirmStaged() {
    if (!staged) return;
    pickRef.current(staged);
    setStaged(null);
  }

  useEffect(() => {
    if (!key || !mapRef.current) return;
    let cancelled = false;
    let map: any = null;
    ensureMaps()
      .then((g) => {
        if (cancelled || !mapRef.current) return;
        map = new g.maps.Map(mapRef.current, {
          center: { lat: args.lat, lng: args.lng },
          zoom: 15,
          mapId: 'trackfud-customer-pin',
          streetViewControl: false,
          mapTypeControl: false,
        });
        mapObj.current = map;
        const marker =
          g.maps.marker?.AdvancedMarkerElement
            ? new g.maps.marker.AdvancedMarkerElement({
                map,
                position: { lat: args.lat, lng: args.lng },
                gmpDraggable: true,
              })
            : new g.maps.Marker({
                map,
                position: { lat: args.lat, lng: args.lng },
                draggable: true,
              });
        markerObj.current = marker;
        map.addListener('click', (e: any) => {
          const pos = readPos(e.latLng);
          if (!pos) return;
          stage(pos);
        });
        if (typeof marker.addListener === 'function') {
          // Drag end carries the drop point on classic Markers; advanced
          // markers expose it via marker.position (LatLngAltitude props).
          marker.addListener('dragend', (e: any) => {
            const pos = readPos(e?.latLng) ?? readPos(marker.position);
            if (pos) stage(pos);
          });
        }
        if (searchRef.current && g.maps.places?.Autocomplete) {
          const ac = new g.maps.places.Autocomplete(searchRef.current, { fields: ['geometry', 'formatted_address', 'name'] });
          ac.addListener('place_changed', () => {
            const place = ac.getPlace();
            const loc = readPos(place?.geometry?.location);
            if (!loc) return;
            map.panTo(loc);
            map.setZoom(16);
            stage({ ...loc, address: place.formatted_address ?? place.name });
          });
        }
        setReady(true);
      })
      .catch((e: unknown) => {
        const detail = e instanceof Error ? e.message : String(e);
        console.error('[GoogleMapPicker] Google Maps failed to load:', detail);
        if (!cancelled) setFailed(detail);
      });
    return () => {
      cancelled = true;
    };
    // Live position follows via the effect below; `attempt` re-runs after Retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);

  useEffect(() => {
    // Props changed from outside (typed coords, GPS, confirmed pick):
    // drop any unconfirmed candidate and follow the form values.
    setStaged(null);
    const map = mapObj.current;
    const marker = markerObj.current;
    if (!map || !marker || !window.google) return;
    const pos = new window.google.maps.LatLng(args.lat, args.lng);
    moveMarker(marker, pos);
    map.panTo(pos);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [args.lat, args.lng]);

  function useGps() {
    setMsg('');
    navigator.geolocation.getCurrentPosition(
      (p) => args.onPick({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => setMsg('GPS unavailable — tap the map or type coordinates.'),
    );
  }

  /** Google-only search: Places Autocomplete handles most queries inline;
   * the Search button covers pasted "lat, lng" plus the Google Geocoder.
   * A geocoded hit stages the pin like a tap; pasted coords apply at once. */
  async function search() {
    const q = query.trim();
    if (!q) return;
    setMsg('');
    const pasted = parseLatLng(q);
    if (pasted) {
      args.onPick(pasted);
      return;
    }
    if (!window.google?.maps || !ready) {
      setMsg('Place search needs Google Maps — paste "lat, lng" or use GPS.');
      return;
    }
    try {
      const geocoder = new window.google.maps.Geocoder();
      const res = await geocoder.geocode({ address: q });
      const loc = readPos(res?.results?.[0]?.geometry?.location);
      if (loc) {
        const map = mapObj.current;
        if (map) {
          map.panTo(loc);
          map.setZoom(16);
        }
        stage({ ...loc, address: res.results[0].formatted_address });
      } else {
        setMsg('No place found — try "lat, lng" or drag the pin.');
      }
    } catch {
      setMsg('Google search failed — try "lat, lng" or drag the pin.');
    }
  }

  function confirmBar() {
    if (!staged) return null;
    return (
      <div className="mt-2">
        <Note tone="info">
          Pin at {staged.lat.toFixed(6)}, {staged.lng.toFixed(6)}
          {staged.address ? ` — ${staged.address}` : ''}. Not saved yet.
        </Note>
        <div className="mt-2">
          <Button variant="ember" block onClick={confirmStaged}>
            ◎ Select this location
          </Button>
        </div>
      </div>
    );
  }

  if (!key || failed) {
    return (
      <div>
        <div
          role="application"
          aria-label="Pin map (schematic — add a Google Maps key for live tiles)"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const dx = (e.clientX - rect.left) / rect.width - 0.5;
            const dy = (e.clientY - rect.top) / rect.height - 0.5;
            setStaged({ lat: args.lat - dy * 0.02, lng: args.lng + dx * 0.02 });
          }}
          className="tb-map"
        >
          <span className="tb-pin" aria-hidden>
            📍
          </span>
          <p className="font-mono text-sm mt-1">
            {staged ? `${staged.lat.toFixed(6)}, ${staged.lng.toFixed(6)}` : `${args.lat.toFixed(6)}, ${args.lng.toFixed(6)}`}
          </p>
          <p className="text-xs mt-1" style={{ opacity: 0.75 }}>
            {!key
              ? 'Schematic map — the app was built without VITE_GOOGLE_MAPS_KEY. Restart `pnpm dev` after adding it to .env, then hard-refresh.'
              : `Google Maps failed to load (${failed}). Check DevTools → Network for maps.googleapis.com and allowlist this origin in the key's HTTP-referrer restrictions.`}
          </p>
        </div>
        <p className="tb-sub mt-2">
          Search by name needs Google Maps — paste "lat, lng" below or use GPS.
        </p>
        {failed && (
          <div className="mt-2">
            <Button variant="soft" block onClick={retry}>
              ↻ Retry Google Maps
            </Button>
          </div>
        )}
        <div className="mt-2">
          <Button variant="soft" block onClick={useGps}>
            ◎ Use my location
          </Button>
        </div>
        {confirmBar()}
        {msg && (
          <div className="mt-2">
            <Note tone="info">{msg}</Note>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="flex gap-2">
        <input
          ref={searchRef}
          className="tb-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Search place name or paste lat, lng…"
          aria-label="Search place by name or coordinates"
        />
        <Button variant="soft" onClick={() => void search()}>
          Search
        </Button>
      </div>
      <div className="mt-2">
        <Button variant="soft" block onClick={useGps}>
          ◎ Use my location
        </Button>
      </div>
      <div ref={mapRef} className="tb-gmap mt-2" role="application" aria-label="Google map pin picker" />
      {!ready && <p className="tb-sub mt-2">Loading Google Maps…</p>}
      {ready && !staged && (
        <p className="tb-sub mt-2">
          Tap the map or drag the pin, then confirm. {args.lat.toFixed(6)}, {args.lng.toFixed(6)}
        </p>
      )}
      {confirmBar()}
      {msg && (
        <div className="mt-2">
          <Note tone="info">{msg}</Note>
        </div>
      )}
    </div>
  );
}
