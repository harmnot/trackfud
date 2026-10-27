/**
 * Run-session store: setup + phase + live stats + gaps. GPS ingestion and
 * streaming live in `useRunEngine`; this store is the synchronous state
 * both the Run Mode screen and the offer/delivery flow read from.
 */
import { create } from 'zustand';
import { EMPTY_STATS, type RunStats, type SessionSetup } from './types';

type RunState = {
  sessionId: string | null;
  setup: SessionSetup | null;
  phase: 'idle' | 'active' | 'done';
  stats: RunStats;
  online: boolean;
  hydratedAt: number;
  start: (args: { setup: SessionSetup }) => string;
  setStats: (stats: RunStats) => void;
  setOnline: (online: boolean) => void;
  finish: () => void;
  reset: () => void;
};

const DEFAULT_SETUP: SessionSetup = {
  mode: 'runner',
  goalKind: 'distance',
  goalValue: 5000,
  trackKind: 'free',
  trackName: null,
};

export const useRun = create<RunState>((set) => ({
  sessionId: null,
  setup: DEFAULT_SETUP,
  phase: 'idle',
  stats: EMPTY_STATS,
  online: false,
  hydratedAt: Date.now(),
  start: ({ setup }) => {
    const sessionId = crypto.randomUUID();
    try {
      localStorage.setItem('tb:courier:midrun', '1');
    } catch {
      /* private mode: update prompt may still fire, session unaffected */
    }
    set({ sessionId, setup, phase: 'active', stats: EMPTY_STATS, online: true });
    return sessionId;
  },
  setStats: (stats) => set({ stats }),
  setOnline: (online) => set({ online }),
  finish: () => {
    try {
      localStorage.removeItem('tb:courier:midrun');
    } catch {
      /* already gone */
    }
    set({ phase: 'done', online: false });
  },
  reset: () => {
    try {
      localStorage.removeItem('tb:courier:midrun');
    } catch {
      /* already gone */
    }
    set({ sessionId: null, phase: 'idle', stats: EMPTY_STATS, online: false });
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
