/** Catalog domain types for the Customer app (mirrors `backend/api/openapi.yaml`). */

export type Restaurant = {
  id: string;
  name: string;
  currency: string;
  address: string;
  distance_m: number;
  availability: string;
  /** Live couriers online near this restaurant right now (omitted = unknown). */
  live_couriers_count?: number;
  live_modes?: string[];
  live_nearest_m?: number;
  /** Honest aggregate of collected restaurant_stars (omitted = unrated). */
  rating_avg?: number;
  rating_count?: number;
  prep_minutes: number;
};

export type RestaurantDetail = {
  id: string;
  name: string;
  currency: string;
  address: string;
  pickup_note: string;
  prep_minutes: number;
  lat: number;
  lng: number;
  availability: string;
  distance_m?: number;
  /** Live couriers online near this restaurant right now (omitted = unknown). */
  live_couriers_count?: number;
  live_modes?: string[];
  live_nearest_m?: number;
  /** Honest aggregate of collected restaurant_stars (omitted = unrated). */
  rating_avg?: number;
  rating_count?: number;
};

export type MenuCategory = {
  id: string;
  name: Record<string, string>;
  sort: number;
};

/** One menu item as served by `GET /v1/customer/restaurants/{id}/menu`. */
export type MenuItem = {
  id: string;
  category_id: string | null;
  name: Record<string, string>;
  description: Record<string, string>;
  price: { amount_minor: number; currency: string };
  travels_well: boolean;
  size_class: string;
  available: boolean;
};

/** One global chip from `GET /v1/customer/categories` (grouped by name). */
export type CustomerCategory = {
  name: Record<string, string>;
  label: string;
  restaurant_count: number;
};

function isLocaleMap(raw: unknown): raw is Record<string, string> {
  if (typeof raw !== 'object' || raw === null) return false;
  return Object.values(raw).every((v) => typeof v === 'string');
}

/** Narrow an unknown payload to a `MenuCategory`. */
export function parseMenuCategory(raw: unknown): MenuCategory | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || !isLocaleMap(m['name'])) return null;
  return {
    id: m['id'],
    name: m['name'],
    sort: typeof m['sort'] === 'number' ? m['sort'] : 0,
  };
}

/** Narrow an unknown payload to a `MenuItem` (category_id optional for back-compat). */
export function parseMenuItem(raw: unknown): MenuItem | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (typeof m['id'] !== 'string' || !isLocaleMap(m['name'])) return null;
  const price = m['price'];
  if (typeof price !== 'object' || price === null) return null;
  const p = price as Record<string, unknown>;
  if (typeof p['amount_minor'] !== 'number' || typeof p['currency'] !== 'string') return null;
  const rawCat = m['category_id'];
  return {
    id: m['id'],
    category_id: typeof rawCat === 'string' ? rawCat : null,
    name: m['name'],
    description: isLocaleMap(m['description']) ? m['description'] : {},
    price: { amount_minor: p['amount_minor'], currency: p['currency'] },
    travels_well: m['travels_well'] === true,
    size_class: typeof m['size_class'] === 'string' ? m['size_class'] : '',
    available: m['available'] !== false,
  };
}

/** Narrow an unknown payload to a `CustomerCategory`. */
export function parseCustomerCategory(raw: unknown): CustomerCategory | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const m = raw as Record<string, unknown>;
  if (!isLocaleMap(m['name'])) return null;
  const label = typeof m['label'] === 'string' && m['label'] !== ''
    ? m['label']
    : (m['name'] as Record<string, string>)['en'] ?? Object.values(m['name'] as Record<string, string>)[0] ?? '';
  if (label === '') return null;
  return {
    name: m['name'],
    label,
    restaurant_count: typeof m['restaurant_count'] === 'number' ? m['restaurant_count'] : 0,
  };
}

/** Display label for a category in the requested language (en fallback). */
export function categoryLabel(name: Record<string, string>, lang: string): string {
  return name[lang] ?? name['en'] ?? Object.values(name)[0] ?? '';
}

/**
 * True when the badge means couriers are live nearby. Accepts the current
 * `runners_bikers_nearby` plus the legacy `runners_nearby` older backends
 * (or cached rows) may still serve — both render the live treatment.
 */
export function isLiveNearby(availability: string): boolean {
  return availability === 'runners_bikers_nearby' || availability === 'runners_nearby';
}

/** Narrow the rating aggregate the API attaches to restaurant rows. */
export function parseRatingExtras(raw: Record<string, unknown>): {
  rating_avg?: number;
  rating_count?: number;
} {
  const extras: {
    rating_avg?: number;
    rating_count?: number;
  } = {};
  const avg = raw['rating_avg'];
  if (typeof avg === 'number' && Number.isFinite(avg) && avg >= 1 && avg <= 5) {
    extras.rating_avg = avg;
  }
  const count = raw['rating_count'];
  if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
    extras.rating_count = Math.floor(count);
  }
  return extras;
}

/** Narrow the live-badge extras the API attaches to restaurant rows. */
export function parseLiveExtras(raw: Record<string, unknown>): {
  live_couriers_count?: number;
  live_modes?: string[];
  live_nearest_m?: number;
} {
  const extras: {
    live_couriers_count?: number;
    live_modes?: string[];
    live_nearest_m?: number;
  } = {};
  const count = raw['live_couriers_count'];
  if (typeof count === 'number' && Number.isFinite(count) && count >= 0) {
    extras.live_couriers_count = Math.floor(count);
  }
  const modes = raw['live_modes'];
  if (Array.isArray(modes)) {
    const clean = modes.filter((m): m is string => typeof m === 'string' && m !== '');
    if (clean.length > 0) extras.live_modes = [...new Set(clean)];
  }
  const nearest = raw['live_nearest_m'];
  if (typeof nearest === 'number' && Number.isFinite(nearest) && nearest >= 0) {
    extras.live_nearest_m = nearest;
  }
  return extras;
}
