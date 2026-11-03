/**
 * Courier Orders list state: scroll pagination (10 per page), status filter
 * and debounced free-text search over the live delivery history
 * (`GET /courier/deliveries/history`, openapi `listDeliveryHistory`).
 * Delivered legs show their payout; cancelled legs show zero payout plus the
 * cancel note. No mock rows — loading / error / empty states are honest.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  fetchDeliveryHistory,
  type DeliveryHistoryRow,
  type DeliveryHistoryStatus,
} from '../delivery/courierApi';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';

/** Scroll window: the server default, one page of history per refill. */
export const ORDERS_PER_PAGE = 10;

type OrdersState = {
  rows: DeliveryHistoryRow[];
  total: number;
  hasMore: boolean;
  /** First-page load (skeleton cards). */
  loading: boolean;
  /** Sentinel refill in flight (inline loader). */
  loadingMore: boolean;
  failed: boolean;
};

export function useCourierOrders(args: { enabled: boolean }): OrdersState & {
  status: DeliveryHistoryStatus;
  query: string;
  setStatus: (s: DeliveryHistoryStatus) => void;
  setQuery: (q: string) => void;
  loadMore: () => void;
  retry: () => void;
} {
  const enabled = args.enabled;
  const [status, setStatusState] = useState<DeliveryHistoryStatus>('all');
  const [query, setQueryState] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  const [rows, setRows] = useState<DeliveryHistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(enabled);
  const [loadingMore, setLoadingMore] = useState(false);
  const [failed, setFailed] = useState(false);
  const reqId = useRef(0);

  // Debounce the search box so each keystroke is not a request.
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQ(query.trim()), 400);
    return () => window.clearTimeout(timer);
  }, [query]);

  const loadPage = useCallback(
    async (opts: { page: number; append: boolean }): Promise<void> => {
      if (!enabled) return;
      const id = reqId.current + 1;
      reqId.current = id;
      if (opts.append) {
        setLoadingMore(true);
      } else {
        setLoading(true);
        setFailed(false);
      }
      try {
        const res = await fetchDeliveryHistory({
          page: opts.page,
          perPage: ORDERS_PER_PAGE,
          status,
          q: debouncedQ,
        });
        if (reqId.current !== id) return;
        setRows((prev) => (opts.append ? [...prev, ...res.rows] : res.rows));
        setTotal(res.total);
        setHasMore(res.hasMore);
        setFailed(false);
      } catch (err) {
        if (reqId.current !== id) return;
        if (!opts.append) {
          setRows([]);
          setTotal(0);
          setHasMore(false);
          setFailed(true);
        }
        logger.warn('courier orders page failed', err instanceof ApiError ? err.message : err);
      } finally {
        if (reqId.current === id) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [debouncedQ, enabled, status],
  );

  // Filter or search change → fresh first page.
  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    void loadPage({ page: 1, append: false });
  }, [enabled, loadPage]);

  const loadMore = useCallback(() => {
    if (!enabled || loading || loadingMore || !hasMore || failed) return;
    const next = Math.floor(rows.length / ORDERS_PER_PAGE) + 1;
    if (next < 2) return;
    void loadPage({ page: next, append: true });
  }, [enabled, failed, hasMore, loading, loadingMore, loadPage, rows.length]);

  const setStatus = useCallback((s: DeliveryHistoryStatus) => {
    setStatusState(s);
  }, []);

  const setQuery = useCallback((q: string) => {
    setQueryState(q.slice(0, 64));
  }, []);

  const retry = useCallback(() => {
    void loadPage({ page: 1, append: false });
  }, [loadPage]);

  return {
    rows,
    total,
    hasMore,
    loading: loading && enabled,
    loadingMore,
    failed,
    status,
    query,
    setStatus,
    setQuery,
    loadMore,
    retry,
  };
}
