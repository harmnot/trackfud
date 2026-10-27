/** Client-side quote estimate. Mirrors `backend/internal/order` fee math exactly.
 * The server quote at pay time is authoritative; this is for display only. */

import type { QuoteEstimate } from './types';

type FeeSchedule = {
  base: number;
  perKm: number;
  max: number;
  svcMin: number;
  svcMax: number;
};

/** Per-currency schedules from the backend (`Schedules`, AGENTS.md §12). */
const SCHEDULES: Record<string, FeeSchedule> = {
  USD: { base: 100, perKm: 35, max: 350, svcMin: 10, svcMax: 99 },
  GBP: { base: 100, perKm: 35, max: 350, svcMin: 10, svcMax: 99 },
  IDR: { base: 5000, perKm: 1500, max: 15000, svcMin: 1000, svcMax: 5000 },
};

const USD_FALLBACK: FeeSchedule = { base: 100, perKm: 35, max: 350, svcMin: 10, svcMax: 99 };

/** Multiply minor units by basis points with half-up rounding (backend `mulBps`). */
export function mulBps(valueMinor: number, bps: number): number {
  if (valueMinor <= 0) return 0;
  return Math.floor((valueMinor * bps + 5000) / 10000);
}

/** Great-circle distance in km between two pins (display estimate only). */
export function haversineKm(from: { lat: number; lng: number }, to: { lat: number; lng: number }): number {
  const rad = Math.PI / 180;
  const dLat = (to.lat - from.lat) * rad;
  const dLng = (to.lng - from.lng) * rad;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(from.lat * rad) * Math.cos(to.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(a));
}

/** Estimate food + delivery + service fee + tip before pay. */
export function estimateQuote(args: {
  subtotalMinor: number;
  distanceKm: number;
  currency: string;
  tipMinor: number;
}): QuoteEstimate {
  const sched = SCHEDULES[args.currency] ?? USD_FALLBACK;
  const clampedKm = args.distanceKm < 0 ? 0 : args.distanceKm;
  const delivery = Math.min(sched.base + clampedKm * sched.perKm, sched.max);
  const deliveryMinor = Math.floor(delivery + 0.5);
  const rawService = mulBps(args.subtotalMinor, 300);
  const serviceMinor = Math.min(Math.max(rawService, sched.svcMin), sched.svcMax);
  const tip = args.tipMinor < 0 ? 0 : args.tipMinor;
  return {
    currency: args.currency,
    subtotalMinor: args.subtotalMinor,
    deliveryMinor,
    serviceMinor,
    tipMinor: tip,
    totalMinor: args.subtotalMinor + deliveryMinor + serviceMinor + tip,
    distanceKm: clampedKm,
    estimated: true,
  };
}
