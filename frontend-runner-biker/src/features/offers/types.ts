/** Offer domain types (dispatch offer → courier answer). */
import type { CourierMode } from '../../lib/format';

/** One dispatch offer. Amounts are integer minor units (never floats). */
export type Offer = {
  offerId: string;
  deliveryId: string;
  orderId: string;
  merchantName: string;
  /** Meters from the courier's track corridor breach point. */
  offTrackM: number;
  /** Extra meters this job adds to the workout. */
  addsM: number;
  feeMinor: number;
  currency: string;
  sizeClass: 'S' | 'M' | 'L';
  spillRisk: 'low' | 'medium' | 'high';
  mode: CourierMode;
  /** When the 30 s window closes (device clock ms). */
  expiresAt: number;
  /** True while this is the local demo simulator, not live dispatch. */
  demo: boolean;
};

/**
 * Parse an offer from the live backend (`GET /courier/offers` items and
 * `offer.created` socket frames share the openapi `Offer` shape) or from
 * the legacy local demo shape. Null when the shape is unknown. The server
 * does not send track-fit meters, so `to_pickup_m` maps to `offTrackM`
 * and `trip_m` to `addsM` — both real measured meters, honestly labelled.
 */
export function parseOffer(msg: unknown): Offer | null {
  if (typeof msg !== 'object' || msg === null) return null;
  const o = (msg as { offer?: Record<string, unknown> }).offer ?? (msg as Record<string, unknown>);
  const str = (k: string): string | null => (typeof o[k] === 'string' ? (o[k] as string) : null);
  const num = (k: string): number | null => (typeof o[k] === 'number' ? (o[k] as number) : null);
  const nested = (k: string): Record<string, unknown> | null => {
    const v: unknown = o[k];
    return typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : null;
  };
  const order = nested('order');
  const orderStr = (k: string): string | null => {
    const v: unknown = order?.[k];
    return typeof v === 'string' ? v : null;
  };
  const orderNum = (k: string): number | null => {
    const v: unknown = order?.[k];
    return typeof v === 'number' ? v : null;
  };
  const offerId = str('id') ?? str('offer_id') ?? str('offerId');
  const deliveryId = str('delivery_id') ?? str('deliveryId');
  const merchantName = orderStr('merchant_name') ?? str('merchant_name') ?? str('merchantName');
  const feeMinor = orderNum('payout_minor') ?? num('fee_minor') ?? num('feeMinor');
  const currency = orderStr('currency') ?? str('currency');
  if (!offerId || !deliveryId || !merchantName || feeMinor === null || !currency) return null;
  return {
    offerId,
    deliveryId,
    orderId: str('order_id') ?? str('orderId') ?? '',
    merchantName,
    offTrackM: orderNum('to_pickup_m') ?? num('off_track_m') ?? num('offTrackM') ?? 0,
    addsM: orderNum('trip_m') ?? num('adds_m') ?? num('addsM') ?? 0,
    feeMinor,
    currency,
    sizeClass: (orderStr('size_class') ?? str('size_class')) === 'L' ? 'L' : (orderStr('size_class') ?? str('size_class')) === 'M' ? 'M' : 'S',
    spillRisk: (orderStr('spill_risk') ?? str('spill_risk')) === 'medium' ? 'medium' : (orderStr('spill_risk') ?? str('spill_risk')) === 'high' ? 'high' : 'low',
    mode: str('mode') === 'biker' ? 'biker' : 'runner',
    expiresAt: expiryMs({ expiresAt: str('expires_at'), secondsLeft: num('seconds_left') }),
    demo: false,
  };
}

/** Offer expiry as device-clock ms: ISO `expires_at` wins, else `seconds_left`, else 30 s. */
function expiryMs(args: { expiresAt: string | null; secondsLeft: number | null }): number {
  if (args.expiresAt) {
    const ms = Date.parse(args.expiresAt);
    if (Number.isFinite(ms)) return ms;
  }
  if (args.secondsLeft !== null && args.secondsLeft > 0) return Date.now() + args.secondsLeft * 1000;
  return Date.now() + 30_000;
}
