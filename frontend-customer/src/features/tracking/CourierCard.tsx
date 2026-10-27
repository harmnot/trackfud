/** Courier profile + history card (mode, rating, deliveries, km, 8-week chart).
 * Fed by `delivery.courier` on the order detail endpoint; renders a
 * searching state until dispatch assigns a courier. */

import { useTranslation } from 'react-i18next';
import type { CourierInfo } from '../orders/types';

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

/** Courier profile with lifetime history; searching state when unassigned. */
export function CourierCard(args: { courier: CourierInfo | null; unit: 'km' | 'mi' }) {
  const { t } = useTranslation();
  if (!args.courier) {
    return (
      <section className="tb-courier" aria-label={t('track.courierTitle')} aria-live="polite">
        <span className="tb-courier-avatar" aria-hidden="true">?</span>
        <div>
          <p className="tb-courier-name">{t('track.searching')}</p>
          <p className="tb-sub">{t('track.searchingSub')}</p>
        </div>
      </section>
    );
  }
  const c = args.courier;
  const dist = args.unit === 'mi' ? c.lifetime_km / 1.60934 : c.lifetime_km;
  const modeLabel = c.mode === 'runner' ? t('track.runner') : c.mode === 'biker' ? t('track.biker') : t('track.staff');
  return (
    <section className="tb-courier" aria-label={t('track.courierTitle')}>
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
