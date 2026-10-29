/**
 * Staff mode: merchant-invited fallback inside the Stride & Earn app.
 * Invited by the merchant by email (merchant app → Staff → invite), NO
 * fitness test, fallback offers ONLY (they never take work from
 * runners/bikers), tracked delivery on foot / bike / own way, staff
 * earnings in the same wallet. Membership comes from
 * `GET /courier/staff/memberships`; entering clocks on-shift via
 * `POST /courier/staff/shift` (`courierApi.setStaffShift`).
 */
import { create } from 'zustand';

/** How this staff member moves the food (their own way, tracked live). */
export type StaffTravel = 'foot' | 'bike' | 'own';

type StaffState = {
  /** True while signed in as merchant staff (fitness test skipped). */
  active: boolean;
  merchantId: string;
  staffName: string;
  merchantName: string;
  travel: StaffTravel;
  /** Enter staff mode after clocking on-shift server-side. */
  enter: (args: { merchantId: string; staffName: string; merchantName: string; travel: StaffTravel }) => void;
  /** Leave staff mode (back to runner/biker flow). */
  exit: () => void;
};

const LS_KEY = 'tb:courier:staff';

function loadInitial(): Omit<StaffState, 'enter' | 'exit'> {
  const empty = { active: false, merchantId: '', staffName: '', merchantName: '', travel: 'foot' } as const;
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StaffState>;
      if (p.active && typeof p.merchantId === 'string' && p.merchantId.length > 0) {
        return {
          active: true,
          merchantId: p.merchantId,
          staffName: typeof p.staffName === 'string' ? p.staffName : '',
          merchantName: typeof p.merchantName === 'string' ? p.merchantName : '',
          travel: p.travel === 'bike' || p.travel === 'own' ? p.travel : 'foot',
        };
      }
    }
  } catch {
    /* private mode: staff mode simply does not persist */
  }
  return { ...empty };
}

function persist(s: StaffState): void {
  try {
    if (s.active) {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ active: true, merchantId: s.merchantId, staffName: s.staffName, merchantName: s.merchantName, travel: s.travel }),
      );
    } else {
      localStorage.removeItem(LS_KEY);
    }
  } catch {
    /* demo pref only */
  }
}

export const useStaff = create<StaffState>((set) => ({
  ...loadInitial(),
  enter: (args) => {
    set({ active: true, ...args });
    persist({ active: true, ...args, enter: () => undefined, exit: () => undefined });
  },
  exit: () => {
    set({ active: false, merchantId: '', staffName: '', merchantName: '', travel: 'foot' });
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* already gone */
    }
  },
}));
