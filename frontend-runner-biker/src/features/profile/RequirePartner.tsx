/**
 * Partner-only route guard: Chat, Ratings and payout-gated screens render
 * only for approved partners (or clocked-in staff). Everyone else is sent
 * back to run-setup with an honest notice. Auth itself is still enforced by
 * RequireAuth wrapped outside this guard.
 */
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Note, Page } from '../../components/ui';
import { usePartner } from './usePartner';

export function RequirePartner({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useTranslation();
  const { unlocked, isLoading } = usePartner();

  if (isLoading) {
    return (
      <Page>
        <div className="tb-skel" style={{ height: 120 }} role="status" aria-label={t('common.loading')} />
      </Page>
    );
  }
  if (!unlocked) {
    return (
      <Page>
        <h1 className="tb-display">{t('account.partnerTitle')}</h1>
        <div className="mt-3">
          <Note tone="info">{t('account.deliveryLocked')}</Note>
        </div>
        <p className="tb-sub mt-3">{t('account.partnerBody')}</p>
        <div className="mt-3 flex flex-col gap-2">
          <Link to="/onboarding" className="tb-btn tb-btn-pine tb-btn-block">
            {t('account.becomePartner')}
          </Link>
          <Link to="/run-setup" className="tb-btn tb-btn-soft tb-btn-block">
            {t('account.startTracking')}
          </Link>
        </div>
      </Page>
    );
  }
  return <>{children}</>;
}
