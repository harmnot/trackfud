/**
 * Run Mode: huge stats, goal ring, offer overlay, nudges. The update
 * prompt never fires here (see `isMidRun`); the server decides offer
 * eligibility (fresh batch < 60 s, approval, corridor), so offers render
 * even while the local GPS signal lags — a client-side stale belief must
 * never hide a real pending offer. Declining is never punished.
 *
 * GPS is not owned here: the app-level `WorkSessionTracker` streams the
 * session on every screen (and confirms a refresh-restored one), and this
 * page only reads the run store — stats, signal, notices, resume state.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button, Note, Page, Ring } from '../components/ui';
import { OfferCard } from '../components/OfferCard';
import { RunStats } from '../components/RunStats';
import { useRun } from '../features/run/sessionStore';
import { selectSessionTrack, useTracks } from '../features/tracks/trackStore';
import { LiveTrackMap } from '../features/tracks/LiveTrackMap';
import type { LatLng } from '../lib/maps';
import { endWorkSession } from '../features/run/sessionApi';
import { useOffers, demoOffer } from '../features/offers/offerStore';
import { parseOffer } from '../features/offers/types';
import { toActiveDelivery, useDelivery } from '../features/delivery/deliveryStore';
import {
  acceptOffer,
  acceptStaffOffer,
  confirmVoiceAccept,
  declineOffer,
  listOffers,
  listStaffOffers,
  type VoiceIntentFrame,
} from '../features/delivery/courierApi';
import { ApiError } from '../lib/api';
import { useChat } from '../features/chat/chatStore';
import { usePartner } from '../features/profile/usePartner';
import { useCadence } from '../features/health/useCadence';
import { useStaff } from '../features/staff/staffStore';
import { parseVoiceCommand, voiceReply, type VoiceIntent } from '../features/voice/voiceCommands';
import { useVoiceCopilot } from '../features/voice/useVoiceCopilot';
import { db, type SessionSummary } from '../lib/db';
import { formatDistance, resolveCourierLocale } from '../lib/format';
import { logger } from '../lib/logger';
import { alertOffer, speak, stopSpeaking } from '../lib/notify';
import { socket, type IncomingMsg } from '../lib/ws';
import { CadenceBadge } from '../components/CadenceBadge';
import { VoicePanel } from '../components/VoicePanel';
import i18n from '../i18n';

const DEMO_OFFER_AFTER_MS = 20000;

export function RunModePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const queryClient = useQueryClient();
  const phase = useRun((s) => s.phase);
  const setup = useRun((s) => s.setup);
  const serverLinked = useRun((s) => s.serverLinked);
  const stats = useRun((s) => s.stats);
  const gps = useRun((s) => s.gps);
  const notices = useRun((s) => s.notices);
  const resuming = useRun((s) => s.resuming);
  const { unlocked: partnerUnlocked, isLoading: partnerLoading } = usePartner();
  const finish = useRun((s) => s.finish);
  const reset = useRun((s) => s.reset);
  const offer = useOffers((s) => s.current);
  const secondsLeft = useOffers((s) => s.secondsLeft);
  const deliveryActive = useDelivery((s) => s.active);
  const staffActive = useStaff((s) => s.active);
  const staffName = useStaff((s) => s.staffName);
  const [cheer, setCheer] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const lastOfferText = useRef<string | null>(null);
  const runVoiceRef = useRef<(text: string) => void>(() => undefined);
  const demoFired = useRef(false);

  const { lang, locale, units } = resolveCourierLocale(i18n.language);

  const cadence = useCadence({ enabled: (setup?.mode ?? 'runner') === 'runner' });

  // Saved-track live route: resolve the track (id first, legacy name as
  // fallback) and grow the GPS trail from tracker fixes. Both stay on-device.
  const sessionId = useRun((s) => s.sessionId);
  const savedTracks = useTracks((s) => s.tracks);
  const [trail, setTrail] = useState<LatLng[]>([]);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    if (setup?.trackKind === 'saved') void useTracks.getState().load();
  }, [setup?.trackKind]);
  useEffect(() => {
    setTrail([]);
    setFollow(true);
  }, [sessionId]);
  const sessionTrack = useMemo(() => {
    if (setup?.trackKind !== 'saved') return null;
    return selectSessionTrack({ tracks: savedTracks, trackId: setup.trackId ?? null, trackName: setup.trackName });
  }, [setup, savedTracks]);
  /** AI plan live route: real geography from POST /courier/run-plans, drawn
   * like a saved track so the corridor the courier runs matches dispatch. */
  const aiPlanned = useMemo(() => {
    if (setup?.trackKind !== 'ai' || !setup?.plannedTrack) return null;
    const coords = setup.plannedTrack.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const pts = coords
      .map((c) => (Array.isArray(c) && c.length >= 2 ? { lat: c[1] as number, lng: c[0] as number } : null))
      .filter((p): p is LatLng => !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng));
    return pts.length >= 2 ? pts : null;
  }, [setup]);
  useEffect(() => {
    const { lastLat, lastLng } = stats;
    if (lastLat == null || lastLng == null) return;
    setTrail((prev) => {
      const last = prev[prev.length - 1];
      if (last && last.lat === lastLat && last.lng === lastLng) return prev;
      const next = [...prev, { lat: lastLat, lng: lastLng }];
      return next.length > 2000 ? next.slice(next.length - 2000) : next;
    });
  }, [stats.lastLat, stats.lastLng, stats.lastTs]);
  const liveFix = useMemo(() => {
    if (stats.lastLat == null || stats.lastLng == null) return null;
    return { lat: stats.lastLat, lng: stats.lastLng };
  }, [stats.lastLat, stats.lastLng]);

  // 1 s countdown for the offer window (informational, never a rush timer).
  useEffect(() => {
    if (!offer) return;
    const timer = window.setInterval(() => useOffers.getState().tick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [offer]);

  // Live offers from dispatch: socket frames first, `GET /courier/offers`
  // poll every 5 s as backup. Dispatch pings with a minimal frame (ids +
  // expiry), so a ping refetches the full pending offer — the server stays
  // the truth and frames stay small on a runner's radio. Offers are shown
  // and polled whenever a session is recording with no active delivery,
  // deliberately NOT gated on the local GPS/stale signal: eligibility lives
  // server-side (fresh batch < 60 s, approved, corridor), and the local
  // signal can lag the server (backgrounded timers, slow first fix) while
  // a real pending offer waits. The GPS/stale banners below stay purely
  // informational. The labelled demo simulator fires only when the backend
  // is unreachable (offline judge path). Cheers are READ ALOUD (supporters power the run); chat lands in
  // ChatPage. The `delivery.leave_now` nudge arms "head now" straight from
  // the kitchen-ready timing; a sanction mid-run blocks new offers.
  useEffect(() => {
    function takeOffer(raw: unknown): void {
      const parsed = parseOffer(raw);
      if (!parsed) {
        logger.warn('offer frame had unknown shape, ignored');
        return;
      }
      const st = useRun.getState();
      // Server-truth eligibility: never gate a live offer on the local
      // GPS/stale belief (see above).
      if (st.phase !== 'active' || useDelivery.getState().active) return;
      const line = `${parsed.merchantName}, ${formatDistance(parsed.addsM, { locale, units })}. Accept?`;
      lastOfferText.current = line;
      useOffers.getState().show(parsed);
      alertOffer({ line, lang });
    }
    /** Pull the full pending offer after a minimal dispatch ping. */
    async function refetchOffer(): Promise<void> {
      const st = useRun.getState();
      if (st.phase !== 'active' || useDelivery.getState().active || useOffers.getState().current) return;
      try {
        const staff = useStaff.getState().active;
        const offers = staff ? await listStaffOffers() : await listOffers();
        const first = offers.find((o) => o.status === 'pending') ?? offers[0];
        if (first) takeOffer(first);
      } catch (err) {
        logger.warn('offer refetch failed, poll backup owns the next try', err);
      }
    }
    function onMsg(msg: IncomingMsg): void {
      // Cheers arrive from the customer track (`cheerOrder`): the server sends
      // both `text` and the legacy `message` shape — either one speaks aloud.
      if (msg.type === 'cheer') {
        const line = msg.text ?? msg.message ?? '';
        if (line.trim().length === 0) return;
        setCheer(line);
        speak(line, { lang });
        return;
      }
      // Chat lines + their translations go through bindChatFrames (bound
      // once in App), which keeps the server message id.
      if (msg.type === 'voice.transcript') {
        // Server transcript path: same intent pipeline.
        runVoiceRef.current(msg.text);
        return;
      }
      if (msg.type === 'delivery.leave_now') {
        useDelivery.getState().nudgeHeadNow(null);
        const name = useDelivery.getState().active?.merchantName ?? '';
        if (name) speak(`Head to ${name} now.`, { lang });
        return;
      }
      if (msg.type === 'delivery.eta') {
        useDelivery.getState().setEta(msg.eta_s);
        return;
      }
      if (msg.type === 'courier.status') {
        // Freeze/ban mid-run: offers stop, the notice explains, the wallet
        // stays open. Refetch the standing; the account screens render it.
        void queryClient.invalidateQueries({ queryKey: ['partner-application'] });
        if (msg.status === 'frozen' || msg.status === 'banned') {
          const line = t('account.sanctionedRun', {
            defaultValue: 'Your courier account status changed — new offers are paused. Money you earned stays withdrawable.',
          });
          setLastReply(line);
          speak(line, { lang });
        }
        return;
      }
      if (msg.type === 'offer.taken') {
        // Lost the race: another courier accepted first (atomic claim on the
        // server). Clear a card for the same delivery so it never lingers
        // until expiry, then say so — one order is one courier.
        const cur = useOffers.getState().current;
        if (cur && !cur.demo && msg.delivery_id && cur.deliveryId === msg.delivery_id) {
          useOffers.getState().clear();
          const taken = t('run.taken');
          setLastReply(taken);
          speak(taken, { lang });
        }
        return;
      }
      if (msg.type !== 'offer.created') return;
      // Legacy full frames still parse directly; minimal pings refetch.
      if (msg.offer) {
        takeOffer(msg.offer);
        return;
      }
      void refetchOffer();
    }
    const off = socket.onMessage(onMsg);
    let stopped = false;
    // The app-level tracker also connects, but Run Mode owns the offer
    // stream: connect here too so offers never depend on the tracker's
    // timing — connect is idempotent while the socket is open/connecting.
    void socket.connect();
    async function pollOnce(): Promise<void> {
      if (stopped) return;
      const st = useRun.getState();
      if (st.phase !== 'active' || useDelivery.getState().active || useOffers.getState().current) return;
      try {
        const staff = useStaff.getState().active;
        const offers = staff ? await listStaffOffers() : await listOffers();
        const first = offers.find((o) => o.status === 'pending') ?? offers[0];
        if (first && !stopped) takeOffer(first);
      } catch (err) {
        // Backend unreachable: one labelled demo offer so the flow stays
        // testable offline. Never fires when live offers exist.
        if (demoFired.current) return;
        demoFired.current = true;
        logger.warn('offer poll failed, demo simulator owns the next offer', err);
        const cur = useRun.getState();
        if (cur.phase !== 'active' || useDelivery.getState().active || useOffers.getState().current) return;
        const currency = (() => {
          try {
            return localStorage.getItem('tb:courier:currency') ?? 'IDR';
          } catch {
            return 'IDR';
          }
        })();
        const demo = demoOffer({ mode: cur.setup?.mode ?? 'runner', currency });
        useOffers.getState().show(demo);
        alertOffer({ line: `${demo.merchantName}. ${demo.feeMinor} ${demo.currency}. Accept?`, lang });
      }
    }
    const pollTimer = window.setInterval(() => void pollOnce(), 5000);
    const demoTimer = window.setTimeout(() => void pollOnce(), DEMO_OFFER_AFTER_MS);
    return () => {
      stopped = true;
      off();
      window.clearInterval(pollTimer);
      window.clearTimeout(demoTimer);
    };
  }, [lang, locale, units]);

  if (phase !== 'active' || !setup) {
    return (
      <Page>
        <h1 className="tb-display">{t('run.noSession')}</h1>
        <div className="mt-4"><Link to="/run-setup" className="tb-btn tb-btn-pine tb-btn-block">{t('run.start')}</Link></div>
      </Page>
    );
  }

  const goalTarget = setup.goalValue;
  const goalDone = setup.goalKind === 'distance' ? stats.distanceM : setup.goalKind === 'time' ? stats.movingS : 0;
  const goalPct = setup.goalKind === 'open' || goalTarget <= 0 ? 0 : Math.min(1, goalDone / goalTarget);

  async function accept(): Promise<void> {
    const cur = useOffers.getState().current;
    if (!cur) return;
    stopSpeaking();
    useOffers.getState().recordAnswer(true);
    useOffers.getState().clear();
    // Demo offer (offline path) assigns locally; live offers assign from
    // the server envelope so payout and ids are the backend's truth.
    if (cur.demo) {
      useDelivery.getState().assign({
        deliveryId: cur.deliveryId,
        orderId: cur.orderId,
        merchantName: cur.merchantName,
        feeMinor: cur.feeMinor,
        currency: cur.currency,
        etaS: null,
        routeWarning: null,
        demo: true,
      });
      speak(`Accepted. Heading to ${cur.merchantName}.`, { lang });
      nav('/delivery');
      return;
    }
    try {
      const staff = useStaff.getState().active;
      const env = staff ? await acceptStaffOffer({ offerId: cur.offerId }) : await acceptOffer({ offerId: cur.offerId });
      useDelivery.getState().assign(toActiveDelivery(env));
      if (env.delivery.nudged) useDelivery.getState().nudgeHeadNow(null);
      speak(`Accepted. Heading to ${env.delivery.pickup.merchant_name}.`, { lang });
      nav('/delivery');
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
        const taken = t('run.taken');
        setLastReply(taken);
        speak(taken, { lang });
        return;
      }
      logger.warn('offer accept failed', err);
      setLastReply(t('common.error'));
    }
  }

  function decline(): void {
    const cur = useOffers.getState().current;
    stopSpeaking();
    useOffers.getState().recordAnswer(false);
    useOffers.getState().clear();
    // Declining is never penalised; the server just frees the offer.
    if (cur && !cur.demo) {
      declineOffer({ offerId: cur.offerId }).catch((err: unknown) => logger.warn('offer decline failed', err));
    }
  }

  /** Server voice intent (B6 relay): speak the reply, execute accepts. */
  function runServerIntent(frame: VoiceIntentFrame): void {
    setLastHeard(frame.transcript || null);
    setLastReply(frame.reply_text);
    speak(frame.reply_text, { lang });
    if (frame.intent !== 'accept' || !frame.offer_id || !frame.confirmation) return;
    const cur = useOffers.getState().current;
    if (!cur || cur.offerId !== frame.offer_id) {
      logger.warn('voice accept for a stale offer, ignored');
      return;
    }
    useOffers.getState().recordAnswer(true);
    useOffers.getState().clear();
    void (async () => {
      try {
        const env = await confirmVoiceAccept({ offerId: frame.offer_id as string, confirmation: frame.confirmation as string });
        useDelivery.getState().assign(toActiveDelivery(env));
        nav('/delivery');
      } catch (err) {
        if (err instanceof ApiError && (err.status === 409 || err.status === 410)) {
          const taken = t('run.taken');
          setLastReply(taken);
          speak(taken, { lang });
          return;
        }
        logger.warn('voice confirm failed', err);
      }
    })();
  }

  /** Hands-free intent pipeline: transcript (mic or typed) → act → speak. */
  function runVoiceIntent(intent: VoiceIntent, text: string): void {
    setLastHeard(text);
    const delivery = useDelivery.getState().active;
    const etaText = delivery
      ? delivery.headNow
        ? t('voice.etaHeadNow', { name: delivery.merchantName })
        : t('voice.etaActive', { name: delivery.merchantName })
      : t('voice.etaNone');
    if (intent.kind === 'accept') {
      const cur = useOffers.getState().current;
      if (!cur) {
        const reply = voiceReply({ intent, lang, ctx: { merchantName: null, etaText, lastOfferText: lastOfferText.current } });
        setLastReply(reply);
        speak(reply, { lang });
        return;
      }
      setLastReply(voiceReply({ intent, lang, ctx: { merchantName: cur.merchantName, etaText, lastOfferText: lastOfferText.current } }));
      void accept();
      return;
    }
    if (intent.kind === 'decline') {
      decline();
    }
    if (intent.kind === 'etaSoon' && delivery) {
      // Tell the customer through the live delivery thread (queued local when offline).
      void useChat.getState().send({ deliveryId: delivery.deliveryId, text: lang === 'id' ? '2 menit sampai' : '2 minutes away', lang });
    }
    const reply = voiceReply({ intent, lang, ctx: { merchantName: delivery?.merchantName ?? null, etaText, lastOfferText: lastOfferText.current } });
    setLastReply(reply);
    speak(reply, { lang });
  }
  runVoiceRef.current = (text: string) => runVoiceIntent(parseVoiceCommand({ text }), text);

  const copilot = useVoiceCopilot({
    onTranscript: (text: string) => {
      copilot.stopTalk();
      runVoiceIntent(parseVoiceCommand({ text }), text);
    },
    onMicError: (reason: string) => setMicError(reason),
    onServerIntent: (frame) => runServerIntent(frame),
  });

  async function endSession(): Promise<void> {
    const s = useRun.getState();
    const sessionId = s.sessionId;
    // Close the server session first (lifetime totals, splits, track fold
    // in there); the local summary below is the offline mirror either way.
    if (sessionId && s.serverLinked) {
      await endWorkSession({ sessionId });
    }
    const summary: SessionSummary = {
      sessionId: s.sessionId ?? crypto.randomUUID(),
      mode: s.setup?.mode ?? 'runner',
      startedAt: Date.now() - stats.elapsedS * 1000,
      endedAt: Date.now(),
      distanceM: Math.round(stats.distanceM),
      movingS: stats.movingS,
      activeS: stats.activeS,
      gapCount: stats.gapCount,
      gapS: stats.gapS,
      earningsMinor: 0,
      currency: (() => {
        try {
          return localStorage.getItem('tb:courier:currency') ?? 'IDR';
        } catch {
          return 'IDR';
        }
      })(),
    };
    try {
      await db.sessions.add(summary);
    } catch (err) {
      logger.error('session summary save failed', err);
    }
    socket.disconnect();
    finish();
    reset();
    nav('/wallet');
  }

  return (
    <Page>
      <p className="tb-rec live">{t('run.live', { mode: setup.mode === 'biker' ? t('onboard.biker') : t('onboard.runner') })}</p>
      {staffActive && (
        <div className="mt-3"><Note tone="info">{t('staff.onDuty', { name: staffName })}</Note></div>
      )}
      {cheer && (
        <div className="mt-3 tb-toast" key={cheer}><Note tone="info">💪 {cheer}</Note></div>
      )}
      {stats.stale && stats.lastLat != null && (
        <div className="mt-3"><Note tone="error">{t('run.stale')}</Note></div>
      )}
      {gps === 'waiting' && !stats.stale && (
        <div className="mt-3"><Note tone="info">{t('run.gpsWaiting')}</Note></div>
      )}
      {gps === 'denied' && (
        <div className="mt-3"><Note tone="error">{t('run.gpsDenied')}</Note></div>
      )}
      {gps === 'weak' && (
        <div className="mt-3"><Note tone="error">{t('run.gpsWeak')}</Note></div>
      )}
      {gps === 'unavailable' && (
        <div className="mt-3"><Note tone="error">{t('run.gpsUnavailable')}</Note></div>
      )}
      {resuming && (
        <div className="mt-3"><Note tone="info">{t('run.resuming')}</Note></div>
      )}
      {!serverLinked && (
        <div className="mt-3"><Note tone="info">{t('run.sessionOffline')}</Note></div>
      )}
      {serverLinked && !partnerLoading && !partnerUnlocked && (
        <div className="mt-3"><Note tone="info">{t('run.readyLocked')}</Note></div>
      )}
      {serverLinked && partnerUnlocked && gps === 'ok' && !stats.stale && (
        <div className="mt-3"><Note tone="info">{t('run.readyLive')}</Note></div>
      )}
      {serverLinked && partnerUnlocked && (gps !== 'ok' || stats.stale) && (
        <div className="mt-3"><Note tone="info">{t('run.readyNoGps')}</Note></div>
      )}
      <div className="tb-timer mt-3">
        <div className="mt-2">
          <Ring
            progress={goalPct}
            center={setup.goalKind === 'open' ? '∞' : `${Math.round(goalPct * 100)}%`}
            sub={setup.goalKind === 'time' ? t('run.goalTime') : t('run.goalDistance')}
          />
        </div>
        <div className="mt-3">
          <RunStats
            distanceM={stats.distanceM}
            movingS={stats.movingS}
            activeS={stats.activeS}
            mode={setup.mode}
            earningsMinor={deliveryActive?.feeMinor ?? 0}
            currency={deliveryActive?.currency ?? 'IDR'}
            locale={locale}
            units={units}
            labels={{ distance: t('fitness.distance'), time: t('fitness.moving'), pace: t('run.pace'), active: t('run.activeMin'), earned: t('run.earned') }}
          />
        </div>
      </div>
      {setup.trackKind === 'saved' && (
        <div className="tb-card mt-3">
          <p className="text-sm font-bold">{t('run.liveRoute')}{sessionTrack ? ` · ${sessionTrack.name}` : ''}</p>
          <p className="tb-sub mt-1">{t('run.liveRouteSub')}</p>
          <div className="mt-2">
            {!sessionTrack ? (
              <Note tone="info">{t('run.trackMissing')} <Link to="/tracks" className="underline">{t('tracks.title')}</Link></Note>
            ) : !sessionTrack.geo ? (
              <Note tone="info">{t('run.noGeoTrack')} <Link to="/tracks" className="underline">{t('tracks.title')}</Link></Note>
            ) : (
              <LiveTrackMap
                center={sessionTrack.geo.center}
                planned={sessionTrack.geo.path}
                snapped={sessionTrack.geo.snapped}
                trail={trail}
                live={liveFix}
                follow={follow}
                onToggleFollow={() => setFollow((f) => !f)}
              />
            )}
          </div>
        </div>
      )}
      {setup.trackKind === 'ai' && (
        <div className="tb-card mt-3">
          <p className="text-sm font-bold">{t('run.liveRoute')}{setup.planName ? ` · ${setup.planName}` : ''}</p>
          <p className="tb-sub mt-1">{t('planner.liveSub')}</p>
          <div className="mt-2">
            {!aiPlanned ? (
              <Note tone="info">{t('planner.noPlanInline')} <Link to="/planner" className="underline">{t('planner.title')}</Link></Note>
            ) : (
              <LiveTrackMap
                center={aiPlanned[0] as LatLng}
                planned={aiPlanned}
                snapped={null}
                trail={trail}
                live={liveFix}
                follow={follow}
                onToggleFollow={() => setFollow((f) => !f)}
              />
            )}
          </div>
        </div>
      )}
      {stats.gapCount > 0 && (
        <div className="mt-3"><Note tone="info">{t('run.gaps', { count: stats.gapCount })}</Note></div>
      )}
      {notices.map((kind) => (
        <div className="mt-3" key={kind}>
          <Note tone={kind === 'stale' ? 'error' : 'info'}>{t(`run.notice_${kind}`)}</Note>
        </div>
      ))}
      {deliveryActive && (
        <div className="mt-3">
          <Link to="/delivery" className="tb-btn tb-btn-sun tb-btn-block">
            {t('run.toDelivery', { name: deliveryActive.merchantName })}
          </Link>
        </div>
      )}
      <VoicePanel
        phase={copilot.phase}
        pcmBytes={copilot.pcmBytes}
        serverVoice={copilot.serverVoice}
        lastHeard={lastHeard}
        lastReply={lastReply}
        micError={micError}
        labels={{
          hold: t('voice.hold'),
          release: t('voice.release'),
          heard: t('voice.heard'),
          reply: t('voice.reply'),
          typedPlaceholder: t('voice.typePlaceholder'),
          send: t('chat.send'),
          fallback: t('voice.fallback'),
          server: t('voice.server'),
          denied: t('voice.denied'),
        }}
        onHold={copilot.startTalk}
        onRelease={() => {
          copilot.stopTalk();
        }}
        onType={(text) => runVoiceIntent(parseVoiceCommand({ text }), text)}
      />
      <CadenceBadge
        mode={setup.mode}
        supported={cadence.supported}
        steps={cadence.steps}
        spm={cadence.spm}
        labels={{ title: t('health.cadence'), enable: t('health.enable'), steps: t('health.steps'), unavailable: t('health.unavailable') }}
        onEnable={cadence.enable}
      />
      <div className="mt-3">
        <Link to="/chat" className="tb-btn tb-btn-soft tb-btn-block">{t('chat.open')}</Link>
      </div>
      <div className="mt-3 flex gap-2">
        <div className="flex-1"><Link to="/wallet" className="tb-btn tb-btn-soft tb-btn-block">{t('run.wallet')}</Link></div>
        <div className="flex-1"><Button block variant="danger" onClick={() => void endSession()}>{t('run.end')}</Button></div>
      </div>
      {offer && (
        <div className="tb-overlay" role="presentation">
          <OfferCard
            offer={offer}
            secondsLeft={secondsLeft}
            locale={locale}
            units={units}
            acceptLabel={t('run.accept')}
            declineLabel={t('run.decline')}
            expiryLabel={(s) => t('run.expires', { s })}
            fitLabel={(off, adds) => t('run.fit', { off, adds })}
            noPenalty={t('run.noPenalty')}
            demoLabel={t('run.demoOffer')}
            onAccept={() => void accept()}
            onDecline={decline}
            voice={
              copilot.phase === 'unsupported'
                ? undefined
                : {
                    listening: copilot.phase === 'listening',
                    holdLabel: t('voice.hold'),
                    releaseLabel: t('voice.release'),
                    heardLabel: t('voice.heard'),
                    heard: lastHeard,
                    onHold: copilot.startTalk,
                    onRelease: () => copilot.stopTalk(),
                  }
            }
          />
        </div>
      )}
    </Page>
  );
}
