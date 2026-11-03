/** Shared Google Maps JS API loader (single path for every map in this app).
 * The public browser key comes from `VITE_GOOGLE_MAPS_KEY` (HTTP-referrer
 * restricted, never a secret); an optional `VITE_GOOGLE_MAPS_MAP_ID` selects
 * a Cloud Console map id for advanced markers. The CDN script uses
 * `loading=async`, so script `onload` only means the bootstrap arrived —
 * `google.maps.Map` and friends stay undefined until `importLibrary('maps')`
 * resolves. This loader treats *that* import as the readiness signal, so a
 * fresh first visit can no longer outrun the bootstrap (Retry path).
 * Real key/billing/restriction rejections are captured via `gm_authFailure`
 * and surface as a distinct `auth` failure instead of a generic init error.
 * Without a key (or when Maps fails) callers render their schematic
 * fallback. No secret ever leaves the server.
 * NOTE: Vite embeds VITE_* vars at dev-server start — after editing .env,
 * restart the dev server and hard-refresh (the PWA service worker can serve
 * a stale bundle otherwise). */

export type LatLng = { lat: number; lng: number };

/** Why the Maps JS API could not be made ready. */
export type MapsFailureKind =
  | 'missing-key'
  | 'auth'
  | 'network'
  | 'timeout'
  | 'not-ready';

/** Typed loader failure: `kind` drives retry UI, `message` is user-safe. */
export class MapsLoadError extends Error {
  kind: MapsFailureKind;
  constructor(args: { kind: MapsFailureKind; message: string }) {
    super(args.message);
    this.name = 'MapsLoadError';
    this.kind = args.kind;
  }
}

/** Narrow view of one live map (only the members this app calls). */
export type MapsMap = {
  panTo: (pos: LatLng) => void;
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: MapsBounds, padding?: number) => void;
  addListener: (event: 'click', handler: (e: unknown) => void) => void;
};

/** Mutable route line on a live map. */
export type MapsPolyline = {
  setPath: (path: readonly LatLng[]) => void;
  setMap: (map: MapsMap | null) => void;
};

/** Area covering the pins and the courier dot. */
export type MapsBounds = {
  extend: (pos: LatLng) => void;
};

/** Classic pin marker. */
export type MapsClassicMarker = {
  setPosition: (pos: LatLng | unknown) => void;
  setMap: (map: MapsMap | null) => void;
  addListener: (event: string, handler: (e: unknown) => void) => void;
};

/** Advanced pin marker (needs a Cloud Console map id on the map). */
export type MapsAdvancedMarker = {
  position: LatLng | unknown;
  map: MapsMap | null;
  addListener?: (event: string, handler: (e: unknown) => void) => void;
};

/** Either marker kind a map in this app can hold. */
export type MapsMarker = MapsClassicMarker | MapsAdvancedMarker;

/** `google.maps.places.Autocomplete` subset used by the pin picker. */
export type MapsAutocomplete = {
  addListener: (event: 'place_changed', handler: () => void) => void;
  getPlace: () => {
    geometry?: { location?: unknown };
    formatted_address?: string;
    name?: string;
  };
};

/** `google.maps.Geocoder` subset used by the pin picker. */
export type MapsGeocoder = {
  geocode: (req: { address: string }) => Promise<{
    results?: Array<{
      formatted_address?: string;
      geometry?: { location?: unknown };
    }>;
  }>;
};

/** `new google.maps.*` constructors this app touches. */
export type GoogleMapsNs = {
  Map: new (el: HTMLElement, opts: {
    center: LatLng;
    zoom: number;
    mapId?: string;
    streetViewControl?: boolean;
    mapTypeControl?: boolean;
  }) => MapsMap;
  Marker: new (opts: {
    map: MapsMap;
    position: LatLng | unknown;
    title?: string;
    label?: Record<string, string | number>;
    draggable?: boolean;
  }) => MapsClassicMarker;
  Polyline: new (opts: {
    map: MapsMap;
    path: readonly LatLng[];
    geodesic?: boolean;
    strokeColor?: string;
    strokeOpacity?: number;
    strokeWeight?: number;
  }) => MapsPolyline;
  LatLng: new (lat: number, lng: number) => LatLng;
  LatLngBounds: new () => MapsBounds;
  Geocoder: new () => MapsGeocoder;
  marker?: {
    AdvancedMarkerElement?: new (opts: {
      map: MapsMap;
      position: LatLng;
      content?: HTMLElement;
      title?: string;
      gmpDraggable?: boolean;
    }) => MapsAdvancedMarker;
  };
  places?: {
    Autocomplete?: new (
      input: HTMLInputElement,
      opts: { fields: string[] },
    ) => MapsAutocomplete;
  };
};

/** Ready Maps handle: the `google` namespace once libraries initialised. */
export type GoogleMaps = {
  maps: GoogleMapsNs;
};

type BootstrapMaps = {
  importLibrary: (lib: string) => Promise<unknown>;
};

declare global {
  interface Window {
    google?: GoogleMaps & {
      maps: GoogleMapsNs & Partial<BootstrapMaps>;
    };
    gm_authFailure?: () => void;
  }
}

const MAPS_JS_URL = 'https://maps.googleapis.com/maps/api/js';
const MAPS_LIBRARIES = 'places,marker';
const LOAD_TIMEOUT_MS = 20000;
const BOOTSTRAP_POLL_MS = 100;
const SCRIPT_MARKER = 'data-trackfud-maps';
const SCRIPT_SELECTOR =
  'script[data-trackfud-maps], script[src*="maps.googleapis.com/maps/api/js"]';

/** Single-flight readiness promise shared by every map on the page. */
let readyPromise: Promise<GoogleMaps> | null = null;
/** Last `gm_authFailure` detail (a rejected key, API, or billing state). */
let authDetail: string | null = null;
let authHookInstalled = false;

/** Public browser key; tolerates quotes/whitespace from hand-edited .env. */
export function mapsKey(): string {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_KEY as string | undefined;
  return (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
}

/** Optional Cloud Console map id for advanced markers (empty = classic). */
export function mapsMapId(): string | null {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
  const id = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  return id === '' ? null : id;
}

function scriptUrl(key: string): string {
  return `${MAPS_JS_URL}?loading=async&libraries=${MAPS_LIBRARIES}&key=${encodeURIComponent(key)}`;
}

/** Capture Google's async auth failure so it stops looking like a race. */
function installAuthHook(): void {
  if (authHookInstalled || typeof window === 'undefined') return;
  authHookInstalled = true;
  const prev = window.gm_authFailure;
  window.gm_authFailure = () => {
    authDetail =
      'Google Maps rejected the browser key — check HTTP-referrer restrictions, that the Maps JavaScript API is enabled, and billing.';
    if (typeof prev === 'function') prev();
  };
}

function authError(): MapsLoadError {
  return new MapsLoadError({
    kind: 'auth',
    message:
      authDetail ??
      'Google Maps rejected the browser key — check key restrictions and billing.',
  });
}

/** Wait for one script tag to load (resolves at once for a ready tag). */
function waitForScript(tag: HTMLScriptElement): Promise<void> {
  if (tag.dataset['mapsReady'] === 'true') return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    tag.addEventListener(
      'load',
      () => {
        tag.dataset['mapsReady'] = 'true';
        resolve();
      },
      { once: true },
    );
    tag.addEventListener(
      'error',
      () => {
        reject(
          new MapsLoadError({
            kind: 'network',
            message:
              'Google Maps script failed to load — check network/adblock and the key.',
          }),
        );
      },
      { once: true },
    );
  });
}

/** Poll for the `loading=async` bootstrap to install `importLibrary`. */
async function waitForBootstrap(deadline: number): Promise<BootstrapMaps> {
  while (Date.now() <= deadline) {
    if (authDetail !== null) throw authError();
    const importer = window.google?.maps?.importLibrary;
    if (typeof importer === 'function') {
      return { importLibrary: importer.bind(window.google?.maps) };
    }
    await sleep(BOOTSTRAP_POLL_MS);
  }
  if (authDetail !== null) throw authError();
  throw new MapsLoadError({
    kind: 'timeout',
    message: 'Google Maps is taking too long to start — retry in a moment.',
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

/** Full single-flight load: script, bootstrap, then the `maps` library. */
async function loadInner(): Promise<GoogleMaps> {
  installAuthHook();
  const key = mapsKey();
  if (key === '') {
    throw new MapsLoadError({
      kind: 'missing-key',
      message: 'Maps key missing — add VITE_GOOGLE_MAPS_KEY and restart.',
    });
  }
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  let tag = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
  if (!tag) {
    tag = document.createElement('script');
    tag.src = scriptUrl(key);
    tag.async = true;
    tag.defer = true;
    tag.setAttribute(SCRIPT_MARKER, 'true');
    document.head.appendChild(tag);
  }
  await waitForScript(tag);
  const boot = await waitForBootstrap(deadline);
  // The `maps` library is required; `marker`/`places` stay optional with
  // classic-marker and geocode fallbacks at the call sites.
  await boot.importLibrary('maps');
  try {
    await boot.importLibrary('marker');
  } catch {
    // Classic Marker fallback below; not fatal.
  }
  try {
    await boot.importLibrary('places');
  } catch {
    // Autocomplete stays optional; search falls back to geocode/paste.
  }
  const g = window.google;
  if (!g?.maps?.Map) throw authErrorOrNotReady();
  return g;
}

function authErrorOrNotReady(): MapsLoadError {
  if (authDetail !== null) return authError();
  return new MapsLoadError({
    kind: 'not-ready',
    message: 'Maps library did not finish initialising — retry in a moment.',
  });
}

/** Load the Maps JS API once and resolve only when `maps` is usable. */
export function loadMaps(): Promise<GoogleMaps> {
  if (typeof window === 'undefined') {
    return Promise.reject(
      new MapsLoadError({ kind: 'not-ready', message: 'no window' }),
    );
  }
  if (readyPromise) return readyPromise;
  readyPromise = loadInner().catch((err: unknown) => {
    readyPromise = null;
    throw err;
  });
  return readyPromise;
}

/** Bootstrap the libraries we use (same promise as `loadMaps`). */
export function ensureMaps(): Promise<GoogleMaps> {
  return loadMaps();
}

/** Forget a failed load so Retry rebuilds the map from a clean tag. */
export function resetMapsLoad(): void {
  readyPromise = null;
  authDetail = null;
  document
    .querySelector<HTMLScriptElement>('script[data-trackfud-maps]')
    ?.remove();
}

/** Read a position from either a classic LatLng (lat()/lng() methods) or an
 * AdvancedMarkerElement LatLngAltitude ({lat, lng} numeric props). */
export function readPos(p: unknown): LatLng | null {
  if (typeof p !== 'object' || p === null) return null;
  const rec = p as Record<string, unknown>;
  const latRaw = rec['lat'];
  const lngRaw = rec['lng'];
  const lat = typeof latRaw === 'function' ? latRaw.call(p) : latRaw;
  const lng = typeof lngRaw === 'function' ? lngRaw.call(p) : lngRaw;
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  return { lat, lng };
}

/** Move either marker kind: classic markers need setPosition, advanced
 * markers accept a position assignment. */
export function moveMarker(marker: MapsMarker, pos: LatLng): void {
  if ('setPosition' in marker) marker.setPosition(pos);
  else marker.position = pos;
}

/** Detach either marker kind from its map (advanced markers have no setMap). */
export function detachMarker(marker: MapsMarker): void {
  try {
    if ('setMap' in marker) marker.setMap(null);
    else marker.map = null;
  } catch {
    // Map already torn down; nothing left to detach.
  }
}

/** Decode a Google encoded polyline to lat/lng pairs (no dependency). */
export function decodePolyline(encoded: string): LatLng[] {
  const out: LatLng[] = [];
  let lat = 0;
  let lng = 0;
  let i = 0;
  while (i < encoded.length) {
    const dLat = readDelta(encoded, { at: i });
    lat += dLat.value;
    i = dLat.next;
    const dLng = readDelta(encoded, { at: i });
    lng += dLng.value;
    i = dLng.next;
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}

/** Read one zigzag varint delta from an encoded polyline. */
function readDelta(
  encoded: string,
  args: { at: number },
): { value: number; next: number } {
  let shift = 0;
  let result = 0;
  let i = args.at;
  let b = 0;
  do {
    b = encoded.charCodeAt(i++) - 63;
    result |= (b & 0x1f) << shift;
    shift += 5;
  } while (b >= 0x20);
  const value = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
  return { value, next: i };
}
