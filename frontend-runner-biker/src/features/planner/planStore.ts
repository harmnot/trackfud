/**
 * Picked AI plan: the loop the courier chose in the planner. Run Setup reads
 * it when `trackKind === 'ai'` and sends its GeoJSON as `planned_track`
 * (the dispatch corridor). Persisted on-device so a reload keeps the pick.
 */
import { create } from 'zustand';
import type { PlannerPlan } from './types';

type PlanState = {
  picked: PlannerPlan | null;
  pick: (plan: PlannerPlan | null) => void;
};

function load(): PlannerPlan | null {
  try {
    const raw = localStorage.getItem('tb:courier:aiplan');
    if (!raw) return null;
    const p = JSON.parse(raw) as PlannerPlan;
    if (typeof p?.id === 'string' && Array.isArray(p.waypoints) && p.waypoints.length >= 2) return p;
    return null;
  } catch {
    return null;
  }
}

export const usePlan = create<PlanState>((set) => ({
  picked: typeof localStorage !== 'undefined' ? load() : null,
  pick: (picked) => {
    try {
      if (picked) localStorage.setItem('tb:courier:aiplan', JSON.stringify(picked));
      else localStorage.removeItem('tb:courier:aiplan');
    } catch {
      // Private mode: the pick lives in memory for this session.
    }
    set({ picked });
  },
}));
