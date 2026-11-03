/** Courier performance page (A8, PLAN §8.6): 30-day rates, timing,
 * rating, work, WHO-week trend, overexertion, earnings, flags, peers and
 * history for one courier.
 *
 * Data comes from `GET /v1/admin/couriers/{user_id}/performance` — the same
 * tables the courier PWA writes (dispatch offers, deliveries, sessions,
 * ratings, ledger). Null rates render as "no data", never as 0%.
 */
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { formatMinor } from '../../lib/format';
import { Note, Page, StatusBadge } from '../../components/ui';
import { fetchPerformance } from './api';
import type { CourierPerformance, PerfRate } from './performance';

function Err({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Note tone="error">
      {error instanceof Error ? error.message : 'Could not load performance.'}{' '}
      <button className="tb-link" onClick={onRetry}>
        Retry
      </button>
    </Note>
  );
}

/** A fraction as "80%" or "6/10 · 60%", with "no data" for empty windows. */
function rateText(r: PerfRate): string {
  if (r.rate === null) return 'no data';
  return `${r.have}/${r.total} · ${Math.round(r.rate * 100)}%`;
}

function km(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

function mins(seconds: number): string {
  return `${Math.round(seconds / 60)} min`;
}

function secs(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return 'no data';
  if (seconds < 90) return `${Math.round(seconds)} s`;
  return `${Math.round(seconds / 60)} min`;
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="tb-card">
      <h2 className="tb-h2">{title}</h2>
      <dl className="tb-kv mt-3">{children}</dl>
    </div>
  );
}

function Row({ term, children }: { term: string; children: React.ReactNode }) {
  return (
    <div className="tb-kv-row">
      <dt>{term}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function PerformancePage() {
  const { userId = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'performance', userId],
    queryFn: () => fetchPerformance(userId),
    enabled: userId !== '',
    retry: 1,
  });

  return (
    <Page>
      <p>
        <Link to={userId ? `/couriers/${userId}` : '/'} className="tb-link">
          ← Back to application
        </Link>
      </p>
      <h1 className="tb-display">Courier performance</h1>
      <p className="tb-sub">Last 30 days · PLAN §8.6. Rates show &ldquo;no data&rdquo; until the courier has deliveries.</p>

      {q.isLoading && <div className="tb-skel" style={{ height: 220 }} />}
      {q.isError && <Err error={q.error} onRetry={() => void q.refetch()} />}
      {q.data === null && !q.isLoading && !q.isError && (
        <Note tone="info">Performance returned an unexpected shape — retry in a moment.</Note>
      )}
      {q.data && <PerfBody p={q.data} />}
    </Page>
  );
}

function PerfBody({ p }: { p: CourierPerformance }) {
  const c = p.courier;
  const standing = c.standing === 'frozen' || c.standing === 'banned' ? c.standing : '';
  const maxWeek = Math.max(1, ...p.weekly.map((w) => w.active_s));
  return (
    <>
      <div className="tb-card">
        <div className="tb-inline">
          <strong>{c.email || c.user_id}</strong>
          <StatusBadge status={standing !== '' ? standing : c.mode} />
          {p.peer_of > 0 && (
            <span className="tb-chip">
              #{p.peer_rank} of {p.peer_of} active couriers
              {p.peer_percentile !== null ? ` · top ${Math.round((1 - p.peer_percentile) * 100)}%` : ''}
            </span>
          )}
        </div>
        <p className="tb-sub mt-3">
          ★ {c.rating_bayes.toFixed(2)} ({c.rating_count} ratings) · {c.deliveries_count} lifetime deliveries ·{' '}
          {km(c.lifetime_distance_m)} lifetime · {mins(c.lifetime_moving_s)} moving · {mins(c.lifetime_active_s)} active
        </p>
      </div>

      <div className="tb-grid-2 mt-3">
        <Card title="Delivery rates">
          <Row term="Accepted offers">{rateText(p.acceptance)}</Row>
          <Row term="Completed">{rateText(p.completion)}</Row>
          <Row term="In-window">{rateText(p.in_window)}</Row>
          <Row term="Avg pickup wait">{secs(p.pickup_wait_s_avg)}</Row>
          <Row term="Avg delivery leg">{secs(p.delivery_s_avg)}</Row>
        </Card>
        <Card title="Rating">
          <Row term="Bayesian">★ {p.rating_bayes.toFixed(2)} ({p.rating_count})</Row>
          <Row term="Complaints">
            {p.complaints} ({p.complaints_per_100 === null ? 'no data' : `${p.complaints_per_100.toFixed(1)} per 100`})
          </Row>
          <Row term="Top tags">
            {p.top_tags.length > 0 ? p.top_tags.map((t) => `${t.tag} ×${t.count}`).join(', ') : '—'}
          </Row>
          <Row term="Top topics">
            {p.top_topics.length > 0 ? p.top_topics.map((t) => `${t.topic} ×${t.count}`).join(', ') : '—'}
          </Row>
        </Card>
        <Card title="Work">
          <Row term="Distance (30d)">{km(p.work_distance_m)}</Row>
          <Row term="Active (30d)">{mins(p.work_active_s)}</Row>
          <Row term="Per delivery">{km(p.per_delivery_m)}</Row>
          <Row term="WHO weeks met">{p.weeks_at_goal} of {p.weekly.length} (goal {p.goal_min}/week)</Row>
        </Card>
        <Card title="Safety + earnings">
          <Row term="Days over cap">{p.days_over_cap} (cap {p.daily_cap_min}/day)</Row>
          <Row term="Very long sessions">{p.long_sessions}</Row>
          <Row term="Earnings (30d)">
            {p.earnings.length > 0
              ? p.earnings.map((e) => formatMinor(e.amount_minor, e.currency)).join(' · ')
              : '—'}
          </Row>
          <Row term="Per active hour">
            {p.per_active_hour ? formatMinor(p.per_active_hour.amount_minor, p.per_active_hour.currency) : 'no data'}
          </Row>
          <Row term="Flagged sessions">{p.sessions_flagged}</Row>
        </Card>
      </div>

      <div className="tb-card mt-3">
        <h2 className="tb-h2">Weekly active minutes</h2>
        {p.weekly.length === 0 ? (
          <p className="tb-sub mt-3">No sessions in the last 8 weeks.</p>
        ) : (
          <div className="tb-bars" role="img" aria-label={`${p.weeks_at_goal} of ${p.weekly.length} weeks met the WHO goal`}>
            {[...p.weekly].reverse().map((w) => (
              <div key={w.week} className="tb-barcol" title={`${w.week}: ${mins(w.active_s)}${w.goal_met ? ' · goal met' : ''}`}>
                <div
                  className={`tb-bar${w.goal_met ? ' on' : ''}`}
                  style={{ height: `${Math.max(4, Math.round((w.active_s / maxWeek) * 72))}px` }}
                />
                <span className="tb-barlabel">{w.week.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {p.latest_flags.length > 0 && (
        <div className="tb-card mt-3">
          <h2 className="tb-h2">Anti-cheat flags (latest)</h2>
          <table className="tb-table mt-3">
            <caption className="tb-faint">Advisory only — a human decides, never an auto-ban.</caption>
            <thead>
              <tr>
                <th scope="col">Session</th>
                <th scope="col">Flags</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {p.latest_flags.map((f) => (
                <tr key={f.session_id}>
                  <td className="tb-code">{f.session_id.slice(0, 8)}…</td>
                  <td>{f.flags || '—'}</td>
                  <td>{f.started_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="tb-card mt-3">
        <h2 className="tb-h2">Recent deliveries</h2>
        {p.deliveries.length === 0 ? (
          <p className="tb-sub mt-3">No deliveries yet.</p>
        ) : (
          <table className="tb-table mt-3">
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Status</th>
                <th scope="col">In-window</th>
                <th scope="col">Stars</th>
                <th scope="col">Distance</th>
              </tr>
            </thead>
            <tbody>
              {p.deliveries.map((d) => (
                <tr key={d.id}>
                  <td>
                    <Link to={`/orders/${d.order_id || d.id}`} className="tb-link">
                      {d.order_code || d.id.slice(0, 8)}
                    </Link>
                  </td>
                  <td>
                    <StatusBadge status={d.status} />
                  </td>
                  <td>{d.in_window === null ? '—' : d.in_window ? 'yes' : 'late'}</td>
                  <td>{d.courier_stars === null ? '—' : `★${d.courier_stars}`}</td>
                  <td>{km(d.distance_m)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="tb-card mt-3">
        <h2 className="tb-h2">Recent sessions</h2>
        {p.sessions.length === 0 ? (
          <p className="tb-sub mt-3">No sessions yet.</p>
        ) : (
          <table className="tb-table mt-3">
            <thead>
              <tr>
                <th scope="col">Kind</th>
                <th scope="col">Status</th>
                <th scope="col">Distance</th>
                <th scope="col">Active</th>
                <th scope="col">Started</th>
              </tr>
            </thead>
            <tbody>
              {p.sessions.map((s) => (
                <tr key={s.id}>
                  <td>{s.kind || '—'}</td>
                  <td>
                    <StatusBadge status={s.status} />
                  </td>
                  <td>{km(s.distance_m)}</td>
                  <td>{mins(s.active_s)}</td>
                  <td>{s.started_at || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
