import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router';
import { ApiError, api } from '../../lib/api';
import { formatValue } from '../../lib/format';
import type { MerchantDetail as MerchantDetailType, Sanction } from '../../lib/types';
import { Note, Page, StatusBadge } from '../../components/ui';
import { DecideBox, DecideGated } from './DecisionCard';
import { AddressBlock, AgreementBlock, EmailLink, HoursList, IdValue, LocationValue, PhoneLink, ReviewOutcome, StaffList } from './fields';
import { SanctionBox } from './SanctionCard';
import { detailRetry } from './review';
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

/** Fetch one merchant record, validating the envelope before returning it. */
async function fetchMerchant(id: string): Promise<MerchantDetailType> {
  const d = await api<{ merchant: MerchantDetailType }>(`/admin/merchants/${id}`);
  if (!d || typeof d.merchant !== 'object' || d.merchant === null) {
    throw new ApiError('Merchant not found.', 404);
  }
  return d.merchant;
}

/** Fetch the merchant ban/unban history (empty when none recorded yet). */
async function fetchMerchantSanctions(id: string): Promise<Sanction[]> {
  const d = await api<{ sanctions: Sanction[] }>(`/admin/merchants/${id}/sanctions`);
  return Array.isArray(d.sanctions) ? d.sanctions : [];
}

/** Merchant detail: business record + agreement + staff + decision + ban/unban. */
export function MerchantDetail() {
  const { id = '' } = useParams();
  const q = useQuery({
    queryKey: ['admin', 'merchant', id],
    queryFn: () => fetchMerchant(id),
    enabled: id !== '',
    retry: detailRetry,
  });
  const sanctions = useQuery({
    queryKey: ['admin', 'merchant-sanctions', id],
    queryFn: () => fetchMerchantSanctions(id),
    enabled: id !== '' && q.data !== undefined,
    retry: detailRetry,
  });
  const d = useDecide(['admin'], (mid, ok) => `/admin/merchants/${mid}/${ok ? 'approve' : 'reject'}`);
  const s = useSanction('merchant', (mid) => `/admin/merchants/${mid}/sanctions`);

  // Approve + Reject render only for a submitted merchant with a signed
  // agreement (status pending + agreement signed). Approved / rejected /
  // banned hide the card: rejected shows its reason + updated_at instead.
  // A pending merchant without the signed agreement shows the gated
  // placeholder (disabled buttons + the "signed agreement" blocker note).
  const agreementSigned = q.data?.agreement?.signed === true || q.data?.agreement?.agreed === true;
  const canDecide = q.data?.status === 'pending' && agreementSigned;
  const pendingUnsigned = q.data?.status === 'pending' && !agreementSigned;
  const showOutcome = q.data?.status === 'rejected' || q.data?.status === 'approved';
  const sanctionable = q.data !== undefined && q.data !== null && q.data.status !== 'draft';

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
      {showOutcome && q.data && (
        <ReviewOutcome
          status={q.data.status}
          reason={q.data.reject_reason ?? ''}
          updatedAt={q.data.updated_at ?? null}
          approvedAt={q.data.agreement?.signed_at ?? q.data.updated_at ?? null}
        />
      )}
      {canDecide && (
        <div className="mt-3">
          <DecideBox
            busy={d.busy}
            err={d.err}
            done={d.done}
            onDecide={(ok, reason) => void d.decide(id, ok, reason)}
          />
        </div>
      )}
      {pendingUnsigned && (
        <div className="mt-3">
          <DecideGated message="Approve and Reject stay hidden until the merchant submits the signed agreement." />
        </div>
      )}
      {sanctionable && (
        <div className="mt-3">
          <SanctionBox
            kinds={q.data?.status === 'banned' ? ['unban'] : ['ban']}
            history={sanctions.data ?? []}
            busy={s.busy}
            err={sanctions.isError ? 'Could not load sanction history.' : s.err}
            done={s.done}
            showEndsAt={false}
            onSanction={(input) => void s.sanction(id, input)}
          />
        </div>
      )}
    </Page>
  );
}

function MerchantCard({ m }: { m: MerchantDetailType }) {
  const hours = m.opening_hours ?? {};
  const hasCoords = typeof m.lat === 'number' && typeof m.lng === 'number';
  return (
    <div className="tb-grid-2 mt-3">
      <div className="tb-card">
        <h2 className="tb-h2">Business</h2>
        <dl className="tb-kv mt-3">
          <div className="tb-kv-row">
            <dt>ID</dt>
            <dd>
              <IdValue id={m.id} label="merchant ID" />
            </dd>
          </div>
          <div className="tb-kv-row">
            <dt>Name</dt>
            <dd>{formatValue(m.name)}</dd>
          </div>
          {m.owner_id && (
            <div className="tb-kv-row">
              <dt>Owner ID</dt>
              <dd>
                <IdValue id={m.owner_id} label="owner ID" />
              </dd>
            </div>
          )}
          {m.email && (
            <div className="tb-kv-row">
              <dt>Owner</dt>
              <dd>
                <EmailLink email={m.email} />
              </dd>
            </div>
          )}
          {m.phone && (
            <div className="tb-kv-row">
              <dt>Phone</dt>
              <dd>
                <PhoneLink phone={m.phone} />
              </dd>
            </div>
          )}
          <div className="tb-kv-row">
            <dt>Status</dt>
            <dd>
              <StatusBadge status={m.status} />
            </dd>
          </div>
          {m.country && (
            <div className="tb-kv-row">
              <dt>Country</dt>
              <dd>{formatValue(m.country)}</dd>
            </div>
          )}
          {m.currency && (
            <div className="tb-kv-row">
              <dt>Currency</dt>
              <dd>{formatValue(m.currency)}</dd>
            </div>
          )}
          {m.timezone && (
            <div className="tb-kv-row">
              <dt>Timezone</dt>
              <dd>{formatValue(m.timezone)}</dd>
            </div>
          )}
          {m.address && (
            <div className="tb-kv-row">
              <dt>Address</dt>
              <dd>
                <AddressBlock value={m.address} />
              </dd>
            </div>
          )}
          {m.created_at && (
            <div className="tb-kv-row">
              <dt>Created</dt>
              <dd>{formatValue(m.created_at)}</dd>
            </div>
          )}
          {m.updated_at && (
            <div className="tb-kv-row">
              <dt>Updated</dt>
              <dd>{formatValue(m.updated_at)}</dd>
            </div>
          )}
        </dl>
      </div>
      <div className="tb-card">
        <h2 className="tb-h2">Operations</h2>
        <dl className="tb-kv mt-3">
          {m.prep_minutes !== undefined && (
            <div className="tb-kv-row">
              <dt>Prep</dt>
              <dd>{formatValue(m.prep_minutes)} min</dd>
            </div>
          )}
          {hasCoords && (
            <div className="tb-kv-row">
              <dt>Location</dt>
              <dd>
                <LocationValue lat={m.lat as number} lng={m.lng as number} />
              </dd>
            </div>
          )}
          {m.pickup_note && (
            <div className="tb-kv-row">
              <dt>Pickup note</dt>
              <dd>{formatValue(m.pickup_note)}</dd>
            </div>
          )}
          {m.agreement && (
            <div className="tb-kv-row">
              <dt>Agreement</dt>
              <dd>
                <AgreementBlock agreement={m.agreement} />
              </dd>
            </div>
          )}
        </dl>
        {Object.keys(hours).length > 0 && (
          <>
            <h2 className="tb-h2 mt-4">Hours</h2>
            <HoursList hours={hours} />
          </>
        )}
      </div>
      {m.staff !== undefined && (
        <div className="tb-card">
          <h2 className="tb-h2">Staff ({m.staff.length})</h2>
          <StaffList staff={m.staff} />
        </div>
      )}
    </div>
  );
}
