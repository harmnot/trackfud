/** Shared Google Maps JS API loader for the Back Office live map.
 *
 * Same readiness contract as the customer/courier loaders: the public
 * browser key comes from `VITE_GOOGLE_MAPS_KEY` (HTTP-referrer restricted,
 * never a secret) and the promise resolves only after `importLibrary('maps')`
 * — script `onload` alone is not readiness with `loading=async`. Without a
 * key (or when Maps fails) the overview renders a schematic fallback, so
 * reviewers always see the dots. An optional `VITE_GOOGLE_MAPS_MAP_ID`
 * selects a Cloud Console map id; empty means classic markers.
 */

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

/** Narrow view of one live map (only the members the overview calls). */
export type MapsMap = {
  setZoom: (zoom: number) => void;
  fitBounds: (bounds: MapsBounds, padding?: number) => void;
};

/** Classic pin marker. */
export type MapsMarker = {
  setPosition: (pos: LatLng) => void;
  setMap: (map: MapsMap | null) => void;
  setTitle: (title: string) => void;
};

/** Area covering the courier dots and dropoff pins. */
export type MapsBounds = {
  extend: (pos: LatLng) => void;
};

/** `new google.maps.*` constructors the overview touches. */
export type GoogleMapsNs = {
  Map: new (
    el: HTMLElement,
    opts: { center: LatLng; zoom: number; mapId?: string },
  ) => MapsMap;
  Marker: new (opts: {
    map: MapsMap;
    position: LatLng;
    title?: string;
    label?: Record<string, string | number>;
  }) => MapsMarker;
  LatLngBounds: new () => MapsBounds;
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
const LOAD_TIMEOUT_MS = 20000;
const BOOTSTRAP_POLL_MS = 100;
const SCRIPT_MARKER = 'data-trackbite-cms-maps';
const SCRIPT_SELECTOR =
  'script[data-trackbite-cms-maps], script[src*="maps.googleapis.com/maps/api/js"]';

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

/** Optional Cloud Console map id (empty = classic markers, works on any key). */
export function mapsMapId(): string | null {
  const raw = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID as string | undefined;
  const id = (raw ?? '').trim().replace(/^["']|["']$/g, '').trim();
  return id === '' ? null : id;
}

function scriptUrl(key: string): string {
  return `${MAPS_JS_URL}?loading=async&libraries=marker&key=${encodeURIComponent(key)}`;
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
      message: 'Maps key missing — set VITE_GOOGLE_MAPS_KEY for the live map.',
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
  await boot.importLibrary('maps');
  try {
    await boot.importLibrary('marker');
  } catch {
    // Classic Marker fallback below; not fatal.
  }
  const g = window.google;
  if (!g?.maps?.Map) {
    if (authDetail !== null) throw authError();
    throw new MapsLoadError({
      kind: 'not-ready',
      message: 'Maps library did not finish initialising — retry in a moment.',
    });
  }
  return g;
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

/** Forget a failed load so Retry rebuilds the map from a clean tag. */
export function resetMapsLoad(): void {
  readyPromise = null;
  authDetail = null;
  document
    .querySelector<HTMLScriptElement>('script[data-trackbite-cms-maps]')
    ?.remove();
}
