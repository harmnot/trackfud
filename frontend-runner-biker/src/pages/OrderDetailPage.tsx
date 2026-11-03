/**
 * Courier order detail: one leg in full (`GET /courier/deliveries/{id}`,
 * openapi `getDelivery`). Partner-only like the list; the active leg still
 * hands over on `/delivery` — this page is the read-only record (payout,
 * measured workout, timeline, rating) for delivered and cancelled legs.
 */
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useParams } from 'react-router';
import { Button, Note, Page, Stat } from '../components/ui';
import {
  fetchDeliveryDetail,
  type DeliveryEnvelope,
} from '../features/delivery/courierApi';
import { ApiError } from '../lib/api';
import {
  formatDistance,
  formatDuration,
  formatMoney,
  formatSubmittedAt,
  resolveUnits,
} from '../lib/format';
import { logger } from '../lib/logger';
import i18n from '../i18n';

const FLOW = ['assigned', 'at_pickup', 'picked_up', 'at_dropoff', 'delivered'] as const;

function DetailSkeleton(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <div role="status" aria-label={t('common.loading')}>
      <div className="tb-skel" style={{ height: 34, width: '70%' }} />
      <div className="tb-skel mt-2" style={{ height: 16, width: '45%' }} />
      <div className="tb-card mt-3">
        <div className="tb-skel" style={{ height: 52 }} />
        <div className="tb-skel mt-2" style={{ height: 16, width: '80%' }} />
      </div>
      <div className="tb-card mt-3">
        <div className="tb-skel" style={{ height: 16, width: '40%' }} />
        <div className="tb-skel mt-2" style={{ height: 64 }} />
      </div>
    </div>
  );
}

export function OrderDetailPage(): React.JSX.Element {
  const { t } = useTranslation();
  const { id } = useParams();
  const lang = i18n.language;
  const locale = lang === 'id' ? 'id-ID' : lang === 'ms' ? 'ms-MY' : 'en-GB';
  const units = resolveUnits(locale);
  const [env, setEnv] = useState<DeliveryEnvelope | null>(null);
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);
  const [failed, setFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!id) {
      setMissing(true);
      setLoading(false);
      return;
    }
    setLoading(true);
    setFailed(false);
    setMissing(false);
    try {
      setEnv(await fetchDeliveryDetail({ deliveryId: id }));
    } catch (err) {
      logger.warn('order detail failed', err);
      if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
        setMissing(true);
      } else {
        setFailed(true);
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <Page>
        <DetailSkeleton />
      </Page>
    );
  }

  if (missing) {
    return (
      <Page>
        <h1 className="tb-display">{t('orders.detailMissing')}</h1>
        <div className="mt-3">
          <Note tone="info">{t('orders.detailMissingBody')}</Note>
        </div>
        <div className="mt-3">
          <Link to="/orders" className="tb-btn tb-btn-pine tb-btn-block">
            {t('orders.back')}
          </Link>
        </div>
      </Page>
    );
  }

  if (failed || !env) {
    return (
      <Page>
        <h1 className="tb-display">{t('orders.detailTitle')}</h1>
        <div className="mt-3 flex flex-col gap-2">
          <Note tone="error">{t('orders.errorDetail')}</Note>
          <Button variant="soft" block onClick={() => void load()}>
            {t('common.retry')}
          </Button>
          <Link to="/orders" className="tb-btn tb-btn-soft tb-btn-block">
            {t('orders.back')}
          </Link>
        </div>
      </Page>
    );
  }

  const d = env.delivery;
  const payoutMinor = env.payout?.amount_minor ?? 0;
  const currency = env.payout?.currency || d.currency || 'IDR';
  const isDelivered = d.status === 'delivered';
  const isCancelled = d.status === 'cancelled';
  const reached = FLOW.indexOf(
    (isDelivered || FLOW.includes(d.status as (typeof FLOW)[number])
      ? d.status
      : 'assigned') as (typeof FLOW)[number],
  );
  const steps = FLOW.map((key, i) => ({
    key,
    done: isDelivered || i <= reached,
    now: !isDelivered && !isCancelled && i === reached,
  }));

  return (
    <Page>
      <p className="tb-sub">
        <Link to="/orders" className="tb-back">
          ← {t('orders.back')}
        </Link>
      </p>
      <h1 className="tb-display">{d.pickup.merchant_name || t('orders.detailTitle')}</h1>
      <p className="tb-sub">
        #{d.order_id.slice(0, 8)}
        {' · '}
        {d.type === 'staff' ? t('orders.staff') : t('orders.workout')}
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <span className={`tb-order-status is-${isDelivered ? 'ok' : isCancelled ? 'muted' : 'live'}`}>
          {isDelivered
            ? t('orders.delivered')
            : isCancelled
              ? t('orders.cancelled')
              : t('orders.inProgress')}
        </span>
        <span className="tb-order-status is-soft">{d.size_class || '—'}</span>
      </div>

      <section className="tb-timer mt-3" aria-label={t('orders.payout')}>
        <p className="tb-run-hero">{formatMoney(payoutMinor, currency, locale)}</p>
        <p className="tb-sub">
          {isDelivered
            ? t('orders.paidOut')
            : isCancelled
              ? t('orders.noPayout')
              : t('orders.pendingPayout')}
        </p>
        <div className="tb-stats mt-3">
          <Stat
            value={formatDistance(env.impact?.distance_m ?? 0, { locale, units })}
            label={t('orders.distance')}
          />
          <Stat
            value={formatDuration(env.impact?.active_s ?? 0)}
            label={t('orders.active')}
          />
          <Stat
            value={typeof d.eta_s === 'number' && d.eta_s > 0 ? formatDuration(d.eta_s) : '—'}
            label={t('orders.eta')}
          />
        </div>
      </section>

      <section className="tb-card mt-3" aria-label={t('orders.timeline')}>
        <p className="text-sm font-bold">{t('orders.timeline')}</p>
        <ol className="tb-timeline mt-2">
          {steps.map((s) => (
            <li
              key={s.key}
              className={`tb-timeline-step${s.done ? ' done' : ''}${s.now ? ' now' : ''}`}
              aria-current={s.now ? 'step' : undefined}
            >
              <span className="tb-timeline-dot" aria-hidden="true" />
              <span>{t(`orders.step_${s.key}`)}</span>
            </li>
          ))}
          {isCancelled && (
            <li className="tb-timeline-step now">
              <span className="tb-timeline-dot" aria-hidden="true" />
              <span>{t('orders.step_cancelled')}</span>
            </li>
          )}
        </ol>
        {d.ready_at_est && (
          <p className="tb-sub mt-2">
            {t('orders.readyAt', { when: formatSubmittedAt(d.ready_at_est) })}
          </p>
        )}
      </section>

      {(d.pickup.note || d.pickup.address) && (
        <section className="tb-card mt-3" aria-label={t('orders.pickup')}>
          <p className="text-sm font-bold">{t('orders.pickup')}</p>
          {d.pickup.address && <p className="tb-sub mt-1">{d.pickup.address}</p>}
          {d.pickup.note && <p className="tb-sub mt-1">{d.pickup.note}</p>}
        </section>
      )}

      {d.route_warning && (
        <p className="tb-sub mt-3">{d.route_warning}</p>
      )}

      <div className="mt-3">
        <Link to="/orders" className="tb-btn tb-btn-soft tb-btn-block">
          {t('orders.back')}
        </Link>
      </div>
    </Page>
  );
}
