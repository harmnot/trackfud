/** Server state for the customer catalog (react-query; local UI state stays local). */

import { useQuery } from '@tanstack/react-query';
import { fetchMenu, fetchRestaurant, listCustomerCategories, listRestaurants } from './api';

/** Nearby restaurants; `category` narrows server-side (`?category=`). */
export function useRestaurants(args: { lat: number; lng: number; category?: string }) {
  const category = (args.category ?? '').trim();
  return useQuery({
    queryKey: ['restaurants', args.lat, args.lng, category],
    queryFn: () => listRestaurants({ lat: args.lat, lng: args.lng, category }),
    // The availability badge is live (who is online near each restaurant
    // right now), so refetch on an interval while the list is mounted.
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/** One restaurant's detail (pickup note, distance, availability badge). */
export function useRestaurant(args: { id: string | undefined; lat: number; lng: number }) {
  return useQuery({
    queryKey: ['restaurant', args.id, args.lat, args.lng],
    queryFn: () => fetchRestaurant({ id: args.id ?? '', lat: args.lat, lng: args.lng }),
    enabled: (args.id ?? '') !== '',
    staleTime: 15 * 1000,
    refetchInterval: 30 * 1000,
  });
}

/** Menu items + category chips for one restaurant (`categoryId` filters server-side). */
export function useMenu(args: { restaurantId: string | undefined; categoryId?: string }) {
  const categoryId = (args.categoryId ?? '').trim();
  return useQuery({
    queryKey: ['menu', args.restaurantId, categoryId],
    queryFn: () =>
      fetchMenu({ restaurantId: args.restaurantId ?? '', categoryId }),
    enabled: (args.restaurantId ?? '') !== '',
  });
}

/** Global category chips for Home (distinct across approved merchants). */
export function useCustomerCategories() {
  return useQuery({
    queryKey: ['customer-categories'],
    queryFn: listCustomerCategories,
    staleTime: 5 * 60 * 1000,
  });
}
