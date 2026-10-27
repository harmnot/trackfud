/**
 * Staff mode: merchant-invited fallback couriers inside the Courier PWA.
 * Invited by the merchant, NO fitness test, fallback offers ONLY (they never
 * take work from runners/bikers), tracked delivery on foot / bike / own way,
 * staff earnings in the same wallet. The invite check is the single swap
 * Live fallback offers come from `GET /courier/staff/offers`
 * (`courierApi.listStaffOffers`); the invite code itself is format-checked
 * locally (openapi.yaml has no courier-side invite endpoint).
 */
import { create } from 'zustand';

/** How this staff member moves the food (their own way, tracked live). */
export type StaffTravel = 'foot' | 'bike' | 'own';

type StaffState = {
  /** True while signed in as merchant staff (fitness test skipped). */
  active: boolean;
  inviteCode: string;
  staffName: string;
  merchantName: string;
  travel: StaffTravel;
  /** Enter staff mode after the invite is accepted (local or server). */
  enter: (args: { inviteCode: string; staffName: string; merchantName: string; travel: StaffTravel }) => void;
  /** Leave staff mode (back to runner/biker flow). */
  exit: () => void;
};

const LS_KEY = 'tb:courier:staff';

function loadInitial(): Omit<StaffState, 'enter' | 'exit'> {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<StaffState>;
      if (p.active && typeof p.inviteCode === 'string') {
        return {
          active: true,
          inviteCode: p.inviteCode,
          staffName: typeof p.staffName === 'string' ? p.staffName : '',
          merchantName: typeof p.merchantName === 'string' ? p.merchantName : '',
          travel: p.travel === 'bike' || p.travel === 'own' ? p.travel : 'foot',
        };
      }
    }
  } catch {
    /* private mode: staff mode simply does not persist */
  }
  return { active: false, inviteCode: '', staffName: '', merchantName: '', travel: 'foot' };
}

function persist(s: StaffState): void {
  try {
    if (s.active) {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ active: true, inviteCode: s.inviteCode, staffName: s.staffName, merchantName: s.merchantName, travel: s.travel }),
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
    set({ active: false, inviteCode: '', staffName: '', merchantName: '', travel: 'foot' });
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* already gone */
    }
  },
}));

/** Invite codes are 6+ letter/digit groups the merchant reads out to staff. */
export function isInviteCodeWellFormed(code: string): boolean {
  return /^[A-Za-z0-9-]{6,24}$/.test(code.trim());
}
