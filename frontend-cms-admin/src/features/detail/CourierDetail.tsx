import { Fragment } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError, api } from '../../lib/api';
import { formatList, formatValue, MISSING } from '../../lib/format';
import { toBriefView } from '../../lib/trust';
import type { BriefView } from '../../lib/trust';
import type { CourierApplication, CourierApplicationDetail, CourierProfile, Sanction, TrustBrief } from '../../lib/types';
import { Note, Page, StatusBadge } from '../../components/ui';
import { DecideBox } from './DecisionCard';
import { EvidenceCard } from './evidence';
import {
  AddressBlock,
  BikeBlock,
  ConsentsBlock,
  ContactBlock,
  EmailLink,
  IdValue,
  PhoneLink,
  ReviewOutcome,
} from './fields';
import { SanctionBox } from './SanctionCard';
import { detailRetry, isCourierDecidable, type CourierReview } from './review';
import { useDecide, useSanction } from './useReview';

function Err({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <Note tone="error">
      {error instanceof Error ? error.message : 'Could not load.'}{' '}
      <button className="tb-link" onClick={onRetry}>
        Retry
      </button>
    </Note>
  );
}

/** Fetch one courier application plus its advisory trust brief (404 → empty review). */
async function fetchCourierReview(userId: string): Promise<CourierReview> {
  let detail: CourierApplicationDetail;
  try {
    detail = await api<CourierApplicationDetail>(`/admin/courier-applications/${userId}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) {
      return { app: null, profile: null, brief: null, briefPending: false };
    }
    throw e;
  }
  let briefWire: TrustBrief | null = null;
  try {
    briefWire = await api<TrustBrief>(`/admin/courier-applications/${userId}/trust-brief`);
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  const brief = toBriefView(briefWire);
  const app: CourierApplication = {
    user_id: detail.user_id,
    email: detail.email,
    mode: detail.mode,
    status: detail.status,
    standing: typeof detail.standing === 'string' ? detail.standing : '',
    reject_reason: detail.reject_reason,
    fitness: {
      distance_m: detail.fitness.distance_m,
      moving_s: detail.fitness.moving_s,
      elapsed_s: detail.fitness.elapsed_s,
      passed: detail.fitness.passed,
      flags: Array.isArray(detail.fitness.flags) ? detail.fitness.flags : [],
      max_gap_s: detail.fitness.max_gap_s,
      checkpoints: typeof detail.fitness.checkpoints === 'number' ? detail.fitness.checkpoints : 0,
      checkpoint_file_ids: Array.isArray(detail.fitness.checkpoint_file_ids)
        ? detail.fitness.checkpoint_file_ids.filter((id): id is string => typeof id === 'string')
        : [],
    },
    submitted_at: detail.submitted_at ?? null,
    updated_at: detail.updated_at ?? null,
  };
  return { app, profile: detail.profile ?? null, brief, briefPending: brief?.pending ?? false };
}

/** Fetch the sanction history; applicants without a courier row simply have none. */
async function fetchCourierSanctions(userId: string): Promise<Sanction[]> {
  try {
    const d = await api<{ sanctions: Sanction[] }>(`/admin/couriers/${userId}/sanctions`);
    return Array.isArray(d.sanctions) ? d.sanctions : [];
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return [];
    throw e;
  }
}

/** Courier detail: application + saved profile + advisory trust brief + decision + sanctions. */
export function CourierDetail() {
  const { userId = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'courier', userId],
    queryFn: () => fetchCourierReview(userId),
    enabled: userId !== '',
    retry: detailRetry,
  });
  const sanctions = useQuery({
    queryKey: ['admin', 'courier-sanctions', userId],
    queryFn: () => fetchCourierSanctions(userId),
    enabled: userId !== '' && q.data?.app !== undefined,
    retry: detailRetry,
  });
  const d = useDecide(['admin'], (id, ok) => `/admin/courier-applications/${id}/${ok ? 'approve' : 'reject'}`);
  const s = useSanction('courier', (id) => `/admin/couriers/${id}/sanctions`);

  // Approve + Reject show only while the application is undecided (submitted).
  // Approved hides the card and shows the approval timestamp; rejected shows
  // the reason + updated_at. Mid-test/draft shows a waiting note instead.
  const status = q.data?.app?.status;
  const standing = q.data?.app?.standing ?? '';
  const decidable = isCourierDecidable(status);
  const showOutcome = status === 'approved' || status === 'rejected';
  // Sanctions live on the operational standing, not the application: a frozen
  // courier's application still reads approved, so the box keys off standing.
  const showSanctions =
    status === 'approved' || status === 'rejected' || standing === 'frozen' || standing === 'banned';
  const showWaiting =
    q.data?.app !== null && q.data?.app !== undefined && !decidable && !showOutcome;

  return (
    <Page>
      <p>
        <Link to="/" className="tb-link">
          ← Back to review queue
        </Link>
      </p>
      <h1 className="tb-display">Courier application</h1>
      <nav className="tb-actions" aria-label="Courier sections">
        <Link to={`/couriers/${userId}/performance`} className="tb-link">
          View 30-day performance →
        </Link>
      </nav>
      {q.isLoading && <div className="tb-skel mt-4" style={{ height: 220 }} />}
      {q.isError && <Err error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.app && <Note tone="info">No application found for this courier.</Note>}
      {q.data?.app && (
        <CourierCard app={q.data.app} profile={q.data.profile} brief={q.data.brief} briefPending={q.data.briefPending} />
      )}
      {showOutcome && q.data?.app && (
        <ReviewOutcome
          status={q.data.app.status}
          reason={q.data.app.reject_reason}
          updatedAt={q.data.app.updated_at}
          approvedAt={q.data.profile?.approved_at ?? null}
        />
      )}
      {showWaiting && (
        <div className="mt-3">
          <Note tone="info">
            Application is {status ?? 'not submitted'} — approve and reject unlock once the fitness test is submitted
            for review.
          </Note>
        </div>
      )}
      {decidable && (
        <div className="mt-3">
          <DecideBox
            busy={d.busy}
            err={d.err}
            done={d.done}
            onDecide={(ok, reason) => void d.decide(userId, ok, reason)}
          />
        </div>
      )}
      {showSanctions && (
        <div className="mt-3">
          <SanctionBox
            kinds={['freeze', 'unfreeze', 'ban']}
            history={sanctions.data ?? []}
            busy={s.busy}
            err={sanctions.isError ? 'Could not load sanction history.' : s.err}
            done={s.done}
            showEndsAt
            onSanction={(input) => void s.sanction(userId, input)}
          />
        </div>
      )}
    </Page>
  );
}

/** Format a fitness distance in meters as "2.40 km" (or an em dash when absent). */
function formatKm(distanceM: unknown): string {
  return typeof distanceM === 'number' && Number.isFinite(distanceM) ? `${(distanceM / 1000).toFixed(2)} km` : MISSING;
}

/** Format a duration in seconds as whole minutes (or an em dash when absent). */
function formatMin(seconds: unknown): string {
  return typeof seconds === 'number' && Number.isFinite(seconds) ? `${Math.round(seconds / 60)} min` : MISSING;
}

function CourierCard({
  app,
  profile,
  brief,
  briefPending,
}: {
  app: CourierApplication;
  profile: CourierProfile | null;
  brief: BriefView | null;
  briefPending: boolean;
}) {
  const f = app.fitness;
  const standing = app.standing === 'frozen' || app.standing === 'banned' ? app.standing : '';
  return (
    <div className="tb-grid-2 mt-3">
      <div className="tb-card">
        <h2 className="tb-h2">Personal</h2>
        <dl className="tb-kv mt-3">
          <div className="tb-kv-row">
            <dt>User ID</dt>
            <dd>
              <IdValue id={app.user_id} label="user ID" />
            </dd>
          </div>
          <div className="tb-kv-row">
            <dt>Email</dt>
            <dd>
              <EmailLink email={app.email} />
            </dd>
          </div>
          <div className="tb-kv-row">
            <dt>Mode</dt>
            <dd>{formatValue(profile?.mode ?? app.mode)}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Status</dt>
            <dd>
              <StatusBadge status={standing !== '' ? standing : (profile?.status ?? app.status)} />
            </dd>
          </div>
          {profile?.legal_name && (
            <div className="tb-kv-row">
              <dt>Legal name</dt>
              <dd>{formatValue(profile.legal_name)}</dd>
            </div>
          )}
          {profile?.phone && (
            <div className="tb-kv-row">
              <dt>Phone</dt>
              <dd>
                <PhoneLink phone={profile.phone} />
              </dd>
            </div>
          )}
          {profile?.nationality && (
            <div className="tb-kv-row">
              <dt>Nationality</dt>
              <dd>{formatValue(profile.nationality)}</dd>
            </div>
          )}
          {profile?.birth_date && (
            <div className="tb-kv-row">
              <dt>Birth date</dt>
              <dd>{formatValue(profile.birth_date)}</dd>
            </div>
          )}
          {profile?.address && (
            <div className="tb-kv-row">
              <dt>Address</dt>
              <dd>
                <AddressBlock value={profile.address} />
              </dd>
            </div>
          )}
          {profile?.emergency_contact && (
            <div className="tb-kv-row">
              <dt>Emergency contact</dt>
              <dd>
                <ContactBlock value={profile.emergency_contact} />
              </dd>
            </div>
          )}
          {app.submitted_at && (
            <div className="tb-kv-row">
              <dt>Submitted</dt>
              <dd>{formatValue(app.submitted_at)}</dd>
            </div>
          )}
          {app.updated_at && (
            <div className="tb-kv-row">
              <dt>Updated</dt>
              <dd>{formatValue(app.updated_at)}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="tb-card">
        <h2 className="tb-h2">Documents</h2>
        <dl className="tb-kv mt-3">
          <div className="tb-kv-row">
            <dt>ID type</dt>
            <dd>{formatValue(profile?.id_doc_type)}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>ID number</dt>
            <dd>{profile?.id_number_saved ? 'Saved (encrypted)' : MISSING}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>ID front</dt>
            <dd>{profile?.id_front_file_id ? <IdValue id={profile.id_front_file_id} label="ID front file" /> : MISSING}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>ID back</dt>
            <dd>{profile?.id_back_file_id ? <IdValue id={profile.id_back_file_id} label="ID back file" /> : MISSING}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Selfie</dt>
            <dd>{profile?.selfie_file_id ? <IdValue id={profile.selfie_file_id} label="selfie file" /> : MISSING}</dd>
          </div>
          {profile?.bag_liters !== undefined && (
            <div className="tb-kv-row">
              <dt>Bag</dt>
              <dd>{formatValue(profile.bag_liters)} L</dd>
            </div>
          )}
          {profile?.bike && (
            <div className="tb-kv-row">
              <dt>Bike</dt>
              <dd>
                <BikeBlock value={profile.bike} />
              </dd>
            </div>
          )}
          {profile?.consents && (
            <div className="tb-kv-row">
              <dt>Consents</dt>
              <dd>
                <ConsentsBlock value={profile.consents} />
              </dd>
            </div>
          )}
        </dl>
      </div>
      <div className="tb-card">
        <h2 className="tb-h2">Fitness test</h2>
        <dl className="tb-kv mt-3">
          <div className="tb-kv-row">
            <dt>Result</dt>
            <dd>{f.passed ? 'Passed' : 'Not passed'}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Distance</dt>
            <dd>{formatKm(f.distance_m)}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Moving</dt>
            <dd>{formatMin(f.moving_s)}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Elapsed</dt>
            <dd>{formatMin(f.elapsed_s)}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Max gap</dt>
            <dd>{typeof f.max_gap_s === 'number' && Number.isFinite(f.max_gap_s) ? `${f.max_gap_s} s` : MISSING}</dd>
          </div>
          <div className="tb-kv-row">
            <dt>Checkpoints</dt>
            {/* Checkpoint photos counted from activity_sessions; 0 means none recorded yet. */}
            <dd>{f.checkpoints > 0 ? String(f.checkpoints) : MISSING}</dd>
          </div>
          {f.flags.length > 0 && (
            <div className="tb-kv-row">
              <dt>Flags</dt>
              <dd>{formatList(f.flags)}</dd>
            </div>
          )}
        </dl>
      </div>
      <EvidenceCard profile={profile} fitness={f} />
      {briefPending && (
        <div className="tb-card">
          <h2 className="tb-h2">Trust brief (advisory)</h2>
          <p className="tb-sub mt-3">The trust brief is still being generated — check back shortly.</p>
        </div>
      )}
      {brief && !brief.pending && (
        <div className="tb-card">
          <h2 className="tb-h2">Trust brief (advisory)</h2>
          {brief.recommendation && <p className="tb-sub">Recommendation: {brief.recommendation}</p>}
          {brief.summary && <p className="mt-3">{brief.summary}</p>}
          {brief.photoNote && <p className="tb-sub mt-3">Photo: {brief.photoNote}</p>}
          {brief.signals.length > 0 && (
            <dl className="tb-kv mt-3">
              {brief.signals.map((sg) => (
                <Fragment key={sg.label}>
                  <dt>{sg.label}</dt>
                  <dd>{sg.value}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
