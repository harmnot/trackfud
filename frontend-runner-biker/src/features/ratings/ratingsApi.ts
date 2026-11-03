/**
 * Ratings received: average + count + tag labels aggregated from the live
 * delivery history (`GET /courier/deliveries/history`, openapi
 * `listDeliveryHistory`). openapi.yaml has no dedicated courier-ratings
 * endpoint; per-delivery rows carry stars + `courier_tags`, and customer names
 * are hidden by contract (never requested, never stored). Throws a typed
 * error when the backend is unreachable; the page shows its error state
 * instead of sample data.
 */
import { fetchDeliveryHistory, type DeliveryHistoryRow } from '../delivery/courierApi';

/** One rating topic tag (courier blamed for food never appears here). */
export type RatingTag = { tag: string; count: number };

/** What the ratings page shows. `demo` marks the offline sample summary. */
export type RatingsSummary = {
  average: number;
  count: number;
  tags: RatingTag[];
  demo: boolean;
};

/** Realistic sample for unit tests only — never rendered as live data. */
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
  // Aggregate across scroll pages (50 rows at a time, hard cap of 20 pages)
  // so a long career still averages every rated delivery, not just page 1.
  const rows: DeliveryHistoryRow[] = [];
  let page = 1;
  for (let guard = 0; guard < 20; guard++) {
    const chunk = await fetchDeliveryHistory({ page, perPage: 50 });
    rows.push(...chunk.rows);
    if (!chunk.hasMore) break;
    page = chunk.page + 1;
  }
  const stars = rows
    .map((r) => r.courier_stars)
    .filter((s): s is number => typeof s === 'number' && s >= 1 && s <= 5);
  // Aggregate customer tag labels across rated deliveries (server stores
  // `courier_tags` per order; names never leave the backend).
  const counts = new Map<string, number>();
  for (const r of rows) {
    const tags = Array.isArray(r.courier_tags) ? r.courier_tags : [];
    for (const raw of tags) {
      const tag = raw.trim().slice(0, 40);
      if (tag.length === 0) continue;
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  const tags = [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);
  if (stars.length === 0) return { average: 0, count: 0, tags, demo: false };
  const sum = stars.reduce((a, b) => a + b, 0);
  return { average: sum / stars.length, count: stars.length, tags, demo: false };
}
