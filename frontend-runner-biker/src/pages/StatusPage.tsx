/**
 * Stride & Earn account (`/status`, served under `/courier/status`):
 * personal data for every runner/biker plus the partner journey.
 * Ordinary accounts track for free; becoming a partner unlocks
 * deliveries and earnings after the fitness test + CMS review.
 * All data comes from the API — nothing is invented on the client.
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { Badge, Button, Note, Page, Stat } from '../components/ui';
import { img } from '../components/ui';
import { savedUser, setSession } from '../lib/api';
import {
  fetchApplication,
  fetchMe,
  fetchProfile,
  formatAddress,
  partnerStateOf,
} from '../features/profile/profileApi';

export function StatusPage(): React.JSX.Element {
  const { t } = useTranslation();
  const user = savedUser();

  const meQ = useQuery({ queryKey: ['account-me'], queryFn: fetchMe, enabled: Boolean(user) });
  const profileQ = useQuery({ queryKey: ['account-profile'], queryFn: fetchProfile, enabled: Boolean(user) });
  const appQ = useQuery({ queryKey: ['account-application'], queryFn: fetchApplication, enabled: Boolean(user) });

  if (!user) {
    return (
      <Page>
        <h1 className="tb-display">{t('account.title')}</h1>
        <div className="tb-card mt-3">
          <p className="font-bold">{t('account.partnerTitle')}</p>
          <p className="tb-sub mt-1">{t('account.partnerBody')}</p>
          <div className="mt-3 flex flex-col gap-2">
            <Link to="/login" className="tb-btn tb-btn-pine tb-btn-block">{t('auth.login')}</Link>
            <Link to="/signup" className="tb-btn tb-btn-soft tb-btn-block">{t('auth.signup')}</Link>
          </div>
        </div>
      </Page>
    );
  }

  const loading = meQ.isLoading || profileQ.isLoading || appQ.isLoading;
  const failed = meQ.isError && profileQ.isError && appQ.isError;
  const me = meQ.data;
  const profile = profileQ.data?.profile;
  const app = appQ.data;
  const partner = partnerStateOf(app?.status);
  const mode = app?.mode ?? profileQ.data?.mode ?? 'runner';
  const address = formatAddress(profile?.address);
  const displayName = (me?.name || profile?.legal_name || '').trim();
  const displayPhone = (me?.phone || profile?.phone || '').trim();

  return (
    <Page>
      <h1 className="tb-display">{t('account.title')}</h1>

      <div className="tb-hero mt-3" style={{ minHeight: 140 }}>
        <img src={img('mode-bike.jpg')} alt="" />
        <div className="tb-hero-body">
          <span className="tb-kicker">{app?.status ?? '…'}</span>
          <p className="tb-hero-title" style={{ fontSize: '1.3rem' }}>
            {mode === 'biker' ? t('status.bikerLabel') : t('status.runnerLabel')}
          </p>
          <p className="tb-hero-sub">{t('app.tagline')}</p>
        </div>
      </div>

      {loading && <div className="tb-skel mt-3" style={{ height: 120 }} aria-label={t('common.loading')} />}

      {failed && (
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('common.error')}</Note>
          <Button
            variant="soft"
            block
            onClick={() => {
              void meQ.refetch();
              void profileQ.refetch();
              void appQ.refetch();
            }}
          >
            {t('common.retry')}
          </Button>
        </div>
      )}

      {!loading && !failed && (
        <>
          <section className="tb-card mt-3" aria-label={t('account.personal')}>
            <p className="text-sm font-bold">{t('account.personal')}</p>
            <dl className="mt-2 flex flex-col gap-2">
              <div>
                <dt className="tb-label">{t('account.name')}</dt>
                <dd className="font-bold">{displayName || t('account.notSet')}</dd>
              </div>
              <div>
                <dt className="tb-label">{t('account.email')}</dt>
                <dd className="font-bold">{me?.email || user.email}</dd>
              </div>
              <div>
                <dt className="tb-label">{t('account.phone')}</dt>
                <dd className="font-bold">{displayPhone || t('account.notSet')}</dd>
              </div>
              <div>
                <dt className="tb-label">{t('account.address')}</dt>
                <dd className="font-bold">{address || t('account.notSet')}</dd>
              </div>
            </dl>
            <p className="tb-sub mt-2">{mode === 'biker' ? t('account.modeBiker') : t('account.modeRunner')}</p>
          </section>

          {app && app.status !== 'none' && (
            <div className="tb-stats mt-3">
              <Stat value={app.fitness?.passed ? '✓' : '—'} label="Fitness" />
              <Stat value={mode === 'biker' ? '5k' : '2k'} label="Test" />
              <Stat value={app.status === 'approved' ? '✓' : '…'} label="Approved" />
            </div>
          )}

          <section className="tb-card mt-3" aria-label={t('account.partnerTitle')}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-bold">{t('account.partnerTitle')}</p>
              {partner === 'approved' && <Badge>{t('status.title')}</Badge>}
            </div>
            <p className="tb-sub mt-1">{t('account.partnerBody')}</p>

            {partner === 'none' && (
              <>
                <div className="mt-2"><Note tone="info">{t('status.none')}</Note></div>
                <div className="mt-3 flex flex-col gap-2">
                  <Link to="/onboarding" className="tb-btn tb-btn-pine tb-btn-block">{t('account.becomePartner')}</Link>
                  <Link to="/run-setup" className="tb-btn tb-btn-soft tb-btn-block">{t('account.startTracking')}</Link>
                </div>
              </>
            )}

            {partner === 'draft' && (
              <div className="mt-3 flex flex-col gap-2">
                <Link to="/onboarding" className="tb-btn tb-btn-pine tb-btn-block">{t('account.continuePartner')}</Link>
                <Link to="/fitness" className="tb-btn tb-btn-soft tb-btn-block">{t('account.fitnessCta')}</Link>
                <Link to="/run-setup" className="tb-btn tb-btn-soft tb-btn-block">{t('account.startTracking')}</Link>
              </div>
            )}

            {partner === 'pending' && (
              <div className="mt-3 flex flex-col gap-2">
                <Note tone="info">{t('account.partnerPending')}</Note>
                <Link to="/run-setup" className="tb-btn tb-btn-soft tb-btn-block">{t('account.startTracking')}</Link>
              </div>
            )}

            {partner === 'approved' && (
              <div className="mt-3 flex flex-col gap-2">
                <Note tone="info">{t('account.partnerApproved')}</Note>
                <Link to="/delivery" className="tb-btn tb-btn-pine tb-btn-block">{t('nav.delivery')}</Link>
                <Link to="/wallet" className="tb-btn tb-btn-soft tb-btn-block">{t('account.walletCta')}</Link>
              </div>
            )}

            {partner === 'rejected' && (
              <div className="mt-3 flex flex-col gap-2">
                <Note tone="error">{t('account.partnerRejected')}</Note>
                {app?.reject_reason && <Note tone="error">{app.reject_reason}</Note>}
                <Link to="/onboarding" className="tb-btn tb-btn-pine tb-btn-block">{t('account.becomePartner')}</Link>
              </div>
            )}
          </section>

          {partner !== 'approved' && (
            <div className="mt-3"><Note tone="info">{t('account.deliveryLocked')}</Note></div>
          )}
        </>
      )}

      <div className="mt-3">
        <Button
          variant="danger"
          block
          onClick={() => {
            setSession(null);
            location.href = '/courier/login';
          }}
        >
          {t('auth.logout')}
        </Button>
      </div>
    </Page>
  );
}
