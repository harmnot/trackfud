/**
 * AI Run Planner panel: start point (GPS), window (now/lunch/dinner), two
 * loop options on the map with distance · time · estimate, hotspot list.
 * Workout-first copy throughout: estimates are chances, never promises.
 * Picking a plan hands its GeoJSON LineString to the caller — Run Setup
 * sends it as `planned_track` so dispatch scores the corridor (§6.1).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Note, RadioGroup } from '../../components/ui';
import { formatDistance, formatMoney, resolveUnits, type CourierMode } from '../../lib/format';
import { logger } from '../../lib/logger';
import type { LatLng } from '../../lib/maps';
import { createRunPlans, type PlanWindow } from './api';
import { PlanMap } from './PlanMap';
import type { PlannerPlan, PlannerResult } from './types';
import i18n from '../../i18n';

export function PlannerPanel(args: {
  mode: CourierMode;
  goalDistanceM: number;
  onPick: (plan: PlannerPlan | null) => void;
  pickedId: string | null;
}): React.JSX.Element {
  const { mode, goalDistanceM, onPick, pickedId } = args;
  const { t } = useTranslation();
  const [window, setWindow] = useState<PlanWindow>('lunch');
  const [center, setCenter] = useState<LatLng | null>(null);
  const [result, setResult] = useState<PlannerResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [locating, setLocating] = useState(false);

  const locale = i18n.language === 'id' ? 'id-ID' : i18n.language === 'ms' ? 'ms-MY' : 'en-GB';
  const units = resolveUnits(locale);
  const lang = (['en', 'id', 'ms'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'id' | 'ms';

  function useMyLocation(): void {
    if (!('geolocation' in navigator)) {
      setErr(t('planner.locationFailed'));
      return;
    }
    setLocating(true);
    setErr('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setLocating(false);
      },
      (e) => {
        logger.warn('planner geolocation failed', e);
        setErr(t('planner.locationFailed'));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }

  async function plan(): Promise<void> {
    if (!center || busy) return;
    setBusy(true);
    setErr('');
    onPick(null);
    try {
      const res = await createRunPlans({
        lat: center.lat,
        lng: center.lng,
        mode,
        goalDistanceM: Math.round(goalDistanceM),
        window,
        lang,
      });
      setResult(res);
    } catch (e) {
      logger.warn('run plan failed', e);
      setErr(e instanceof Error ? e.message : t('common.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Not a <Field>: a <label> around a button replaces the button's name
          with the label text, so screen readers heard "Start point" instead
          of the action. Same look, plain wrapper. */}
      <div>
        <span className="tb-label">{t('planner.start')}</span>
        <Button block variant="soft" onClick={useMyLocation} disabled={locating}>
          {locating ? t('tracks.locating') : center ? t('planner.located', { lat: center.lat.toFixed(4), lng: center.lng.toFixed(4) }) : t('tracks.useMyLocation')}
        </Button>
      </div>
      <RadioGroup
        name="plan-window"
        label={t('planner.window')}
        value={window}
        onChange={(v) => setWindow(v as PlanWindow)}
        options={[
          { value: 'now', label: t('planner.winNow') },
          { value: 'lunch', label: t('planner.winLunch') },
          { value: 'dinner', label: t('planner.winDinner') },
        ]}
      />
      <Button block variant="sun" onClick={() => void plan()} disabled={!center || busy}>
        {busy ? t('common.loading') : t('planner.planCta')}
      </Button>
      {err !== '' && <Note tone="error">{err}</Note>}
      {!center && <Note tone="info">{t('planner.needStart')}</Note>}
      {result && center && (
        <div className="flex flex-col gap-2">
          <PlanMap center={center} plans={result.plans} hotspots={result.hotspots} selectedId={pickedId} />
          <p className="tb-sub">
            {result.live ? t('planner.liveNote') : t('planner.offlineNote')} · {result.note}
          </p>
          {result.plans.map((p, i) => (
            <article key={p.id} className={`tb-card${pickedId === p.id ? ' tb-card-picked' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-bold">
                    <span className={i === 0 ? 'tb-dot-amber' : 'tb-dot-white'} aria-hidden="true" /> {p.name}
                  </p>
                  <p className="tb-sub mt-1">
                    {formatDistance(p.distance_m, { locale, units })} · {Math.round(p.duration_s / 60)} {t('planner.min')} ·
                    {' '}{t('planner.est', { n: p.est_orders, amount: formatMoney(p.est_earnings.amount_minor, p.est_earnings.currency, locale) })}
                  </p>
                  <p className="tb-sub mt-1">{p.reasoning}</p>
                  <p className="tb-sub mt-1">{t('planner.corridor', { m: Math.round(p.corridor_m) })}</p>
                </div>
              </div>
              <div className="mt-2">
                <Button
                  block
                  variant={pickedId === p.id ? 'pine' : 'soft'}
                  onClick={() => onPick(pickedId === p.id ? null : p)}
                >
                  {pickedId === p.id ? t('planner.picked') : t('planner.use')}
                </Button>
              </div>
            </article>
          ))}
          {result.hotspots.length > 0 && (
            <div className="tb-card">
              <p className="text-sm font-bold">{t('planner.hotspots')}</p>
              <ul className="tb-chip-row mt-2">
                {result.hotspots.slice(0, 6).map((h) => (
                  <li key={h.merchant_id} className="tb-chip">
                    {h.merchant_name} · {(h.distance_m / 1000).toFixed(1)} km
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
