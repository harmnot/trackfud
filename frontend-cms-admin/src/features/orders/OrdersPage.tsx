/**
 * Orders queue (A7 orders list, PLAN §4.4 P0): every order newest first with
 * parties, totals and live dispatch state. Rows link to the detail page
 * (timeline, chat, proof, refund). All rows come from
 * `GET /v1/admin/orders`; the status filter + free-text search narrow
 * server-side, and the queue scroll-pages 10 rows at a time.
 *
 * Responsive: cards stack 1-col on phones, 2-col from 720px — the same
 * `tb-grid-2` language as the withdrawals queue.
 */
import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatMinor, formatValue } from '../../lib/format';
import { Dropdown, Item, List, LoadMore, Note, Page, StatusBadge, TextInput, useDebouncedValue } from '../../components/ui';
import { fetchAdminOrders } from './api';
import { ORDER_FILTERS, type AdminOrder, type OrderFilter } from './types';

const PAGE_SIZE = 10;

export function OrdersPage() {
  const [filter, setFilter] = useState<OrderFilter>('all');
  const [search, setSearch] = useState('');
  const q = useDebouncedValue(search, 300);
  const orders = useInfiniteQuery({
    queryKey: ['admin', 'orders', filter, q],
    queryFn: ({ pageParam }) => fetchAdminOrders({ filter, q, page: pageParam, perPage: PAGE_SIZE }),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.hasMore ? last.page + 1 : undefined),
  });

  const rows = orders.data?.pages.flatMap((p) => p.rows) ?? [];
  const total = orders.data?.pages[0]?.total;

  return (
    <Page>
      <h1 className="tb-display">Orders</h1>
      <p className="tb-sub">
        Every order with its timeline, chat, proof photo and money trail. Open one to support a
        stuck handover or issue a refund.
      </p>

      <div className="tb-toolbar">
        <Dropdown
          label="Order status filter"
          value={filter}
          options={ORDER_FILTERS.map((s) => ({
            value: s,
            label: s === 'all' ? 'All statuses' : s,
          }))}
          onChange={(v) => setFilter(v as OrderFilter)}
        />
        <TextInput
          aria-label="Search orders by code, customer email or merchant"
          placeholder="Search code, email, merchant…"
          value={search}
          onChange={setSearch}
        />
        <span className="tb-count">
          {orders.isLoading ? '…' : `${rows.length}${total !== undefined ? ` of ${total}` : ''} shown`}
        </span>
      </div>

      {orders.isLoading && (
        <List>
          {[0, 1, 2].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 120 }} />
            </Item>
          ))}
        </List>
      )}
      {orders.isError && (
        <Note tone="error">
          Could not load orders ({orders.error instanceof Error ? orders.error.message : 'unknown error'}).{' '}
          <button className="tb-link" onClick={() => void orders.refetch()}>
            Retry
          </button>
        </Note>
      )}
      {!orders.isLoading && !orders.isError && rows.length === 0 && (
        <Note tone="info">No orders in this state.</Note>
      )}
      <div className="tb-grid-2 mt-3">
        {rows.map((o) => (
          <OrderCard key={o.id} order={o} />
        ))}
      </div>
      {!orders.isLoading && (
        <LoadMore
          hasMore={orders.hasNextPage ?? false}
          loading={orders.isFetchingNextPage}
          label="Load more orders"
          onLoad={() => void orders.fetchNextPage()}
        />
      )}
    </Page>
  );
}

function OrderCard({ order: o }: { order: AdminOrder }) {
  return (
    <div className="tb-card">
      <h2 className="tb-h2">
        {o.code !== '' ? o.code : o.id.slice(0, 8)}{' '}
        <StatusBadge status={o.status} />
      </h2>
      <p className="tb-sub tb-tight">
        {formatMinor(o.total.amount_minor, o.total.currency)} · {formatValue(o.merchant.name)} →{' '}
        {formatValue(o.customer.email)}
      </p>
      <dl className="tb-kv mt-3">
        <div className="tb-kv-row">
          <dt>Payment</dt>
          <dd>
            {formatValue(o.payment_method)} · {formatValue(o.payment_status)}
          </dd>
        </div>
        <div className="tb-kv-row">
          <dt>Delivery</dt>
          <dd>{o.delivery ? `${o.delivery.status} · ${o.delivery.type}` : 'not dispatched yet'}</dd>
        </div>
        {o.cancel_reason !== '' && (
          <div className="tb-kv-row">
            <dt>Cancel reason</dt>
            <dd>{formatValue(o.cancel_reason)}</dd>
          </div>
        )}
        <div className="tb-kv-row">
          <dt>Created</dt>
          <dd>{o.created_at !== '' ? formatValue(o.created_at) : '—'}</dd>
        </div>
      </dl>
      <div className="tb-actions">
        <Link to={`/orders/${o.id}`} className="tb-btn tb-btn-clay tb-btn-sm">
          Open timeline, chat, proof, refund
        </Link>
      </div>
    </div>
  );
}
