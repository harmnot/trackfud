/**
 * Ratings received: average + count aggregated from the live delivery
 * history (`GET /courier/deliveries/history`, openapi
 * `listDeliveryHistory`). openapi.yaml has no dedicated courier-ratings
 * endpoint, and per-delivery rows carry stars but no topic tags — so tags
 * come back empty and customer names are hidden by contract (never
 * requested, never stored). Throws a typed error when the backend is
 * unreachable; the page shows its error state instead of sample data.
 */
import { fetchDeliveryHistory } from '../delivery/courierApi';

/** One rating topic tag (courier blamed for food never appears here). */
export type RatingTag = { tag: string; count: number };

/** What the ratings page shows. `demo` marks the offline sample summary. */
export type RatingsSummary = {
  average: number;
  count: number;
  tags: RatingTag[];
  demo: boolean;
};

/** Offline sample (labelled as such) only when the history call fails. */
export const DEMO_RATINGS: RatingsSummary = {
  average: 4.9,
  count: 37,
  tags: [
    { tag: 'friendly', count: 21 },
    { tag: 'careful with food', count: 17 },
    { tag: 'on time in window', count: 12 },
    { tag: 'great chat', count: 6 },
  ],
  demo: true,
};

/** Load the courier's received ratings (names hidden by contract). */
export async function fetchRatings(): Promise<RatingsSummary> {
  const rows = await fetchDeliveryHistory();
  const stars = rows
    .map((r) => r.courier_stars)
    .filter((s): s is number => typeof s === 'number' && s >= 1 && s <= 5);
  if (stars.length === 0) return { average: 0, count: 0, tags: [], demo: false };
  const sum = stars.reduce((a, b) => a + b, 0);
  return { average: sum / stars.length, count: stars.length, tags: [], demo: false };
}
