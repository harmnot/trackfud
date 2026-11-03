/**
 * Active delivery: head-now nudge, navigation, pickup-code confirm,
 * PIN/photo completion. Pickup and handover confirm against the live
 * backend (B4); arrival taps are best-effort (GPS keeps the truth).
 * Money lands in the wallet at once on delivery.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button, Field, Note, Page, TextInput } from '../components/ui';
import { usePartner } from '../features/profile/usePartner';
import { toActiveDelivery, toPhase, useDelivery } from '../features/delivery/deliveryStore';
import { confirmDropoff, confirmPickup, fetchActiveDelivery, isMissingBackend, markArrived } from '../features/delivery/courierApi';
import { useStaff } from '../features/staff/staffStore';
import { useWallet } from '../features/wallet/walletStore';
import { uploadViaPresign } from '../lib/api';
import { logger } from '../lib/logger';
import { socket } from '../lib/ws';
import { speak } from '../lib/notify';
import { useRun } from '../features/run/sessionStore';
import i18n from '../i18n';

const NUDGE_AFTER_MS = 12000;
const CODE_RE = /^\d{4}$/;

export function DeliveryPage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const active = useDelivery((s) => s.active);
  const [code, setCode] = useState('');
  const [pin, setPin] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const nudged = useRef(false);
  const staffActive = useStaff((s) => s.active);
  const staffTravel = useStaff((s) => s.travel);
  const { unlocked, sanctioned, standing, isLoading: partnerLoading } = usePartner();
  const lang = (['en', 'id', 'ms'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'id' | 'ms';

  // Recover the live leg after a refresh: the server is the truth.
  useEffect(() => {
    if (useDelivery.getState().active) return;
    let live = true;
    void (async () => {
      try {
        const env = await fetchActiveDelivery();
        if (!live || !env) return;
        useDelivery.getState().assign(toActiveDelivery(env));
        useDelivery.getState().setPhase(toPhase(env.delivery.status));
        if (env.delivery.nudged) useDelivery.getState().nudgeHeadNow(null);
      } catch (err) {
        logger.warn('active delivery recovery failed', err);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  // "Head to restaurant now" nudge, timed to food-ready (demo: shortly
  // after assign; live: the `nudged` flag or delivery.nudge socket frame).
  useEffect(() => {
    if (!active || active.phase !== 'assigned' || active.headNow || nudged.current) return;
    const name = active.merchantName;
    const timer = window.setTimeout(() => {
      nudged.current = true;
      useDelivery.getState().nudgeHeadNow(12);
      speak(`Head to ${name} now.`, { lang });
    }, NUDGE_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [active, lang]);

  // Live leg events: the server-timed "leave now" nudge and route replans.
  // Demo legs (offline path) ignore server frames; the timer above owns them.
  useEffect(() => {
    const off = socket.onMessage((msg) => {
      const cur = useDelivery.getState().active;
      if (!cur || cur.demo) return;
      if (msg.type === 'delivery.leave_now' && msg.delivery_id === cur.deliveryId) {
        nudged.current = true;
        useDelivery.getState().nudgeHeadNow(null);
        speak(`Head to ${cur.merchantName} now.`, { lang });
      }
      if (msg.type === 'delivery.eta' && msg.delivery_id === cur.deliveryId) {
        useDelivery.getState().setEta(msg.eta_s);
      }
    });
    return off;
  }, [lang]);

  if (!active) {
    return (
      <Page>
        <h1 className="tb-display">{t('delivery.none')}</h1>
        {!partnerLoading && sanctioned && (
          <div className="mt-3">
            <Note tone="error">
              {standing === 'frozen'
                ? t('account.frozen', {
                    defaultValue:
                      'Your courier account is temporarily frozen — you cannot go online or receive offers. Contact the review team to appeal.',
                  })
                : t('account.banned', {
                    defaultValue:
                      'Your courier account is permanently closed. You cannot go online or receive offers.',
                  })}
            </Note>
          </div>
        )}
        {!partnerLoading && !unlocked && (
          <div className="tb-card mt-3">
            <p className="text-sm font-bold">{t('account.partnerTitle')}</p>
            <p className="tb-sub mt-1">{t('account.deliveryLocked')}</p>
            <div className="mt-3 flex flex-col gap-2">
              <Link to="/onboarding" className="tb-btn tb-btn-pine tb-btn-block">{t('account.becomePartner')}</Link>
              <Link to="/run-setup" className="tb-btn tb-btn-soft tb-btn-block">{t('account.startTracking')}</Link>
            </div>
          </div>
        )}
        <div className="mt-4"><Link to="/run" className="tb-btn tb-btn-pine tb-btn-block">{t('delivery.back')}</Link></div>
      </Page>
    );
  }

  const mode = useRun.getState().setup?.mode ?? 'runner';
  const mapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(active.merchantName)}&travelmode=${mode === 'biker' ? 'bicycling' : 'walking'}`;

  /** Arrival taps confirm server-side (best-effort; GPS keeps truth). */
  async function doArrived(at: 'pickup' | 'dropoff', next: 'at_pickup' | 'at_dropoff'): Promise<void> {
    const cur = useDelivery.getState().active;
    if (!cur) return;
    if (!cur.demo) {
      try {
        await markArrived({ deliveryId: cur.deliveryId, at });
      } catch (err) {
        logger.warn('arrived confirm failed, phase still advances', err);
      }
    }
    useDelivery.getState().setPhase(next);
  }

  async function doPickup(): Promise<void> {
    if (!CODE_RE.test(code)) {
      setMsg(t('delivery.badCode'));
      return;
    }
    const cur = useDelivery.getState().active;
    if (!cur) return;
    setBusy(true);
    // Live legs confirm the merchant code server-side; the demo leg
    // (offline path) advances locally. Failures block, never fake.
    if (!cur.demo) {
      try {
        const env = await confirmPickup({ deliveryId: cur.deliveryId, code });
        useDelivery.getState().setPhase(toPhase(env.delivery.status));
        setBusy(false);
        nav('/delivery');
        return;
      } catch (err) {
        if (!isMissingBackend(err)) {
          setMsg(t('common.error'));
          setBusy(false);
          return;
        }
      }
    }
    useDelivery.getState().setPhase('picked_up');
    setBusy(false);
    nav('/delivery');
  }

  async function doPhoto(file: File): Promise<void> {
    setBusy(true);
    try {
      const fileId = await uploadViaPresign({ file, bucket: 'private' });
      await finishDelivery({ pin: null, photoFileId: fileId });
    } catch (err) {
      logger.warn('photo proof failed', err);
      setMsg(t('common.error'));
      setBusy(false);
    }
  }

  async function doPin(): Promise<void> {
    if (!CODE_RE.test(pin)) {
      setMsg(t('delivery.badPin'));
      return;
    }
    setBusy(true);
    await finishDelivery({ pin, photoFileId: null });
  }

  async function finishDelivery(args: { pin: string | null; photoFileId: string | null }): Promise<void> {
    const cur = useDelivery.getState().active;
    if (!cur) return;
    // Live legs complete server-side (PIN or photo proof); the demo leg
    // advances locally. Failures block, never fake a handover.
    if (!cur.demo) {
      try {
        await confirmDropoff({ deliveryId: cur.deliveryId, pin: args.pin, photoFileId: args.photoFileId });
      } catch (err) {
        if (!isMissingBackend(err)) {
          setMsg(t('common.error'));
          setBusy(false);
          return;
        }
      }
    }
    await useWallet.getState().creditDelivery({
      feeMinor: cur.feeMinor,
      currency: cur.currency,
      label: useStaff.getState().active ? `staff · ${cur.merchantName}` : cur.merchantName,
    });
    useDelivery.getState().complete();
    setBusy(false);
    speak('Delivered. Nice work.', { lang });
    nav('/wallet');
  }

  const setPhase = useDelivery.getState().setPhase;

  return (
    <Page>
      <h1 className="tb-display">{active.merchantName}</h1>
      <p className="tb-sub">{t('delivery.promise')}</p>
      {!partnerLoading && sanctioned && (
        <div className="mt-3">
          <Note tone="error">
            {standing === 'frozen'
              ? t('account.frozen', {
                  defaultValue:
                    'Your courier account is temporarily frozen — you cannot go online or receive offers. Contact the review team to appeal.',
                })
              : t('account.banned', {
                  defaultValue:
                    'Your courier account is permanently closed. You cannot go online or receive offers.',
                })}
          </Note>
        </div>
      )}
      {staffActive && (
        <div className="mt-3"><Note tone="info">{t('staff.delivering', { travel: t(`staff.travel_${staffTravel}`) })}</Note></div>
      )}
      {active.headNow && (active.phase === 'assigned' || active.phase === 'to_pickup') && (
        <div className="mt-3"><Note tone="info">{t('delivery.headNow', { name: active.merchantName })}</Note></div>
      )}
      {active.etaS !== null && (
        <div className="mt-3"><Note tone="info">{t('delivery.eta', { mins: Math.max(1, Math.round(active.etaS / 60)) })}</Note></div>
      )}
      {active.demo && (
        <div className="mt-3"><Note tone="info">{t('run.demoOffer')}</Note></div>
      )}
      <div className="tb-card mt-3">
        <p className="text-sm font-bold">{t('delivery.navigate')}</p>
        <div className="mt-2 flex gap-2">
          <div className="flex-1">
            <a className="tb-btn tb-btn-soft tb-btn-block" href={mapsUrl} target="_blank" rel="noreferrer">
              {t('delivery.openMaps')}
            </a>
          </div>
        </div>
        <p className="tb-sub mt-2">{active.routeWarning ?? t('delivery.betaWarn')}</p>
      </div>

      {(active.phase === 'assigned' || active.phase === 'to_pickup') && (
        <div className="mt-3 flex flex-col gap-2">
          {active.phase === 'assigned' && (
            <Button block variant="sun" onClick={() => setPhase('to_pickup')}>{t('delivery.onMyWay')}</Button>
          )}
          {active.phase === 'to_pickup' && (
            <Button block variant="sun" disabled={busy} onClick={() => void doArrived('pickup', 'at_pickup')}>{t('delivery.arrivedPickup')}</Button>
          )}
        </div>
      )}
      {active.phase === 'at_pickup' && (
        <div className="tb-card mt-3">
          <p className="tb-sub">{t('delivery.stepPickup', { defaultValue: 'Step 1 of 2 · pickup at the restaurant' })}</p>
          <Field label={t('delivery.pickupCode')}>
            <TextInput className="tb-code" inputMode="numeric" maxLength={4} value={code} onChange={setCode} placeholder="••••" aria-label={t('delivery.pickupCode')} />
          </Field>
          <p className="tb-sub mt-1">{t('delivery.pickupWho', { defaultValue: 'Merchant code — ask staff to show their screen. Never ask the customer for this.' })}</p>
          <div className="mt-2"><Button block variant="sun" disabled={busy} onClick={() => void doPickup()}>{t('delivery.confirmPickup')}</Button></div>
        </div>
      )}
      {(active.phase === 'picked_up' || active.phase === 'to_customer') && (
        <div className="mt-3">
          <Button block variant="sun" disabled={busy} onClick={() => void doArrived('dropoff', 'at_dropoff')}>{t('delivery.arrivedCustomer')}</Button>
        </div>
      )}
      {active.phase === 'at_dropoff' && (
        <div className="tb-card mt-3">
          <p className="tb-sub">{t('delivery.stepDropoff', { defaultValue: 'Step 2 of 2 · handover to the customer' })}</p>
          <Field label={t('delivery.pin')}>
            <TextInput className="tb-code" inputMode="numeric" maxLength={4} value={pin} onChange={setPin} placeholder="••••" aria-label={t('delivery.pin')} />
          </Field>
          <p className="tb-sub mt-1">{t('delivery.pinWho', { defaultValue: 'Customer PIN — ask the customer to tell you face to face. Never ask the merchant for this.' })}</p>
          <div className="mt-2"><Button block variant="sun" disabled={busy} onClick={() => void doPin()}>{t('delivery.confirmPin')}</Button></div>
          <div className="mt-2">
            <label className="tb-btn tb-btn-soft tb-btn-block">
              {t('delivery.photoInstead')}
              <input type="file" accept="image/*" capture="environment" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void doPhoto(f); }} />
            </label>
          </div>
        </div>
      )}
      {msg && <div className="mt-3"><Note tone="error">{msg}</Note></div>}
      <div className="mt-3"><Link to="/run" className="tb-btn tb-btn-soft tb-btn-block">{t('delivery.back')}</Link></div>
    </Page>
  );
}
