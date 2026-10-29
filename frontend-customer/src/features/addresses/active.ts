/** Active delivery point shared by Home, Checkout and the address book.
 * Logged-in users sync it from their saved (default) address; guests and
 * offline use keep it in localStorage only. */

export type ActiveLoc = { lat: number; lng: number; note?: string };

const LOC_KEY = 'tb:customer:loc';
const ID_KEY = 'tb:customer:address_id';

export function getActiveLoc(): ActiveLoc | null {
  try {
    const raw = localStorage.getItem(LOC_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as { lat?: unknown; lng?: unknown; note?: unknown };
    if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return null;
    return { lat: p.lat, lng: p.lng, note: typeof p.note === 'string' ? p.note : undefined };
  } catch {
    return null;
  }
}

export function setActiveLoc(loc: ActiveLoc, addressId?: string | null): void {
  try {
    localStorage.setItem(LOC_KEY, JSON.stringify(loc));
    if (addressId === null) localStorage.removeItem(ID_KEY);
    else if (addressId) localStorage.setItem(ID_KEY, addressId);
  } catch {
    /* private mode: still works for this session */
  }
}

export function getActiveId(): string | null {
  try {
    return localStorage.getItem(ID_KEY);
  } catch {
    return null;
  }
}
