/**
 * Offer store: current offer, 30 s countdown, demo simulator. Declining
 * never penalises (health first). Live offers arrive on the socket as
 * `offer.created` plus a `GET /courier/offers` poll backup; the simulator
 * fires only while the backend is unreachable and is always labelled.
 */
import { create } from 'zustand';
import { OFFER_WINDOW_S } from '../../lib/format';
import { logger } from '../../lib/logger';
import type { Offer } from './types';

type OfferState = {
  current: Offer | null;
  secondsLeft: number;
  answered: number;
  accepted: number;
  show: (offer: Offer) => void;
  tick: (now: number) => void;
  clear: () => void;
  recordAnswer: (accepted: boolean) => void;
};

export const useOffers = create<OfferState>((set, get) => ({
  current: null,
  secondsLeft: OFFER_WINDOW_S,
  answered: 0,
  accepted: 0,
  show: (offer) => {
    if (get().current) {
      logger.info('offer skipped: already showing one (1 active order max)');
      return;
    }
    set({ current: offer, secondsLeft: OFFER_WINDOW_S });
  },
  tick: (now) => {
    const cur = get().current;
    if (!cur) return;
    const left = Math.max(0, Math.ceil((cur.expiresAt - now) / 1000));
    if (left <= 0) {
      logger.info('offer expired unanswered (no penalty)');
      set({ current: null, secondsLeft: OFFER_WINDOW_S });
      return;
    }
    set({ secondsLeft: left });
  },
  clear: () => set({ current: null, secondsLeft: OFFER_WINDOW_S }),
  recordAnswer: (accepted) =>
    set((s) => ({ answered: s.answered + 1, accepted: s.accepted + (accepted ? 1 : 0) })),
}));

/** Demo dispatch simulator: one offer ~20 s after going online (judge path). */
export function demoOffer(args: { mode: 'runner' | 'biker'; currency: string }): Offer {
  const feeMinor = args.currency === 'IDR' ? 7600 : 290;
  return {
    offerId: crypto.randomUUID(),
    deliveryId: crypto.randomUUID(),
    orderId: crypto.randomUUID(),
    merchantName: args.currency === 'IDR' ? 'Warung Demo' : 'Demo Kitchen',
    offTrackM: 250,
    addsM: 2400,
    feeMinor,
    currency: args.currency,
    sizeClass: 'M',
    mode: args.mode,
    expiresAt: Date.now() + OFFER_WINDOW_S * 1000,
    demo: true,
  };
}
