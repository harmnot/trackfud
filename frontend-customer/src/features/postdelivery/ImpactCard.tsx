/** Impact card ("You powered X km · Y active min") + the my-impact page.
 * Measured courier-GPS totals come from `GET /v1/customer/impact`; the
 * haversine estimate is the offline fallback for a single order only. */

import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { api } from '../../lib/api';
import { formatDistance, unitFor } from '../../lib/format';
import { Note, Page, Skeleton } from '../../components/ui';
import i18n from '../../i18n';
import type { Order } from '../orders/types';
import { estimateImpact } from './api';
import { useImpact } from './hooks';
import type { ImpactRecent } from './types';

type Shop = { lat: number; lng: number };

function impactText(args: { km: number; min: number; t: (k: string) => string }): string {
  return args.t('impact.powered').replace('{km}', String(args.km)).replace('{min}', String(args.min));
}

function measuredKm(recent: ImpactRecent): number {
  return Math.round((recent.distanceM / 1000) * 10) / 10;
}

function measuredMin(recent: ImpactRecent): number {
  return Math.max(1, Math.round(recent.activeS / 60));
}

/** Impact card for one delivered order: measured when the server has it. */
export function ImpactCard(args: { order: Order }) {
  const { t } = useTranslation();
  const impact = useImpact();
  const recent = impact.data?.recent.find((r) => r.orderCode === args.order.code) ?? null;
  if (impact.isLoading) {
    return <div className="mt-3"><Skeleton height={110} /></div>;
  }
  if (recent) {
    return (
      <section className="tb-impact mt-3" aria-label={t('impact.title')}>
        <p className="tb-h2">{t('impact.title')}</p>
        <p className="tb-impact-line" aria-live="polite">
          {impactText({ km: measuredKm(recent), min: measuredMin(recent), t })}
        </p>
        <p className="tb-sub">
          {formatDistance(recent.distanceM, i18n.language)} · {t('impact.measuredNote')}
        </p>
        <p className="mt-2">
          <Link to="/impact" className="tb-btn tb-btn-soft tb-btn-sm">{t('impact.seeMine')}</Link>
        </p>
      </section>
    );
  }
  return <ImpactEstimate order={args.order} />;
}

function ImpactEstimate(args: { order: Order }) {
  const { t } = useTranslation();
  const shopQuery = useShopLoc(args.order.merchant_id);
  if (shopQuery.isLoading) {
    return <div className="mt-3"><Skeleton height={110} /></div>;
  }
  if (shopQuery.isError || !shopQuery.data || !args.order.dropoff) {
    return (
      <div className="mt-3">
        <Note tone="error">{t('impact.unavailable')}</Note>
      </div>
    );
  }
  const est = estimateImpact({
    orderId: args.order.id,
    pickup: { lat: shopQuery.data.lat, lng: shopQuery.data.lng },
    dropoff: args.order.dropoff,
  });
  return (
    <section className="tb-impact mt-3" aria-label={t('impact.title')}>
      <p className="tb-h2">{t('impact.title')}</p>
      <p className="tb-impact-line" aria-live="polite">
        {impactText({ km: est.distanceKm, min: est.activeMin, t })}
      </p>
      <p className="tb-sub">
        {formatDistance(est.distanceKm * 1000, i18n.language)} · {t('impact.estimateNote')}
      </p>
      <p className="mt-2">
        <Link to="/impact" className="tb-btn tb-btn-soft tb-btn-sm">{t('impact.seeMine')}</Link>
      </p>
    </section>
  );
}

function useShopLoc(merchantId: string | null) {
  return useQuery({
    queryKey: ['shop-loc', merchantId],
    queryFn: () => api<Shop>(`/customer/restaurants/${merchantId}`),
    enabled: merchantId !== null,
    staleTime: 10 * 60 * 1000,
  });
}

/** My-impact page: measured totals across every delivered order. */
export function ImpactPage() {
  const { t } = useTranslation();
  const impact = useImpact();
  const unit = unitFor(i18n.language);

  if (impact.isLoading) {
    return (
      <Page>
        <h1 className="tb-display">{t('impact.mine')}</h1>
        <div className="flex flex-col gap-2 mt-3"><Skeleton height={110} /><Skeleton height={80} /></div>
      </Page>
    );
  }
  if (impact.isError || !impact.data) {
    return (
      <Page>
        <h1 className="tb-display">{t('impact.mine')}</h1>
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('common.error')}: {(impact.error as Error).message}</Note>
          <Link to="/impact" onClick={(e) => { e.preventDefault(); void impact.refetch(); }} className="tb-btn tb-btn-soft tb-btn-sm">
            {t('common.retry')}
          </Link>
        </div>
      </Page>
    );
  }
  const data = impact.data;
  if (data.ordersDelivered === 0) {
    return (
      <Page>
        <h1 className="tb-display">{t('impact.mine')}</h1>
        <p className="tb-sub mt-2">{t('impact.empty')}</p>
        <p className="mt-3"><Link to="/" className="tb-btn tb-btn-ember tb-btn-sm">{t('nav.home')}</Link></p>
      </Page>
    );
  }
  const showKm = unit === 'mi' ? data.distanceM / 1609.34 : data.distanceM / 1000;
  const rounded = Math.round(showKm * 10) / 10;
  const min = Math.round(data.activeS / 60);
  return (
    <Page>
      <h1 className="tb-display">{t('impact.mine')}</h1>
      <p className="tb-sub">{t('impact.supporterLine')}</p>
      <div className="mt-3 flex flex-col gap-3">
        <section className="tb-impact" aria-label={t('impact.title')}>
          <p className="tb-impact-line" aria-live="polite">
            {impactText({ km: rounded, min, t })}
          </p>
          <p className="tb-sub">{t('impact.measuredNote')}</p>
        </section>
        <div className="tb-stats">
          <div className="tb-stat"><strong>{rounded}</strong><span>{unit}</span></div>
          <div className="tb-stat"><strong>{min}</strong><span>{t('impact.activeMin')}</span></div>
          <div className="tb-stat"><strong>{data.couriersSupported}</strong><span>{t('impact.couriers')}</span></div>
        </div>
        {data.recent.length > 0 && (
          <section aria-label={t('impact.recent')}>
            <h2 className="tb-h2">{t('impact.recent')}</h2>
            <div className="flex flex-col gap-2 mt-2">
              {data.recent.map((r) => (
                <div className="tb-line-row" key={r.orderCode}>
                  <span className="flex-1 min-w-0">
                    <strong className="block truncate">{r.orderCode}{r.courierFirstName === '' ? '' : ` · ${r.courierFirstName}`}</strong>
                    <span className="tb-price">{formatDistance(r.distanceM, i18n.language)} · {Math.max(1, Math.round(r.activeS / 60))} {t('impact.activeMin')}</span>
                  </span>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>
    </Page>
  );
}
