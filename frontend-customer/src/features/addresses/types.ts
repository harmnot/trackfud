/** Saved delivery addresses: list, pin, default (mirrors `backend/api/openapi.yaml`). */

export type CustomerAddress = {
  id: string;
  label: string;
  address: string;
  lat: number;
  lng: number;
  note: string;
  is_default: boolean;
  created_at?: string;
  updated_at?: string;
};

export type AddressInput = {
  label: string;
  address: string;
  lat: number;
  lng: number;
  note: string;
  is_default?: boolean;
};

/** Narrow an unknown payload to a `CustomerAddress`. */
export function parseAddress(raw: unknown): CustomerAddress | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string') return null;
  if (typeof m['label'] !== 'string') return null;
  if (typeof m['lat'] !== 'number' || typeof m['lng'] !== 'number') return null;
  return {
    id: m['id'],
    label: m['label'],
    address: typeof m['address'] === 'string' ? m['address'] : '',
    lat: m['lat'],
    lng: m['lng'],
    note: typeof m['note'] === 'string' ? m['note'] : '',
    is_default: m['is_default'] === true,
    created_at: typeof m['created_at'] === 'string' ? m['created_at'] : undefined,
    updated_at: typeof m['updated_at'] === 'string' ? m['updated_at'] : undefined,
  };
}

/** Default first, then newest — matches the API ordering. */
export function sortAddresses(list: CustomerAddress[]): CustomerAddress[] {
  return [...list].sort((a, b) => Number(b.is_default) - Number(a.is_default));
}

/** Parse a pasted "lat, lng" pair (e.g. "-6.2088, 106.8456"). */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.trim().replace(/[()]/g, '').split(/[,;\s]+/).filter(Boolean);
  if (m.length !== 2) return null;
  const lat = Number(m[0]);
  const lng = Number(m[1]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || (lat === 0 && lng === 0)) return null;
  return { lat, lng };
}
