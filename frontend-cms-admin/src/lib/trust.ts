/** Trust-brief normalization: backend wire shape to the admin review view. */
import { formatValue } from './format.ts';
import type { TrustBrief } from './types';

/** One normalized advisory signal, always render-safe. */
export type BriefSignal = { label: string; value: string };

/** Normalized trust brief for the review UI. */
export type BriefView = {
  pending: boolean;
  recommendation: string | null;
  summary: string | null;
  signals: BriefSignal[];
  photoNote: string | null;
  fallback: boolean;
};

/** Normalize the wire payload: handles pending, legacy, and reason-list shapes. */
export function toBriefView(wire: TrustBrief | null): BriefView | null {
  if (wire === null) return null;
  if (wire.pending === true) {
    return { pending: true, recommendation: null, summary: null, signals: [], photoNote: null, fallback: false };
  }
  const signals: BriefSignal[] = [];
  if (Array.isArray(wire.signals)) {
    for (const item of wire.signals) {
      if (typeof item?.label === 'string') signals.push({ label: item.label, value: formatValue(item.value) });
    }
  } else if (wire.reasons !== undefined) {
    const reasons = Array.isArray(wire.reasons) ? wire.reasons : [wire.reasons];
    for (const reason of reasons) {
      if (typeof reason === 'string' && reason !== '') signals.push({ label: 'Reason', value: reason });
      else if (typeof reason === 'object' && reason !== null) signals.push({ label: 'Reason', value: formatValue(reason) });
    }
  }
  if (wire.risk !== undefined && wire.risk !== '') signals.unshift({ label: 'Risk', value: wire.risk });
  return {
    pending: false,
    recommendation: wire.recommendation ?? null,
    summary: wire.summary ?? null,
    signals,
    photoNote: wire.photo_note ?? null,
    fallback: wire.fallback ?? false,
  };
}
