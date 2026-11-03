/** Partner Agreement e-sign page: versioned text, typed name + tick, single submit.
 *
 * Flow: fetch current text + own signature status. When already signed, the
 * form locks (button disabled, banner shows signer + date/time) so the
 * merchant can never double-submit. The POST is idempotent server-side
 * (same version returns the original row), and the button disables while
 * signing. After review the button tracks the merchant status:
 * "Signed ✓ — pending approval" → "— approved" / "— rejected", refreshed
 * live over the merchant socket (plus a 30 s poll fallback) so the decision
 * email/push is mirrored on screen. Layout is single-column, block buttons,
 * wrapping text — friendly on phones and wider on tablet/desktop via the
 * shared tb-shell.
 */
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { Button, Check, Field, Note, Page, Steps, TextInput } from '../../components/ui';
import { img } from '../../components/ui';
import { merchantSocket, type MerchantMsg } from '../orders/socket';
import {
  fetchAgreementText,
  fetchMyAgreement,
  formatSignedAt,
  signAgreement,
} from './agreementApi';

type ReviewState = 'pending' | 'approved' | 'rejected' | '';

/** Narrow the backend merchant status to the three review states (draft/unknown → ''). */
function toReviewState(status: unknown): ReviewState {
  return status === 'pending' || status === 'approved' || status === 'rejected' ? status : '';
}

export default function AgreementPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const text = useQuery({ queryKey: ['agreement-text'], queryFn: fetchAgreementText });
  const status = useQuery({
    queryKey: ['agreement-status'],
    queryFn: fetchMyAgreement,
    // Poll lightly so an admin decision made in another tab still lands
    // here even when the socket drops; the socket (below) is the live path.
    refetchInterval: 30_000,
  });

  const [signer, setSigner] = useState('');
  const [tick, setTick] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [fresh, setFresh] = useState('');

  const already = status.data?.agreement?.signed === true;
  const signedAt = status.data?.agreement?.signed_at ?? '';
  const signedBy = status.data?.agreement?.signer_name ?? '';
  const review = toReviewState(
    status.data?.agreement?.merchant_status ?? status.data?.merchant_status,
  );
  const canSubmit = tick && signer.trim() !== '' && !busy && !already;

  // Live review updates: the backend broadcasts
  // {"type":"merchant.status","status":"approved"|...} on decide (the same
  // transaction also queues the decision email + push), so refetch here and
  // surface a notice — the on-screen mirror of that notification.
  useEffect(() => {
    void merchantSocket.connect();
    const off = merchantSocket.onMessage((m: MerchantMsg) => {
      if (m.type === 'merchant.status') {
        void qc.invalidateQueries({ queryKey: ['agreement-status'] });
        setFresh(m.status);
      }
    });
    return () => {
      off();
    };
  }, [qc]);

  async function sign() {
    if (!canSubmit) return;
    setErr('');
    setMsg('');
    setBusy(true);
    try {
      const res = await signAgreement({
        signerName: signer.trim(),
        agreed: tick,
        version: text.data?.version,
      });
      setMsg(res.duplicate ? t('agree.already', { defaultValue: 'Already submitted ✓' }) : t('agree.done'));
      await qc.invalidateQueries({ queryKey: ['agreement-status'] });
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  const signedLabel =
    review === 'approved'
      ? t('agree.signedApproved', { defaultValue: 'Signed ✓ — approved' })
      : review === 'rejected'
        ? t('agree.signedRejected', { defaultValue: 'Signed ✓ — rejected' })
        : t('agree.signed', { defaultValue: 'Signed ✓ — pending approval' });

  return (
    <Page>
      <h1 className="tb-display">{t('agree.title')}</h1>
      <p className="tb-sub">{t('agree.sub', { defaultValue: 'A fair partnership, in plain words.' })}</p>
      <Steps total={3} done={2} labels={['Store', 'Agreement', 'Staff']} />

      <div className="tb-hero mt-3" style={{ minHeight: 130 }}>
        <img src={img('hero-chef.jpg')} alt="" />
        <div className="tb-hero-body">
          <span className="tb-kicker">{text.data?.version ?? 'v1'}</span>
          <p className="tb-hero-title" style={{ fontSize: '1.3rem' }}>
            {t('agree.hero', { defaultValue: 'Partners, not just vendors' })}
          </p>
        </div>
      </div>

      {already && review !== 'approved' && review !== 'rejected' && (
        <div className="mt-3" role="status" aria-live="polite">
          <Note tone="info">
            {t('agree.submitted', {
              defaultValue: 'Already submitted by {{name}} on {{date}} — waiting for approval.',
              name: signedBy,
              date: signedAt ? formatSignedAt(signedAt) : '',
            })}
          </Note>
        </div>
      )}

      {already && review === 'approved' && (
        <div className="mt-3" role="status" aria-live="polite">
          <Note tone="info">
            {t('agree.submittedApproved', {
              defaultValue: 'Submitted by {{name}} on {{date}} — approved. Welcome aboard!',
              name: signedBy,
              date: signedAt ? formatSignedAt(signedAt) : '',
            })}
          </Note>
        </div>
      )}

      {already && review === 'rejected' && (
        <div className="mt-3" role="alert">
          <Note tone="error">
            {t('agree.submittedRejected', {
              defaultValue: 'Submitted by {{name}} on {{date}} — not approved. Check your email for the reason; update your store profile and sign again.',
              name: signedBy,
              date: signedAt ? formatSignedAt(signedAt) : '',
            })}
          </Note>
        </div>
      )}

      {fresh !== '' && already && (
        <div className="mt-3" role="status" aria-live="polite">
          <Note tone="info">
            {t('agree.updated', {
              defaultValue: 'Status update: {{s}}. The review team also emailed you.',
              s: fresh,
            })}
          </Note>
        </div>
      )}

      {text.isLoading ? (
        <div className="tb-skel mt-3" style={{ height: 200 }} />
      ) : text.isError ? (
        <div className="mt-3">
          <Note tone="error">
            {text.error instanceof Error ? text.error.message : t('common.error')}{' '}
            <button type="button" className="tb-link" onClick={() => void text.refetch()}>
              {t('common.retry', { defaultValue: 'Retry' })}
            </button>
          </Note>
        </div>
      ) : (
        <pre className="tb-doc mt-3">{text.data?.text ?? ''}</pre>
      )}

      <div className="flex flex-col gap-3 mt-3">
        <Field label={t('agree.signer')}>
          <TextInput
            value={signer}
            onChange={setSigner}
            placeholder={t('agree.signerPh', { defaultValue: 'e.g. Budi Santoso' })}
            autoComplete="name"
            disabled={already || busy}
            aria-label={t('agree.signer')}
          />
        </Field>
        <Check checked={tick} onChange={setTick} label={t('agree.tick')} />
        <Button block disabled={!canSubmit} onClick={() => void sign()}>
          {busy
            ? t('agree.signing', { defaultValue: 'Signing…' })
            : already
              ? signedLabel
              : t('agree.sign')}
        </Button>
        {msg && <Note tone="info">{msg}</Note>}
        {err && <Note tone="error">{err}</Note>}
        {status.isError && (
          <Note tone="error">
            {status.error instanceof Error ? status.error.message : t('common.error')}
          </Note>
        )}
      </div>
    </Page>
  );
}
