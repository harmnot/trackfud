/** Ops overview (A8 dashboard, PLAN §4.4 P0): today's numbers, the live
 * courier map and active orders — the first screen reviewers see.
 *
 * Data comes from `GET /v1/admin/dashboard` (one call: counts + dots + rows)
 * and refreshes every 30 s so the map stays live without a manual reload.
 * Review queues moved to `/review`; shortcuts there keep the triage flow one
 * tap away.
 */
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { formatMinor } from '../../lib/format';
import { Item, List, Note, Page, StatusBadge } from '../../components/ui';
import { fetchDashboard } from './api';
import type { Dashboard } from './types';
import { LiveMap } from './LiveMap';

function Err({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Note tone="error">
      {error instanceof Error ? error.message : 'Could not load the overview.'}{' '}
      <button className="tb-link" onClick={onRetry}>
        Retry
      </button>
    </Note>
  );
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="tb-stat">
      <span className="tb-stat-label">{label}</span>
      <span className="tb-stat-value">{value}</span>
      {sub ? <span className="tb-stat-sub">{sub}</span> : null}
    </div>
  );
}

function Stats({ d }: { d: Dashboard }) {
  const t = d.today;
  const gmv =
    t.gmv_delivered.length > 0
      ? t.gmv_delivered
          .map((g) => formatMinor(g.amount_minor, g.currency))
          .join(' · ')
      : '—';
  return (
    <section aria-label="Today's numbers" className="tb-stats">
      <Stat label="Orders today" value={String(t.orders_placed)} sub={`${t.orders_delivered} delivered`} />
      <Stat label="Active now" value={String(t.active_orders)} sub={`${d.live_couriers.length} dots on the map · ${t.couriers_online} sessions live`} />
      <Stat label="Couriers online" value={String(t.couriers_online)} />
      <Stat label="Delivered GMV" value={gmv} sub={t.date} />
      <Stat label="Awaiting review" value={String(t.pending_applications + t.pending_merchants)} sub={`${t.pending_applications} couriers · ${t.pending_merchants} merchants`} />
    </section>
  );
}

export function OverviewPage() {
  const q = useQuery({
    queryKey: ['admin', 'dashboard'],
    queryFn: fetchDashboard,
    refetchInterval: 30_000,
    retry: 1,
  });

  return (
    <Page>
      <h1 className="tb-display">Operations overview</h1>
      <p className="tb-sub">Live map + today&apos;s numbers. Refreshes every 30 seconds.</p>

      {q.isLoading && (
        <>
          <div className="tb-stats" aria-label="Loading numbers">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="tb-skel" style={{ height: 76 }} />
            ))}
          </div>
          <div className="tb-skel tb-map" aria-label="Map loading" />
        </>
      )}
      {q.isError && <Err error={q.error} onRetry={() => void q.refetch()} />}
      {q.data === null && !q.isLoading && !q.isError && (
        <Note tone="info">The overview endpoint returned an unexpected shape — retry in a moment.</Note>
      )}
      {q.data && (
        <>
          <Stats d={q.data} />
          <h2 className="tb-h2 mt-3">Live map</h2>
          <LiveMap couriers={q.data.live_couriers} orders={q.data.active_orders} />
          <h2 className="tb-h2 mt-3">Active orders ({q.data.active_orders.length})</h2>
          {q.data.active_orders.length === 0 ? (
            <Note tone="info">No active orders right now.</Note>
          ) : (
            <List>
              {q.data.active_orders.map((o, i) => (
                <Item key={o.id} index={i}>
                  <Link to={`/orders/${o.id}`} className="tb-person" style={{ textDecoration: 'none', color: 'inherit' }}>
                    <span className="tb-person-main">
                      <span className="tb-person-name">{o.code} · {o.merchant_name || 'merchant'}</span>
                      <span className="tb-person-sub">
                        {[o.delivery_status || o.status, o.courier_email || 'searching'].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                    <StatusBadge status={o.delivery_status || o.status} />
                  </Link>
                </Item>
              ))}
            </List>
          )}
          <nav className="tb-actions" aria-label="Review shortcuts">
            <Link to="/review" className="tb-btn tb-btn-soft tb-btn-sm">
              Review queue
            </Link>
            <Link to="/orders" className="tb-btn tb-btn-soft tb-btn-sm">
              All orders
            </Link>
          </nav>
        </>
      )}
    </Page>
  );
}
