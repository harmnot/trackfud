/** Active delivery leg: assigned → pickup → carried → delivered. */
import { create } from 'zustand';
import type { DeliveryEnvelope } from './courierApi';

/** Map a live `DeliveryEnvelope` onto the local leg (server is truth). */
export function toActiveDelivery(env: DeliveryEnvelope): Omit<ActiveDelivery, 'phase' | 'headNow' | 'readyInMin'> {
  const d = env.delivery;
  return {
    deliveryId: d.id,
    orderId: d.order_id,
    merchantName: d.pickup.merchant_name,
    feeMinor: env.payout?.amount_minor ?? 0,
    currency: env.payout?.currency ?? d.currency,
    etaS: typeof d.eta_s === 'number' ? d.eta_s : null,
    routeWarning: typeof d.route_warning === 'string' ? d.route_warning : null,
    demo: false,
  };
}

/** Map a server delivery status onto the local phase. */
export function toPhase(status: string): DeliveryPhase {
  if (status === 'at_pickup') return 'at_pickup';
  if (status === 'picked_up') return 'picked_up';
  if (status === 'at_dropoff') return 'at_dropoff';
  if (status === 'delivered') return 'delivered';
  if (status === 'assigned') return 'assigned';
  return 'to_pickup';
}

export type DeliveryPhase =
  | 'assigned'
  | 'to_pickup'
  | 'at_pickup'
  | 'picked_up'
  | 'to_customer'
  | 'at_dropoff'
  | 'delivered';

export type ActiveDelivery = {
  deliveryId: string;
  orderId: string;
  merchantName: string;
  feeMinor: number;
  currency: string;
  /** Live route ETA in seconds (null until the server plans the route). */
  etaS: number | null;
  /** Google WALK/BICYCLE beta disclaimer served with the leg. */
  routeWarning: string | null;
  phase: DeliveryPhase;
  /** True while the backend leg is missing (local demo flow). */
  demo: boolean;
  /** Set by the "head now" nudge; cleared on arrival. */
  headNow: boolean;
  readyInMin: number | null;
};

type DeliveryState = {
  active: ActiveDelivery | null;
  history: ActiveDelivery[];
  assign: (delivery: Omit<ActiveDelivery, 'phase' | 'headNow' | 'readyInMin'>) => void;
  setPhase: (phase: DeliveryPhase) => void;
  nudgeHeadNow: (readyInMin: number | null) => void;
  setEta: (etaS: number | null) => void;
  complete: () => void;
};

export const useDelivery = create<DeliveryState>((set, get) => ({
  active: null,
  history: [],
  assign: (delivery) =>
    set({ active: { ...delivery, phase: 'assigned', headNow: false, readyInMin: null } }),
  setPhase: (phase) => {
    const cur = get().active;
    if (!cur) return;
    set({ active: { ...cur, phase, headNow: phase === 'at_pickup' || phase === 'picked_up' ? false : cur.headNow } });
  },
  nudgeHeadNow: (readyInMin) => {
    const cur = get().active;
    if (!cur) return;
    set({ active: { ...cur, headNow: true, readyInMin } });
  },
  setEta: (etaS) => {
    const cur = get().active;
    if (!cur || cur.etaS === etaS) return;
    set({ active: { ...cur, etaS } });
  },
  complete: () => {
    const cur = get().active;
    if (!cur) return;
    set({ active: null, history: [...get().history, { ...cur, phase: 'delivered' }] });
  },
}));
