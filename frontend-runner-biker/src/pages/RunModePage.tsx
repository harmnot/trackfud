/**
 * Run Mode: huge stats, goal ring, offer overlay, nudges. The update
 * prompt never fires here (see `isMidRun`); offers pause while GPS is
 * stale; declining is never punished.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';
import { Button, Note, Page, Ring } from '../components/ui';
import { OfferCard } from '../components/OfferCard';
import { RunStats } from '../components/RunStats';
import { useRun } from '../features/run/sessionStore';
import { useRunEngine } from '../features/run/useRunEngine';
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
import { useCadence } from '../features/health/useCadence';
import { useStaff } from '../features/staff/staffStore';
import { parseVoiceCommand, voiceReply, type VoiceIntent } from '../features/voice/voiceCommands';
import { useVoiceCopilot } from '../features/voice/useVoiceCopilot';
import { db, type SessionSummary } from '../lib/db';
import { formatDistance, resolveUnits } from '../lib/format';
import { logger } from '../lib/logger';
import { alertOffer, speak, stopSpeaking } from '../lib/notify';
import { socket, type IncomingMsg } from '../lib/ws';
import { CadenceBadge } from '../components/CadenceBadge';
import { VoicePanel } from '../components/VoicePanel';
import i18n from '../i18n';

type Notice = { kind: 'hydration' | 'stale' | 'gap'; text: string };

const DEMO_OFFER_AFTER_MS = 20000;

export function RunModePage() {
  const { t } = useTranslation();
  const nav = useNavigate();
  const phase = useRun((s) => s.phase);
  const setup = useRun((s) => s.setup);
  const stats = useRun((s) => s.stats);
  const finish = useRun((s) => s.finish);
  const reset = useRun((s) => s.reset);
  const offer = useOffers((s) => s.current);
  const secondsLeft = useOffers((s) => s.secondsLeft);
  const deliveryActive = useDelivery((s) => s.active);
  const staffActive = useStaff((s) => s.active);
  const staffName = useStaff((s) => s.staffName);
  const [notices, setNotices] = useState<Notice[]>([]);
  const [cheer, setCheer] = useState<string | null>(null);
  const [lastHeard, setLastHeard] = useState<string | null>(null);
  const [lastReply, setLastReply] = useState<string | null>(null);
  const [micError, setMicError] = useState<string | null>(null);
  const lastOfferText = useRef<string | null>(null);
  const runVoiceRef = useRef<(text: string) => void>(() => undefined);
  const demoFired = useRef(false);

  const lang = (['en', 'id', 'ms'].includes(i18n.language) ? i18n.language : 'en') as 'en' | 'id' | 'ms';
  const locale = lang === 'id' ? 'id-ID' : lang === 'ms' ? 'ms-MY' : 'en-GB';
  const units = resolveUnits(locale);

  useRunEngine({
    lang,
    units,
    onNotice: (n) => setNotices((prev) => (prev.some((p) => p.kind === n.kind) ? prev : [...prev, n])),
  });

  const cadence = useCadence({ enabled: (setup?.mode ?? 'runner') === 'runner' });

  // 1 s countdown for the offer window (informational, never a rush timer).
  useEffect(() => {
    if (!offer) return;
    const timer = window.setInterval(() => useOffers.getState().tick(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [offer]);

  // Live offers from dispatch: socket frames first, `GET /courier/offers`
  // poll every 5 s as backup. The labelled demo simulator fires only when
  // the backend is unreachable (offline judge path). Cheers are READ ALOUD
  // (supporters power the run); chat lands in ChatPage.
  useEffect(() => {
    function takeOffer(raw: unknown): void {
      const parsed = parseOffer(raw);
      if (!parsed) {
        logger.warn('offer frame had unknown shape, ignored');
        return;
      }
      const st = useRun.getState();
      if (st.phase !== 'active' || st.stats.stale || useDelivery.getState().active) return;
      const line = `${parsed.merchantName}, ${formatDistance(parsed.addsM, { locale, units })}. Accept?`;
      lastOfferText.current = line;
      useOffers.getState().show(parsed);
      alertOffer({ line, lang });
    }
    function onMsg(msg: IncomingMsg): void {
      if (msg.type === 'cheer') {
        setCheer(msg.text);
        speak(msg.text, { lang });
        return;
      }
      if (msg.type === 'chat.message') {
        void useChat.getState().receive({ text: msg.text, lang: msg.lang });
        return;
      }
      if (msg.type === 'voice.transcript') {
        // Server transcript path: same intent pipeline.
        runVoiceRef.current(msg.text);
        return;
      }
      if (msg.type !== 'offer.created') return;
      takeOffer((msg as { offer: unknown }).offer ?? msg);
    }
    const off = socket.onMessage(onMsg);
    let stopped = false;
    async function pollOnce(): Promise<void> {
      if (stopped) return;
      const st = useRun.getState();
      if (st.phase !== 'active' || st.stats.stale || useDelivery.getState().active || useOffers.getState().current) return;
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
    setLastHeard(frame.reply_text);
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
        <div className="mt-3"><Note tone="info">💪 {cheer}</Note></div>
      )}
      {stats.stale && (
        <div className="mt-3"><Note tone="error">{t('run.stale')}</Note></div>
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
      {stats.gapCount > 0 && (
        <div className="mt-3"><Note tone="info">{t('run.gaps', { count: stats.gapCount })}</Note></div>
      )}
      {notices.map((n) => (
        <div className="mt-3" key={n.kind}>
          <Note tone={n.kind === 'stale' ? 'error' : 'info'}>{t(`run.notice_${n.kind}`)}</Note>
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
          />
        </div>
      )}
    </Page>
  );
}
