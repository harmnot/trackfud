/** Order data hooks: server state in react-query, polling only while live. */

import { useQuery } from '@tanstack/react-query';
import { fetchOrder, listOrders } from './api';
import { isLiveStatus, type OrderStatus } from './types';

const POLL_MS = 10000;

/** One order with items + events; refetches every 10 s only while the order is live. */
export function useOrder(args: { id: string }) {
  const query = useQuery({
    queryKey: ['order', args.id],
    queryFn: () => fetchOrder({ id: args.id }),
    refetchInterval: (q) => {
      const status = q.state.data?.order.status as OrderStatus | undefined;
      if (!status) return POLL_MS;
      return isLiveStatus(status) ? POLL_MS : false;
    },
  });
  return query;
}

/** Recent customer orders for the orders list. */
export function useOrders() {
  return useQuery({ queryKey: ['orders'], queryFn: listOrders });
}
