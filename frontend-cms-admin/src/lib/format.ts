/** Safe display helpers: never let an unexpected API shape crash React (#31). */

export const MISSING = '—';

/** True for plain objects (not arrays, not null). */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Render any wire value as a display string. Objects become "open – close" or compact JSON. */
export function formatValue(value: unknown): string {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === 'string') return value === '' ? MISSING : value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    if (value.length === 0) return MISSING;
    return value.map((item) => formatValue(item)).join(', ');
  }
  if (isRecord(value)) {
    const open = value['open'];
    const close = value['close'];
    if (typeof open === 'string' && typeof close === 'string') return `${open} – ${close}`;
    const keys = Object.keys(value);
    if (keys.length === 0) return MISSING;
    try {
      const json = JSON.stringify(value);
      return json.length > 120 ? `${json.slice(0, 117)}…` : json;
    } catch {
      return MISSING;
    }
  }
  return MISSING;
}

/** Render one opening-hours entry: "09:00 – 22:00", "closed", or a safe fallback. */
export function formatHours(value: unknown): string {
  if (value === null || value === undefined) return MISSING;
  if (typeof value === 'string') return value === '' ? 'closed' : value;
  if (isRecord(value)) {
    const open = value['open'];
    const close = value['close'];
    if (typeof open === 'string' && typeof close === 'string') {
      if (open === '' && close === '') return 'closed';
      return `${open} – ${close}`;
    }
    return formatValue(value);
  }
  return formatValue(value);
}

/** Join a wire string list safely; non-string items are stringified, empties dropped. */
export function formatList(values: unknown): string {
  if (!Array.isArray(values) || values.length === 0) return MISSING;
  const parts: string[] = [];
  for (const item of values) {
    if (typeof item === 'string' && item !== '') parts.push(item);
    else if (typeof item === 'number' || typeof item === 'boolean') parts.push(String(item));
  }
  return parts.length > 0 ? parts.join(', ') : MISSING;
}

/** Format integer minor units for display only (never for math). */
export function formatMinor(amountMinor: number, currency: string): string {
  if (!Number.isFinite(amountMinor)) return MISSING;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amountMinor / 100);
  } catch {
    return `${amountMinor} ${currency}`;
  }
}
