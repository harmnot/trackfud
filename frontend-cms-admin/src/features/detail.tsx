import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError, api } from '../lib/api';
import { logger } from '../lib/logger';
import type { CourierApplication, CourierApplicationDetail, CourierProfile, MerchantDetail, TrustBrief } from '../lib/types';
import { Button, Field, Note, Page, StatusBadge } from '../components/ui';

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

function useDecide(prefix: (string | number)[], path: (id: string, approve: boolean) => string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');
  async function decide(id: string, approve: boolean, reason: string) {
    setErr('');
    setDone('');
    if (!approve && reason.trim() === '') {
      setErr('A rejection reason is required.');
      return;
    }
    setBusy(true);
    try {
      await api(path(id, approve), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approve ? {} : { reason: reason.trim() }),
      });
      setDone(approve ? 'Approved.' : 'Rejected with reason.');
      await qc.invalidateQueries({ queryKey: prefix });
    } catch (e) {
      logger.warn('review decision failed', {});
      setErr(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }
  return { decide, busy, err, done };
}

function DecideBox({
  onDecide,
  busy,
  err,
  done,
}: {
  onDecide: (approve: boolean, reason: string) => void;
  busy: boolean;
  err: string;
  done: string;
}) {
  const [reason, setReason] = useState('');
  const [confirmReject, setConfirmReject] = useState(false);
  function submit(approve: boolean) {
    if (!approve && !confirmReject) {
      setConfirmReject(true);
      return;
    }
    onDecide(approve, reason);
  }
  return (
    <div className="tb-card">
      <h2 className="tb-h2">Decision</h2>
      <div className="mt-3">
        <Field label="Rejection reason (required to reject)">
          <textarea
            className="tb-input"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. ID document unreadable — please re-upload"
          />
        </Field>
      </div>
      {err && <Note tone="error">{err}</Note>}
      {done && <Note tone="info">{done}</Note>}
      <div className="tb-actions">
        <Button variant="pine" disabled={busy} onClick={() => submit(true)}>
          {busy ? '…' : 'Approve'}
        </Button>
        <Button
          variant={confirmReject ? 'danger' : 'soft'}
          disabled={busy}
          onClick={() => submit(false)}
        >
          {confirmReject ? 'Confirm reject' : 'Reject'}
        </Button>
      </div>
    </div>
  );
}

/** Courier detail: application + saved profile + advisory trust brief + approve/reject. */
export function CourierDetail() {
  const { userId = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'courier', userId],
    queryFn: async (): Promise<{ app: CourierApplication | null; profile: CourierProfile | null; brief: TrustBrief | null }> => {
      let detail: CourierApplicationDetail;
      try {
        detail = await api<CourierApplicationDetail>(`/admin/courier-applications/${userId}`);
      } catch (e) {
        if (e instanceof ApiError && e.status === 404) return { app: null, profile: null, brief: null };
        throw e;
      }
      let brief: TrustBrief | null = null;
      try {
        brief = await api<TrustBrief>(`/admin/courier-applications/${userId}/trust-brief`);
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) throw e;
      }
      const app: CourierApplication = {
        user_id: detail.user_id,
        email: detail.email,
        mode: detail.mode,
        status: detail.status,
        reject_reason: detail.reject_reason,
        fitness: { ...detail.fitness, checkpoints: 0 },
        submitted_at: null,
        updated_at: null,
      };
      return { app, profile: detail.profile, brief };
    },
  });
  const d = useDecide(['admin'], (id, ok) => `/admin/courier-applications/${id}/${ok ? 'approve' : 'reject'}`);

  return (
    <Page>
      <p>
        <Link to="/" className="tb-link">
          ← Back to review queue
        </Link>
      </p>
      <h1 className="tb-display">Courier application</h1>
      {q.isLoading && <div className="tb-skel mt-4" style={{ height: 220 }} />}
      {q.isError && <Err error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && !q.data.app && <Note tone="info">No application found for this courier.</Note>}
      {q.data?.app && <CourierCard app={q.data.app} profile={q.data.profile} brief={q.data.brief} />}
      {q.data?.app && (
        <div className="mt-3">
          <DecideBox
            busy={d.busy}
            err={d.err}
            done={d.done}
            onDecide={(ok, reason) => void d.decide(userId, ok, reason)}
          />
        </div>
      )}
    </Page>
  );
}

function CourierCard({ app, profile, brief }: { app: CourierApplication; profile: CourierProfile | null; brief: TrustBrief | null }) {
  const f = app.fitness;
  return (
    <div className="tb-grid-2 mt-3">
      <div className="tb-card">
        <h2 className="tb-h2">Personal</h2>
        <dl className="tb-kv mt-3">
          <dt>Email</dt>
          <dd>{app.email}</dd>
          <dt>Mode</dt>
          <dd>{app.mode}</dd>
          <dt>Status</dt>
          <dd>
            <StatusBadge status={app.status} />
          </dd>
          {profile?.legal_name && (
            <>
              <dt>Legal name</dt>
              <dd>{profile.legal_name}</dd>
            </>
          )}
          {profile?.phone && (
            <>
              <dt>Phone</dt>
              <dd>{profile.phone}</dd>
            </>
          )}
          {profile?.nationality && (
            <>
              <dt>Nationality</dt>
              <dd>{profile.nationality}</dd>
            </>
          )}
          {profile?.birth_date && (
            <>
              <dt>Birth date</dt>
              <dd>{profile.birth_date}</dd>
            </>
          )}
          {app.reject_reason && (
            <>
              <dt>Reject reason</dt>
              <dd>{app.reject_reason}</dd>
            </>
          )}
          {app.submitted_at && (
            <>
              <dt>Submitted</dt>
              <dd>{app.submitted_at}</dd>
            </>
          )}
          {app.updated_at && (
            <>
              <dt>Updated</dt>
              <dd>{app.updated_at}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="tb-card">
        <h2 className="tb-h2">Documents</h2>
        <dl className="tb-kv mt-3">
          <dt>ID type</dt>
          <dd>{profile?.id_doc_type || '—'}</dd>
          <dt>ID number</dt>
          <dd>{profile?.id_number_saved ? 'Saved (encrypted)' : '—'}</dd>
          <dt>ID front</dt>
          <dd>{profile?.id_front_file_id || '—'}</dd>
          <dt>ID back</dt>
          <dd>{profile?.id_back_file_id || '—'}</dd>
          <dt>Selfie</dt>
          <dd>{profile?.selfie_file_id || '—'}</dd>
          {profile?.bag_liters !== undefined && (
            <>
              <dt>Bag</dt>
              <dd>{profile.bag_liters} L</dd>
            </>
          )}
        </dl>
      </div>
      <div className="tb-card">
        <h2 className="tb-h2">Fitness test</h2>
        <dl className="tb-kv mt-3">
          <dt>Result</dt>
          <dd>{f.passed ? 'Passed' : 'Not passed'}</dd>
          <dt>Distance</dt>
          <dd>{(f.distance_m / 1000).toFixed(2)} km</dd>
          <dt>Moving</dt>
          <dd>{Math.round(f.moving_s / 60)} min</dd>
          <dt>Checkpoints</dt>
          <dd>{f.checkpoints}</dd>
          {f.flags.length > 0 && (
            <>
              <dt>Flags</dt>
              <dd>{f.flags.join(', ')}</dd>
            </>
          )}
        </dl>
      </div>
      {brief && (
        <div className="tb-card">
          <h2 className="tb-h2">Trust brief (advisory)</h2>
          {brief.recommendation && <p className="tb-sub">Recommendation: {brief.recommendation}</p>}
          {brief.summary && <p className="mt-3">{brief.summary}</p>}
          {brief.signals && brief.signals.length > 0 && (
            <dl className="tb-kv mt-3">
              {brief.signals.map((s) => (
                <>
                  <dt key={`k-${s.label}`}>{s.label}</dt>
                  <dd key={`v-${s.label}`}>{s.value}</dd>
                </>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}

/** Merchant detail: business record + agreement + staff + approve/reject. */
export function MerchantDetail() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'merchant', id],
    queryFn: async (): Promise<MerchantDetail> => {
      const d = await api<{ merchant: MerchantDetail }>(`/admin/merchants/${id}`);
      return d.merchant;
    },
  });
  const d = useDecide(['admin'], (mid, ok) => `/admin/merchants/${mid}/${ok ? 'approve' : 'reject'}`);

  return (
    <Page>
      <p>
        <Link to="/" className="tb-link">
          ← Back to review queue
        </Link>
      </p>
      <h1 className="tb-display">Merchant review</h1>
      {q.isLoading && <div className="tb-skel mt-4" style={{ height: 220 }} />}
      {q.isError && <Err error={q.error} onRetry={() => void q.refetch()} />}
      {q.data && <MerchantCard m={q.data} />}
      {q.data && (
        <div className="mt-3">
          <DecideBox busy={d.busy} err={d.err} done={d.done} onDecide={(ok, reason) => void d.decide(id, ok, reason)} />
        </div>
      )}
    </Page>
  );
}

function MerchantCard({ m }: { m: MerchantDetail }) {
  const signedAt = m.agreement?.signed_at ?? m.agreement_signed_at ?? null;
  return (
    <div className="tb-grid-2 mt-3">
      <div className="tb-card">
        <h2 className="tb-h2">Business</h2>
        <dl className="tb-kv mt-3">
          <dt>Name</dt>
          <dd>{m.name}</dd>
          {m.email && (
            <>
              <dt>Owner</dt>
              <dd>{m.email}</dd>
            </>
          )}
          {m.phone && (
            <>
              <dt>Phone</dt>
              <dd>{m.phone}</dd>
            </>
          )}
          <dt>Status</dt>
          <dd>
            <StatusBadge status={m.status} />
          </dd>
          {m.country && (
            <>
              <dt>Country</dt>
              <dd>{m.country}</dd>
            </>
          )}
          {m.currency && (
            <>
              <dt>Currency</dt>
              <dd>{m.currency}</dd>
            </>
          )}
          {m.timezone && (
            <>
              <dt>Timezone</dt>
              <dd>{m.timezone}</dd>
            </>
          )}
          {m.address && (
            <>
              <dt>Address</dt>
              <dd>{m.address}</dd>
            </>
          )}
        </dl>
      </div>
      <div className="tb-card">
        <h2 className="tb-h2">Operations</h2>
        <dl className="tb-kv mt-3">
          {m.prep_minutes !== undefined && (
            <>
              <dt>Prep</dt>
              <dd>{m.prep_minutes} min</dd>
            </>
          )}
          {m.lat !== undefined && m.lng !== undefined && (
            <>
              <dt>Location</dt>
              <dd>
                {m.lat}, {m.lng}
              </dd>
            </>
          )}
          {m.pickup_note && (
            <>
              <dt>Pickup note</dt>
              <dd>{m.pickup_note}</dd>
            </>
          )}
          {signedAt && (
            <>
              <dt>Agreement</dt>
              <dd>
                signed {signedAt}
                {m.agreement?.signer_name ? ` by ${m.agreement.signer_name}` : ''}
                {m.agreement?.version ? ` (${m.agreement.version})` : ''}
              </dd>
            </>
          )}
        </dl>
        {m.opening_hours && (
          <>
            <h2 className="tb-h2 mt-4">Hours</h2>
            <dl className="tb-kv mt-3">
              {Object.entries(m.opening_hours).map(([day, hours]) => (
                <>
                  <dt key={`k-${day}`}>{day}</dt>
                  <dd key={`v-${day}`}>{hours}</dd>
                </>
              ))}
            </dl>
          </>
        )}
      </div>
      {m.staff !== undefined && (
        <div className="tb-card">
          <h2 className="tb-h2">Staff ({m.staff.length})</h2>
          {m.staff.length === 0 ? (
            <p className="tb-sub mt-3">No staff invited yet.</p>
          ) : (
            <dl className="tb-kv mt-3">
              {m.staff.map((s) => (
                <>
                  <dt key={`k-${s.id}`}>{s.email}</dt>
                  <dd key={`v-${s.id}`}>
                    {s.role} · {s.status}
                    {s.on_shift ? ' · on shift' : ''}
                    {s.can_deliver ? ' · can deliver' : ''}
                  </dd>
                </>
              ))}
            </dl>
          )}
        </div>
      )}
    </div>
  );
}
