/** Typed calls to the customer catalog endpoints (`/v1/customer/...`). */

import { api } from '../../lib/api';
import { logger } from '../../lib/logger';
import {
  parseCustomerCategory,
  parseLiveExtras,
  parseMenuCategory,
  parseMenuItem,
  parseRatingExtras,
  type CustomerCategory,
  type MenuCategory,
  type MenuItem,
  type Restaurant,
  type RestaurantDetail,
} from './types';

/** Nearby approved restaurants, optionally narrowed server-side by menu category. */
export async function listRestaurants(args: {
  lat: number;
  lng: number;
  category?: string;
}): Promise<Restaurant[]> {
  const params = new URLSearchParams({
    lat: String(args.lat),
    lng: String(args.lng),
  });
  const category = (args.category ?? '').trim();
  if (category !== '') params.set('category', category);
  const res = await api<{ restaurants: unknown }>(`/customer/restaurants?${params.toString()}`);
  if (!Array.isArray(res.restaurants)) {
    logger.error('restaurants payload failed validation', { category });
    return [];
  }
  const out: Restaurant[] = [];
  for (const raw of res.restaurants) {
    if (typeof raw !== 'object' || raw === null) continue;
    const m = raw as Record<string, unknown>;
    if (
      typeof m['id'] !== 'string' ||
      typeof m['name'] !== 'string' ||
      typeof m['currency'] !== 'string'
    ) {
      continue;
    }
    out.push({
      id: m['id'],
      name: m['name'],
      currency: m['currency'],
      address: typeof m['address'] === 'string' ? m['address'] : '',
      distance_m: typeof m['distance_m'] === 'number' ? m['distance_m'] : 0,
      availability: typeof m['availability'] === 'string' ? m['availability'] : '',
      prep_minutes: typeof m['prep_minutes'] === 'number' ? m['prep_minutes'] : 0,
      ...parseLiveExtras(m),
      ...parseRatingExtras(m),
    });
  }
  return out;
}

/** One restaurant with pickup details + distance from the delivery point. */
export async function fetchRestaurant(args: {
  id: string;
  lat: number;
  lng: number;
}): Promise<RestaurantDetail> {
  const params = new URLSearchParams({ lat: String(args.lat), lng: String(args.lng) });
  const res = await api<Record<string, unknown>>(
    `/customer/restaurants/${args.id}?${params.toString()}`,
  );
  if (typeof res['name'] !== 'string' || typeof res['currency'] !== 'string') {
    logger.error('restaurant payload failed validation', { id: args.id });
    throw new Error('Unexpected restaurant response from server.');
  }
  return {
    id: args.id,
    name: res['name'],
    currency: res['currency'],
    address: typeof res['address'] === 'string' ? res['address'] : '',
    pickup_note: typeof res['pickup_note'] === 'string' ? res['pickup_note'] : '',
    prep_minutes: typeof res['prep_minutes'] === 'number' ? res['prep_minutes'] : 0,
    lat: typeof res['lat'] === 'number' ? res['lat'] : 0,
    lng: typeof res['lng'] === 'number' ? res['lng'] : 0,
    availability: typeof res['availability'] === 'string' ? res['availability'] : '',
    distance_m: typeof res['distance_m'] === 'number' ? res['distance_m'] : undefined,
    ...parseLiveExtras(res),
    ...parseRatingExtras(res),
  };
}

export type MenuResponse = {
  items: MenuItem[];
  categories: MenuCategory[];
  currency: string;
};

/** Full menu for one restaurant: items plus its category chip row. */
export async function fetchMenu(args: {
  restaurantId: string;
  categoryId?: string;
}): Promise<MenuResponse> {
  const params = new URLSearchParams();
  const categoryId = (args.categoryId ?? '').trim();
  if (categoryId !== '') params.set('category_id', categoryId);
  const suffix = params.toString() === '' ? '' : `?${params.toString()}`;
  const res = await api<{ items: unknown; categories: unknown; currency: unknown }>(
    `/customer/restaurants/${args.restaurantId}/menu${suffix}`,
  );
  const items: MenuItem[] = [];
  if (Array.isArray(res.items)) {
    for (const raw of res.items) {
      const item = parseMenuItem(raw);
      if (item) items.push(item);
    }
  }
  const categories: MenuCategory[] = [];
  if (Array.isArray(res.categories)) {
    for (const raw of res.categories) {
      const cat = parseMenuCategory(raw);
      if (cat) categories.push(cat);
    }
  }
  categories.sort((a, b) => a.sort - b.sort);
  return {
    items,
    categories,
    currency: typeof res.currency === 'string' ? res.currency : (items[0]?.price.currency ?? 'IDR'),
  };
}

/** Distinct menu categories across approved merchants for the Home chip row. */
export async function listCustomerCategories(): Promise<CustomerCategory[]> {
  const res = await api<{ categories: unknown }>('/customer/categories');
  if (!Array.isArray(res.categories)) return [];
  const out: CustomerCategory[] = [];
  for (const raw of res.categories) {
    const cat = parseCustomerCategory(raw);
    if (cat) out.push(cat);
  }
  return out;
}
