/** Courier profile + history card (mode, rating, deliveries, km, 8-week chart).
 * Fed by `delivery.courier` on the order detail endpoint. The card follows
 * the order status, never the assignment alone: a searching state only while
 * dispatch can still assign, an honest terminal note when the order was
 * cancelled or rejected with no courier, and nothing at all once a
 * delivered/completed order has no courier to show. Copy addresses the
 * courier as runner, biker, or staff — never "runner" for everyone. */

import { useTranslation } from 'react-i18next';
import { Button, Skeleton } from '../../components/ui';
import type { CourierInfo, OrderStatus } from '../orders/types';

const BAR_W = 22;
const BAR_GAP = 8;
const CHART_H = 64;

/** Weekly activity bars (active minutes or km per week, scaled to max). */
function WeeksChart(args: { weeks: number[]; label: string }) {
  const max = Math.max(...args.weeks, 1);
  const width = args.weeks.length * (BAR_W + BAR_GAP);
  return (
    <svg viewBox={`0 0 ${width} ${CHART_H + 18}`} width={width} role="img" aria-label={args.label}>
      {args.weeks.map((v, i) => {
        const h = Math.max(3, (v / max) * CHART_H);
        return (
          <rect
            key={i}
            x={i * (BAR_W + BAR_GAP)}
            y={CHART_H - h}
            width={BAR_W}
            height={h}
            rx={5}
            className={i === args.weeks.length - 1 ? 'tb-chart-bar-now' : 'tb-chart-bar'}
          />
        );
      })}
      <text x={0} y={CHART_H + 14} className="tb-chart-cap">8 {args.label}</text>
    </svg>
  );
}

/** Courier card that tracks the order lifecycle, not just the assignment. */
export function CourierCard(args: {
  courier: CourierInfo | null;
  unit: 'km' | 'mi';
  status: OrderStatus;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  if (args.courier) {
    return <ProfileCard courier={args.courier} unit={args.unit} title={t('track.courierTitle')} />;
  }
  if (args.loading) {
    return (
      <section className="tb-courier" aria-label={t('track.courierTitle')} aria-busy="true">
        <div className="tb-courier-body">
          <Skeleton height={76} />
          <p className="tb-sub mt-2">{t('common.loading')}</p>
        </div>
      </section>
    );
  }
  if (args.error) {
    return (
      <section className="tb-courier" aria-label={t('track.courierTitle')} aria-live="polite">
        <span className="tb-courier-avatar" aria-hidden="true">!</span>
        <div className="tb-courier-body">
          <p className="tb-courier-name">{t('common.error')}</p>
          <p className="tb-sub">{args.error}</p>
          <p className="mt-2">
            <Button variant="soft" size="sm" onClick={args.onRetry}>{t('common.retry')}</Button>
          </p>
        </div>
      </section>
    );
  }
  if (args.status === 'cancelled') {
    return (
      <section className="tb-courier" aria-label={t('track.courierTitle')} aria-live="polite">
        <span className="tb-courier-avatar" aria-hidden="true">×</span>
        <div>
          <p className="tb-courier-name">{t(`track.s_${args.status}`)}</p>
          <p className="tb-sub">{t('track.courierNoneCancelled')}</p>
        </div>
      </section>
    );
  }
  if (args.status === 'rejected') {
    return (
      <section className="tb-courier" aria-label={t('track.courierTitle')} aria-live="polite">
        <span className="tb-courier-avatar" aria-hidden="true">×</span>
        <div>
          <p className="tb-courier-name">{t(`track.s_${args.status}`)}</p>
          <p className="tb-sub">{t('track.courierNoneRejected')}</p>
        </div>
      </section>
    );
  }
  if (args.status === 'delivered' || args.status === 'completed') return null;
  return (
    <section className="tb-courier" aria-label={t('track.courierTitle')} aria-live="polite">
      <span className="tb-courier-avatar" aria-hidden="true">…</span>
      <div className="tb-courier-body">
        <p className="tb-courier-name">{t('track.searching')}</p>
        <p className="tb-sub">{t('track.searchingSub')}</p>
        <p className="mt-2">
          <Button variant="soft" size="sm" onClick={args.onRetry}>{t('common.retry')}</Button>
        </p>
      </div>
    </section>
  );
}

/** Assigned courier profile with lifetime history. */
function ProfileCard(args: { courier: CourierInfo; unit: 'km' | 'mi'; title: string }) {
  const { t } = useTranslation();
  const c = args.courier;
  const dist = args.unit === 'mi' ? c.lifetime_km / 1.60934 : c.lifetime_km;
  const modeLabel = c.mode === 'runner' ? t('track.runner') : c.mode === 'biker' ? t('track.biker') : t('track.staff');
  return (
    <section className="tb-courier" aria-label={args.title}>
      {c.photo_url
        ? <img className="tb-courier-avatar" src={c.photo_url} alt="" />
        : <span className="tb-courier-avatar" aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>}
      <div className="tb-courier-body">
        <p className="tb-courier-name">{c.name} · {modeLabel}</p>
        <p className="tb-courier-stats">
          ★ {c.rating.toFixed(1)} · {c.deliveries} {t('track.deliveries')} · {dist.toFixed(0)} {args.unit}
        </p>
        <WeeksChart weeks={c.weeks} label={t('track.weeks')} />
      </div>
    </section>
  );
}
