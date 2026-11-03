/** Google map pin picker for the store setup screen.
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
import { Button, Note, TextInput } from '../../components/ui';
import { logger } from '../../lib/logger';
import {
  ensureMaps,
  mapsKey,
  mapsMapId,
  moveMarker,
  readPos,
  resetMapsLoad,
  type GoogleMapsNs,
  type MapsAutocomplete,
  type MapsMap,
  type MapsMarker,
} from '../../lib/maps';

/** Parse a pasted "lat, lng" pair (e.g. "-6.2088, 106.8456"). */
function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.trim().replace(/[()]/g, '').split(/[,;\s]+/).filter(Boolean);
  if (m.length !== 2) return null;
  const lat = Number(m[0]);
  const lng = Number(m[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}

type Staged = { lat: number; lng: number; address?: string };

export function GoogleMapPicker(args: {
  lat: number;
  lng: number;
  onPick: (p: { lat: number; lng: number; address?: string }) => void;
}) {
  const key = mapsKey();
  const mapRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const nsObj = useRef<GoogleMapsNs | null>(null);
  const mapObj = useRef<MapsMap | null>(null);
  const markerObj = useRef<MapsMarker | null>(null);
  const autoObj = useRef<MapsAutocomplete | null>(null);
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
    resetMapsLoad();
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
    async function build(): Promise<void> {
      try {
        // Resolves only once the `maps` library initialised, so a fresh
        // first visit can no longer outrun the bootstrap (Retry path).
        const g = (await ensureMaps()).maps;
        if (cancelled || !mapRef.current) return;
        nsObj.current = g;
        const mapId = mapsMapId();
        const map = new g.Map(mapRef.current, {
          center: { lat: args.lat, lng: args.lng },
          zoom: 15,
          ...(mapId ? { mapId } : {}),
          streetViewControl: false,
          mapTypeControl: false,
        });
        mapObj.current = map;
        const Advanced = mapId ? g.marker?.AdvancedMarkerElement : undefined;
        const marker: MapsMarker = Advanced
          ? new Advanced({
              map,
              position: { lat: args.lat, lng: args.lng },
              gmpDraggable: true,
            })
          : new g.Marker({
              map,
              position: { lat: args.lat, lng: args.lng },
              draggable: true,
            });
        markerObj.current = marker;
        map.addListener('click', (e: unknown) => {
          const pos = readPos((e as { latLng?: unknown } | null)?.latLng);
          if (!pos) return;
          stage(pos);
        });
        // Drag end carries the drop point on classic Markers; advanced
        // markers expose it via marker.position (LatLngAltitude props).
        marker.addListener?.('dragend', (e: unknown) => {
          const raw = e as { latLng?: unknown } | null | undefined;
          const dropped = 'setPosition' in marker ? null : marker.position;
          const pos = readPos(raw?.latLng) ?? (dropped ? readPos(dropped) : null);
          if (pos) stage(pos);
        });
        if (searchRef.current && g.places?.Autocomplete) {
          const ac = new g.places.Autocomplete(searchRef.current, { fields: ['geometry', 'formatted_address', 'name'] });
          autoObj.current = ac;
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
      } catch (e: unknown) {
        const detail = e instanceof Error ? e.message : String(e);
        logger.error('google maps failed to load', { detail });
        if (!cancelled) setFailed(detail);
      }
    }
    void build();
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
    const g = nsObj.current;
    const map = mapObj.current;
    const marker = markerObj.current;
    if (!g || !map || !marker) return;
    const pos = new g.LatLng(args.lat, args.lng);
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
    const g = nsObj.current;
    if (!g || !ready) {
      setMsg('Place search needs Google Maps — paste "lat, lng" or use GPS.');
      return;
    }
    try {
      const geocoder = new g.Geocoder();
      const res = await geocoder.geocode({ address: q });
      const first = res.results?.[0];
      const loc = readPos(first?.geometry?.location);
      if (loc) {
        const map = mapObj.current;
        if (map) {
          map.panTo(loc);
          map.setZoom(16);
        }
        stage({ ...loc, address: first?.formatted_address });
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
          <Button variant="pine" block onClick={confirmStaged}>
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
        <span className="flex-1">
          <TextInput
            inputRef={searchRef}
            value={query}
            onChange={setQuery}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void search();
              }
            }}
            placeholder="Search place name or paste lat, lng…"
            aria-label="Search place by name or coordinates"
          />
        </span>
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
