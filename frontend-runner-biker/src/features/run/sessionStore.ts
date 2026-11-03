/**
 * Run-session store: setup + phase + live stats + gaps + tracker notices.
 * GPS ingestion and streaming live in `runTracker`, which the app-level
 * `WorkSessionTracker` keeps running on every screen while a session is
 * active; this store is the synchronous state the Run Mode screen and the
 * offer/delivery flow read from — no screen owns a GPS watcher.
 */
import { create } from 'zustand';
import { EMPTY_STATS, type RunStats, type SessionSetup } from './types';

/** In-run notes the tracker raises for Run Mode (one per kind). */
export type RunNotice = 'hydration' | 'stale' | 'gap';

/**
 * GPS signal from the run engine's point of view. Dispatch can only see a
 * courier the server hears from (fresh batch < 60 s), and batches only exist
 * once the device yields a usable fix — so this signal drives the Run Mode
 * readiness line honestly: `waiting` (no fix yet), `ok` (fixes flowing),
 * `weak` (fixes keep failing the accuracy gate, e.g. indoors), `denied`
 * (the browser blocked location). The server stays the truth for offers;
 * this only explains what the courier should do next.
 */
export type GpsSignal = 'waiting' | 'ok' | 'weak' | 'denied' | 'unavailable';

type RunState = {
  sessionId: string | null;
  setup: SessionSetup | null;
  phase: 'idle' | 'active' | 'done';
  stats: RunStats;
  gps: GpsSignal;
  online: boolean;
  /** False while the session lives only on this device (server create
   * failed or hasn't happened): GPS still buffers and auto-registers on
   * reconnect, but offers and lifetime totals wait for the link. */
  serverLinked: boolean;
  hydratedAt: number;
  /** Tracker notes for this session (hydration, stale, gap), deduped by kind.
   * They outlive the Run screen because the tracker does. */
  notices: RunNotice[];
  /** True while a refresh-restored session is being confirmed with the server. */
  resuming: boolean;
  start: (args: { setup: SessionSetup; sessionId?: string; serverLinked?: boolean; keepStats?: boolean }) => string;
  setStats: (stats: RunStats) => void;
  setGps: (gps: GpsSignal) => void;
  setOnline: (online: boolean) => void;
  addNotice: (notice: RunNotice) => void;
  clearNotice: (notice: RunNotice) => void;
  setResuming: (resuming: boolean) => void;
  finish: () => void;
  reset: () => void;
};

const DEFAULT_SETUP: SessionSetup = {
  mode: 'runner',
  goalKind: 'distance',
  goalValue: 5000,
  trackKind: 'free',
  trackName: null,
  trackId: null,
  plannedTrack: null,
  planId: null,
  planName: null,
};

/**
 * Refresh-proof session: the run survives a page reload. `start()` writes the
 * snapshot; the store boots from it synchronously (so the /run route guard
 * sees `active` on the very first render); the setup page confirms it with
 * the server (resume → same id) and `finish()`/`reset()` clear it. Stats are
 * snapshotted separately by the engine every few seconds so the counters —
 * not just the session — survive a refresh. Everything is validated on read:
 * a corrupt or foreign snapshot falls back to idle, never a phantom run.
 */
const SESSION_KEY = 'tb:courier:session';
const STATS_KEY = 'tb:courier:stats';

type StoredSession = { sessionId: string; setup: SessionSetup; serverLinked: boolean };

function readStoredSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredSession>;
    if (typeof parsed.sessionId !== 'string' || parsed.sessionId === '') return null;
    const setup = parsed.setup;
    if (typeof setup !== 'object' || setup === null) return null;
    if (setup.mode !== 'runner' && setup.mode !== 'biker') return null;
    if (setup.goalKind !== 'distance' && setup.goalKind !== 'time' && setup.goalKind !== 'open') return null;
    if (typeof setup.goalValue !== 'number' || !Number.isFinite(setup.goalValue)) return null;
    return { sessionId: parsed.sessionId, setup: setup as SessionSetup, serverLinked: parsed.serverLinked !== false };
  } catch {
    return null;
  }
}

function readStoredStats(): RunStats | null {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { stats?: Partial<RunStats> };
    const s = parsed.stats;
    if (typeof s !== 'object' || s === null) return null;
    if (typeof s.distanceM !== 'number' || typeof s.elapsedS !== 'number') return null;
    return { ...EMPTY_STATS, ...s };
  } catch {
    return null;
  }
}

/** Throttled by the caller (engine stats tick): counters survive refresh. */
export function saveStatsSnapshot(stats: RunStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify({ stats, savedAt: Date.now() }));
  } catch {
    /* private mode: counters restart, session unaffected */
  }
}

function persistSession(snapshot: StoredSession): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    /* private mode: refresh-resume unavailable, live run unaffected */
  }
}

function clearPersistedSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
    localStorage.removeItem(STATS_KEY);
    localStorage.removeItem('tb:courier:midrun');
  } catch {
    /* already gone */
  }
}

const bootSession = readStoredSession();
const bootStats = readStoredStats();

export const useRun = create<RunState>((set, get) => ({
  sessionId: bootSession?.sessionId ?? null,
  setup: bootSession?.setup ?? DEFAULT_SETUP,
  phase: bootSession ? 'active' : 'idle',
  stats: bootStats ?? EMPTY_STATS,
  gps: 'waiting',
  online: bootSession != null,
  serverLinked: bootSession?.serverLinked ?? true,
  hydratedAt: Date.now(),
  notices: [],
  resuming: false,
  start: ({ setup, sessionId, serverLinked, keepStats }) => {
    const id = sessionId ?? crypto.randomUUID();
    const linked = serverLinked ?? true;
    try {
      localStorage.setItem('tb:courier:midrun', '1');
    } catch {
      /* private mode: update prompt may still fire, session unaffected */
    }
    persistSession({ sessionId: id, setup, serverLinked: linked });
    set({
      sessionId: id,
      setup,
      phase: 'active',
      // Boot resume with the same server session keeps counters, the gps
      // signal (no banner flicker) and the notices; a fresh server session
      // restarts all three.
      stats: keepStats ? get().stats : EMPTY_STATS,
      gps: keepStats ? get().gps : 'waiting',
      notices: keepStats ? get().notices : [],
      online: true,
      serverLinked: linked,
    });
    return id;
  },
  setStats: (stats) => set({ stats }),
  setGps: (gps) => set({ gps }),
  setOnline: (online) => set({ online }),
  addNotice: (notice) => {
    const notices = get().notices;
    if (notices.includes(notice)) return;
    set({ notices: [...notices, notice] });
  },
  clearNotice: (notice) => {
    const notices = get().notices;
    if (!notices.includes(notice)) return;
    set({ notices: notices.filter((n) => n !== notice) });
  },
  setResuming: (resuming) => set({ resuming }),
  finish: () => {
    clearPersistedSession();
    set({ phase: 'done', online: false, notices: [] });
  },
  reset: () => {
    clearPersistedSession();
    set({ sessionId: null, phase: 'idle', stats: EMPTY_STATS, gps: 'waiting', online: false, notices: [] });
  },
}));

/** True while a session is recording (update prompt must stay silent). */
export function isMidRun(): boolean {
  try {
    return localStorage.getItem('tb:courier:midrun') === '1';
  } catch {
    return useRun.getState().phase === 'active';
  }
}
