/**
 * Run engine: GPS watch → filter → stats → IndexedDB buffer → WS
 * `loc.batch` every 5 s, HTTP fallback, reconnect backlog resend, gap
 * marking, Wake Lock. Gaps are recorded and shown — never interpolated.
 */
import { useEffect, useRef } from 'react';
import {
  ACTIVE_MPS,
  GAP_INVALID_S,
  GAP_MARK_S,
  GPS_MAX_ACCURACY_M,
  HYDRATION_EVERY_S,
  LOC_BATCH_S,
  STALE_AFTER_S,
  formatPace,
  formatSpeed,
  type CourierMode,
  type Units,
} from '../../lib/format';
import { bufferPoint, markSent, pruneSentPoints, unsentPoints } from '../../lib/db';
import { classifySegment, haversineM } from '../../lib/geo';
import { logger } from '../../lib/logger';
import { socket } from '../../lib/ws';
import { api } from '../../lib/api';
import { speak } from '../../lib/notify';
import { useRun } from './sessionStore';
import { useDelivery } from '../delivery/deliveryStore';

const TELEPORT_MPS: Record<CourierMode, number> = { runner: 25 / 3.6, biker: 50 / 3.6 };
const FLUSH_LIMIT = 200;
const HTTP_RETRY_MS = 30000;

type EngineCallbacks = {
  /** Shown as an in-run note (hydration, stale, gap warnings). */
  onNotice: (notice: { kind: 'hydration' | 'stale' | 'gap'; text: string }) => void;
  lang: 'en' | 'id' | 'ms';
  /** Display units for the per-km/mi split cue (mi splits every mile). */
  units: Units;
};

type WakeLockSentinel = { release: () => Promise<void> };

/** Acquire a screen Wake Lock; null where unsupported (caller keeps running). */
async function acquireWakeLock(): Promise<WakeLockSentinel | null> {
  try {
    const nav = navigator as Navigator & { wakeLock?: { request: (k: string) => Promise<WakeLockSentinel> } };
    if (!nav.wakeLock) return null;
    return await nav.wakeLock.request('screen');
  } catch (err) {
    logger.warn('wake lock denied', err);
    return null;
  }
}

export function useRunEngine(callbacks: EngineCallbacks): void {
  const { onNotice, lang, units } = callbacks;
  const noticeRef = useRef(onNotice);
  noticeRef.current = onNotice;
  const langRef = useRef(lang);
  langRef.current = lang;
  const unitsRef = useRef(units);
  unitsRef.current = units;
  const startedAt = useRef(0);
  const cueSplitRef = useRef(0);
  const cueDistRef = useRef(0);
  const cueTimeRef = useRef(0);
  const lastHttpTry = useRef(0);
  const hydratedNextAt = useRef(HYDRATION_EVERY_S);

  useEffect(() => {
    const state = useRun.getState();
    if (state.phase !== 'active' || !state.sessionId || !state.setup) return;
    const sessionId = state.sessionId;
    const mode = state.setup.mode;
    startedAt.current = Date.now();
    hydratedNextAt.current = HYDRATION_EVERY_S;
    let last: { lat: number; lng: number; ts: number } | null = null;
    let lastSeen = Date.now();
    let stopped = false;
    let wake: WakeLockSentinel | null = null;
    void (async () => {
      wake = await acquireWakeLock();
    })();

    function statsTick(): void {
      if (stopped) return;
      const s = useRun.getState();
      if (s.phase !== 'active') return;
      const now = Date.now();
      s.setStats({
        ...s.stats,
        elapsedS: Math.round((now - startedAt.current) / 1000),
        stale: now - lastSeen > STALE_AFTER_S * 1000,
      });
      if (now - lastSeen > STALE_AFTER_S * 1000 && !s.stats.stale) {
        noticeRef.current({ kind: 'stale', text: 'stale' });
      }
    }
    const clock = window.setInterval(statsTick, 1000);

    function onVisible(): void {
      if (document.visibilityState === 'visible' && !stopped) {
        void (async () => {
          wake = await acquireWakeLock();
        })();
        // Backlog resend on return to foreground (reconnect path).
        void flushBacklog();
      }
    }
    document.addEventListener('visibilitychange', onVisible);

    async function flushBacklog(): Promise<void> {
      const pending = await unsentPoints({ sessionId, limit: FLUSH_LIMIT });
      if (pending.length === 0) return;
      // openapi `LocBatch`: phone timestamps (ISO UTC, forward-only),
      // accuracy in meters; the Dexie uuid stays local for `markSent`.
      const payload = pending.map((p) => ({
        ts: new Date(p.ts).toISOString(),
        lat: p.lat,
        lng: p.lng,
        acc: p.acc,
      }));
      if (socket.send({ type: 'loc.batch', session_id: sessionId, points: payload })) {
        await markSent(pending.map((p) => p.uuid));
        logger.info(`loc.batch resent ${payload.length} pts`);
        return;
      }
      // HTTP fallback to the live ingest (openapi `ingestLocations`).
      // A non-2xx keeps points buffered — never dropped, never rewritten.
      const now = Date.now();
      if (now - lastHttpTry.current < HTTP_RETRY_MS) return;
      lastHttpTry.current = now;
      try {
        await api('/courier/locations', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, points: payload }),
        });
        await markSent(pending.map((p) => p.uuid));
      } catch (err) {
        logger.warn('http fallback unavailable, points stay buffered', err);
      }
    }

    const batchTimer = window.setInterval(() => {
      if (!stopped) void flushBacklog();
    }, LOC_BATCH_S * 1000);

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        if (stopped) return;
        lastSeen = Date.now();
        const { latitude, longitude, accuracy, speed } = pos.coords;
        const ts = pos.timestamp || Date.now();
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
        if (accuracy > GPS_MAX_ACCURACY_M) return;
        const s = useRun.getState();
        if (s.phase !== 'active') return;
        let { distanceM, movingS, activeS, gapCount, gapS } = s.stats;
        if (last) {
          const dtS = (ts - last.ts) / 1000;
          const cls = classifySegment({
            distM: haversineM(last, { lat: latitude, lng: longitude }),
            dtS,
            gapAfterS: GAP_MARK_S,
            teleportMps: TELEPORT_MPS[mode],
          });
          if (cls === 'gap') {
            gapCount += 1;
            gapS += dtS;
            logger.warn(`gps gap ${Math.round(dtS)}s marked, not interpolated`);
            if (dtS > GAP_INVALID_S) noticeRef.current({ kind: 'gap', text: 'gap' });
          } else if (cls === 'teleport') {
            logger.warn('teleport fix rejected (anti-cheat signal)');
          } else {
            const d = haversineM(last, { lat: latitude, lng: longitude });
            distanceM += d;
            const v = dtS > 0 ? d / dtS : 0;
            if (cls === 'moving') movingS += dtS;
            if (v >= ACTIVE_MPS[mode]) activeS += dtS;
          }
          // Spoken split cue each completed km (or mile): number + pace/speed.
          const splitM = unitsRef.current === 'mi' ? 1609.34 : 1000;
          const unitWord = unitsRef.current === 'mi' ? 'Mile' : 'Kilometer';
          const splits = Math.floor(distanceM / splitM);
          if (splits > cueSplitRef.current) {
            cueSplitRef.current = splits;
            const splitDist = distanceM - cueDistRef.current;
            const splitTime = movingS - cueTimeRef.current;
            cueDistRef.current = distanceM;
            cueTimeRef.current = movingS;
            const pace = mode === 'biker'
              ? formatSpeed(splitTime, splitDist, unitsRef.current)
              : formatPace(splitTime, splitDist, unitsRef.current);
            speak(`${unitWord} ${splits}. ${pace}. Keep it easy.`, { lang: langRef.current });
          }
        }
        last = { lat: latitude, lng: longitude, ts };
        s.setStats({
          ...s.stats,
          distanceM,
          movingS: Math.round(movingS),
          activeS: Math.round(activeS),
          gapCount,
          gapS: Math.round(gapS),
          lastTs: ts,
          lastLat: latitude,
          lastLng: longitude,
          stale: false,
          elapsedS: Math.round((Date.now() - startedAt.current) / 1000),
        });
        const deliveryId = useDelivery.getState().active?.deliveryId ?? null;
        void bufferPoint({
          uuid: crypto.randomUUID(),
          sessionId,
          ts,
          lat: latitude,
          lng: longitude,
          acc: Math.round(accuracy),
          speedMps: typeof speed === 'number' && Number.isFinite(speed) ? speed : null,
          deliveryId,
          sent: 0,
        });
        if (activeS >= hydratedNextAt.current) {
          hydratedNextAt.current += HYDRATION_EVERY_S;
          noticeRef.current({ kind: 'hydration', text: 'hydration' });
          speak('Time for a sip of water.', { lang: langRef.current });
        }
      },
      (err) => {
        logger.warn('watchPosition error', err);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );

    void socket.connect();
    void flushBacklog();
    void pruneSentPoints();

    return () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      window.clearInterval(batchTimer);
      window.clearInterval(clock);
      document.removeEventListener('visibilitychange', onVisible);
      void flushBacklog();
      try {
        void wake?.release();
      } catch {
        /* lock already gone */
      }
    };
    // Engine binds once per session mount; callbacks flow through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
