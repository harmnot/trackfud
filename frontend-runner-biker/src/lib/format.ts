/** Domain constants + pure formatters for the Courier PWA (no side effects). */

/** Seconds a courier has to answer one offer (AGENTS.md §2.2). */
export const OFFER_WINDOW_S = 30;
/** GPS fixes worse than this are dropped before sending (meters). */
export const GPS_MAX_ACCURACY_M = 30;
/** Location batch cadence over the socket (seconds). */
export const LOC_BATCH_S = 5;
/** No point for this long marks the session stale: no offers (seconds). */
export const STALE_AFTER_S = 60;
/** Gap records start at this silence length; tests fail past 60 s (seconds). */
export const GAP_MARK_S = 30;
export const GAP_INVALID_S = 60;
/** WHO weekly goal: 150 active minutes (app-context §3). */
export const WHO_WEEKLY_GOAL_MIN = 150;
/** Daily active-time safety cap: 3 h (seconds). */
export const DAILY_CAP_S = 3 * 3600;
/** Hydration reminder cadence while active (seconds). */
export const HYDRATION_EVERY_S = 30 * 60;
/** Speeds (m/s) that count as active effort toward the WHO goal. */
export const ACTIVE_MPS = { runner: 5 / 3.6, biker: 10 / 3.6 } as const;
/** Planning speeds for ETAs: 9 km/h runner, 16 km/h biker (m/s). */
export const PLAN_MPS = { runner: 9 / 3.6, biker: 16 / 3.6 } as const;
/** Track corridor: restaurant must be this close to the track (meters). */
export const CORRIDOR_M = { runner: 400, biker: 800 } as const;
/** Delivery promise shown before the customer pays (minutes). */
export const PROMISE_MIN = 30;
export const PROMISE_MAX = 60;

export type CourierMode = 'runner' | 'biker';
export type Units = 'km' | 'mi';

/** Resolve display units: stored pref wins, else miles for en-GB, km otherwise. */
export function resolveUnits(locale: string): Units {
  try {
    const saved = localStorage.getItem('tb:courier:units');
    if (saved === 'km' || saved === 'mi') return saved;
  } catch {
    /* storage unavailable: fall through to locale default */
  }
  return locale === 'en-GB' ? 'mi' : 'km';
}

/** Format integer minor units as money (ISO-4217 aware: IDR has 0 decimals). */
export function formatMoney(amountMinor: number, currency: string, locale: string): string {
  const digits = new Intl.NumberFormat(locale, { style: 'currency', currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(
    amountMinor / 10 ** digits,
  );
}

/** Format meters as km or mi for the locale preference. */
export function formatDistance(meters: number, args: { locale: string; units: Units }): string {
  if (args.units === 'mi') return `${(meters / 1609.34).toFixed(1)} mi`;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Pace for runners: min/km or min/mi. Returns an em dash when stationary. */
export function formatPace(movingS: number, distanceM: number, units: Units): string {
  if (distanceM < 10 || movingS <= 0) return '—';
  const per = movingS / (units === 'mi' ? distanceM / 1609.34 : distanceM / 1000);
  const mm = Math.floor(per / 60);
  const ss = Math.round(per % 60);
  return `${mm}:${String(ss).padStart(2, '0')} /${units}`;
}

/** Speed for bikers: km/h or mph. */
export function formatSpeed(movingS: number, distanceM: number, units: Units): string {
  if (movingS <= 0) return `0 ${units === 'mi' ? 'mph' : 'km/h'}`;
  const mph = distanceM / 1609.34 / (movingS / 3600);
  if (units === 'mi') return `${mph.toFixed(1)} mph`;
  return `${(mph * 1.60934).toFixed(1)} km/h`;
}

/** Format a seconds count as H:MM:SS or M:SS. */
export function formatDuration(totalS: number): string {
  const s = Math.max(0, Math.floor(totalS));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = s % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${m}:${String(rest).padStart(2, '0')}`;
}

/** ETA text for a distance at planning speed: "4 min · 600 m". */
export function formatEta(distanceM: number, args: { mode: CourierMode; locale: string; units: Units }): string {
  const mins = Math.max(1, Math.round(distanceM / PLAN_MPS[args.mode] / 60));
  return `${mins} min · ${formatDistance(distanceM, args)}`;
}
