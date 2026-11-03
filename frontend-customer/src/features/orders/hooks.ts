/** Order data hooks: server state in react-query, polling only while live. */

import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchOrder, listOrders } from './api';
import { isLiveStatus, keepNewerCourierFix, type OrderDetail, type OrderStatus } from './types';

const POLL_MS = 10000;
/** Floor for the countdown to the next poll, so it never spins. */
const MIN_POLL_GAP_MS = 1000;
/** Customer order history scroll page: newest 10 first, auto-loaded on scroll. */
const PAGE_SIZE = 10;

/** React-query key of one order's detail (shared with the live WS channel). */
export function orderKey(id: string): readonly ['order', string] {
  return ['order', id] as const;
}

/** Ms until the next fallback poll, counted from the last server answer
 * (success or error). Live courier fixes write the cache in between without
 * touching that clock (`live.ts`), so they never postpone the poll. */
function untilNextPoll(lastServerAt: number): number {
  const left = lastServerAt + POLL_MS - Date.now();
  return Math.min(POLL_MS, Math.max(MIN_POLL_GAP_MS, left));
}

/** One order with items + events; refetches every 10 s only while the order is live. */
export function useOrder(args: { id: string }) {
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: orderKey(args.id),
    queryFn: async (): Promise<OrderDetail> => {
      const fresh = await fetchOrder({ id: args.id });
      // A live WS courier fix may have landed while this request was in flight.
      return keepNewerCourierFix({ fresh, cached: qc.getQueryData<OrderDetail>(orderKey(args.id)) });
    },
    refetchInterval: (q) => {
      const status = q.state.data?.order.status as OrderStatus | undefined;
      if (!status) return POLL_MS;
      if (!isLiveStatus(status)) return false;
      return untilNextPoll(Math.max(q.state.dataUpdatedAt, q.state.errorUpdatedAt));
    },
  });
  return query;
}

/** Customer order history, scroll-paginated; `q` searches order codes server-side. */
export function useOrders(args?: { q?: string }) {
  const q = (args?.q ?? '').trim();
  return useInfiniteQuery({
    queryKey: ['orders', q],
    queryFn: ({ pageParam }) => listOrders({ page: pageParam, perPage: PAGE_SIZE, q }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });
}
