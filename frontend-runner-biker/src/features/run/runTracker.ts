/**
 * Run tracker — the one GPS engine for the active work session: GPS watch →
 * accuracy gate → stats → IndexedDB buffer → WS `loc.batch` every 5 s, HTTP
 * fallback, reconnect backlog resend, gap marking, heartbeat, Wake Lock.
 * Gaps are recorded and shown — never interpolated.
 *
 * Framework-free on purpose: `WorkSessionTracker` (mounted once beside the
 * routes) starts it while a signed-in courier has an active session and
 * stops it when the session ends, so the watch and the uploads keep running
 * on every screen — Delivery, Chat, Orders, Wallet — and the customer's live
 * dot and the kitchen ETA never freeze mid-delivery. A module slot keeps at
 * most one tracker alive and the uploader is single-flight, so a remount or
 * restart can never double the watch or send one backlog twice. Screens only
 * read the run store.
 */
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
  resolveCourierLocale,
  type CourierMode,
  type Units,
} from '../../lib/format';
import { bufferPoint, markSent, pruneSentPoints, unsentPoints, type BufferedPoint } from '../../lib/db';
import { classifySegment, haversineM } from '../../lib/geo';
import { logger } from '../../lib/logger';
import { socket } from '../../lib/ws';
import { api } from '../../lib/api';
import { speak } from '../../lib/notify';
import i18n from '../../i18n';
import { useDelivery } from '../delivery/deliveryStore';
import { saveStatsSnapshot, useRun } from './sessionStore';
import { createSingleFlight, createTrackerSlot } from './trackerLifecycle';
import type { RunStats } from './types';
import { useStaff } from '../staff/staffStore';

const TELEPORT_MPS: Record<CourierMode, number> = { runner: 25 / 3.6, biker: 50 / 3.6 };
const FLUSH_LIMIT = 200;
const HTTP_RETRY_MS = 30000;
// Consecutive fixes dropped by the accuracy gate before the signal reads
// `weak`: at ~1 fix/s this is a few seconds of indoor-grade GPS, not a blip.
const WEAK_REJECT_LIMIT = 6;
/** Stats clock tick (elapsed time, stale check). */
const CLOCK_TICK_MS = 1000;
/** Refresh-resume snapshot cadence (localStorage, not every tick). */
const SNAPSHOT_EVERY_MS = 5000;
/** Watch + one-shot seed timeout. */
const GEO_TIMEOUT_MS = 15000;
/** The one-shot seed may reuse an OS fix this old (fast first position). */
const SEED_MAX_AGE_MS = 60000;
/** Total geolocation silence after which the provider counts as absent. */
const SILENCE_AFTER_MS = 20000;
/** Re-seed cadence while the signal is waiting/unavailable. */
const RESEED_EVERY_MS = 30000;
const METERS_PER_KM = 1000;
const METERS_PER_MILE = 1609.34;

type WakeLockSentinel = { release: () => Promise<void> };

/** Last accepted fix (or heartbeat re-buffer) the next segment joins to. */
type LastFix = { lat: number; lng: number; ts: number; acc: number };

/** Spoken-cue counters: per-km/mi split and the hydration reminder. */
type CueState = { splits: number; distM: number; movingS: number; hydrateAtS: number };

/** Acquire a screen Wake Lock; null where unsupported (tracking continues). */
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

/** Release a held lock; one the browser already dropped is fine. */
function releaseWakeLock(lock: WakeLockSentinel | null): void {
  if (!lock) return;
  void (async () => {
    try {
      await lock.release();
    } catch {
      /* lock already gone */
    }
  })();
}

/** Fire-and-forget an IndexedDB chore: failures are logged, never thrown. */
function background(label: string, task: () => Promise<void>): void {
  void (async () => {
    try {
      await task();
    } catch (err) {
      logger.warn(label, err);
    }
  })();
}

/** Buffer one point for streaming, tagged with the live delivery (if any). */
function queuePoint(point: Omit<BufferedPoint, 'uuid' | 'deliveryId' | 'sent'>): void {
  const deliveryId = useDelivery.getState().active?.deliveryId ?? null;
  background('gps point not buffered', () =>
    bufferPoint({ ...point, uuid: crypto.randomUUID(), deliveryId, sent: 0 }),
  );
}

/** Seed cue counters from restored stats so a reload never replays old cues. */
function seedCues(stats: RunStats, units: Units): CueState {
  const splitM = units === 'mi' ? METERS_PER_MILE : METERS_PER_KM;
  return {
    splits: Math.floor(stats.distanceM / splitM),
    distM: stats.distanceM,
    movingS: stats.movingS,
    hydrateAtS: (Math.floor(stats.activeS / HYDRATION_EVERY_S) + 1) * HYDRATION_EVERY_S,
  };
}

/** Last HTTP-fallback attempt: one uploader, one throttle across restarts. */
let lastHttpTryAt = 0;

/** Stream the oldest unsent points: WS `loc.batch` first, throttled HTTP fallback. */
async function sendBacklog(fallbackSessionId: string): Promise<void> {
  // Live id, not the bind-time one: a boot resume can adopt a fresh server
  // session (old row ended while away), and the backlog it re-tagged must
  // stream under the new id.
  const sid = useRun.getState().sessionId ?? fallbackSessionId;
  const pending = await unsentPoints({ sessionId: sid, limit: FLUSH_LIMIT });
  if (pending.length === 0) return;
  // openapi `LocBatch`: phone timestamps (ISO UTC, forward-only),
  // accuracy in meters; the Dexie uuid stays local for `markSent`.
  const payload = pending.map((p) => ({
    ts: new Date(p.ts).toISOString(),
    lat: p.lat,
    lng: p.lng,
    acc: p.acc,
  }));
  const uuids = pending.map((p) => p.uuid);
  if (socket.send({ type: 'loc.batch', session_id: sid, points: payload })) {
    await markSent(uuids);
    logger.info(`loc.batch resent ${payload.length} pts`);
    return;
  }
  // HTTP fallback to the live ingest (openapi `ingestLocations`).
  // A non-2xx keeps points buffered — never dropped, never rewritten.
  const now = Date.now();
  if (now - lastHttpTryAt < HTTP_RETRY_MS) return;
  lastHttpTryAt = now;
  try {
    await api('/courier/locations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ session_id: sid, points: payload }),
    });
    await markSent(uuids);
  } catch (err) {
    logger.warn('http fallback unavailable, points stay buffered', err);
  }
}

/**
 * Single-flight uploader: the batch tick, the foreground resend and the
 * final flush on stop never overlap, so one backlog is never sent twice
 * (and never out of timestamp order).
 */
const flushBacklog = createSingleFlight(async (fallbackSessionId: string) => {
  try {
    await sendBacklog(fallbackSessionId);
  } catch (err) {
    logger.warn('backlog flush failed, points stay buffered', err);
  }
});

/** Bind one GPS watch + batch loop to `sessionId`; returns its stop. */
function bindRunTracker(sessionId: string): () => void {
  const boot = useRun.getState();
  if (boot.phase !== 'active' || !boot.setup) return () => undefined;
  const mode = boot.setup.mode;
  // Refresh continuity: the store boots from the persisted snapshot, so a
  // reload resumes the same counters instead of zeroing them. Seeding
  // `last` from the snapshot also means the first post-reload fix classifies
  // the reload silence honestly (gap marking) instead of silently joining
  // two points minutes apart.
  const startedAt = Date.now() - Math.max(0, Math.round(boot.stats.elapsedS || 0)) * 1000;
  const cues = seedCues(boot.stats, resolveCourierLocale(i18n.language).units);
  let last: LastFix | null =
    boot.stats.lastLat != null && boot.stats.lastLng != null
      ? { lat: boot.stats.lastLat, lng: boot.stats.lastLng, ts: boot.stats.lastTs ?? Date.now(), acc: GPS_MAX_ACCURACY_M }
      : null;
  let lastSeen = Date.now();
  let lastBufferedAt = 0;
  let lastSavedAt = 0;
  let stopped = false;
  let wake: WakeLockSentinel | null = null;
  // Consecutive fixes dropped by the accuracy gate before the run screen
  // calls the signal `weak` (indoor-grade GPS). Reset by any accepted fix.
  let weakRejects = 0;
  // Positioning telemetry for the "no fix at all" watchdog below: any
  // callback (fix, rejection path, or error) proves the OS provider exists.
  let geoCallbackSeen = false;
  // Consecutive TIMEOUTs with no other signal: the provider is silent
  // (typical on desktops without GPS, even with permission granted).
  let geoTimeouts = 0;
  const geo: Geolocation | null = 'geolocation' in navigator ? navigator.geolocation : null;

  async function holdWakeLock(): Promise<void> {
    const lock = await acquireWakeLock();
    // Stopped while the request was pending (session ended, remount):
    // hand the lock straight back instead of leaking it.
    if (stopped) {
      releaseWakeLock(lock);
      return;
    }
    wake = lock;
  }

  function statsTick(): void {
    if (stopped) return;
    const s = useRun.getState();
    if (s.phase !== 'active') return;
    const now = Date.now();
    // Liveness matches the server's view: dispatch keeps a courier
    // eligible while location batches arrive (last_seen_at < 60 s), and
    // the heartbeat below re-buffers the last fix every batch tick — a
    // stationary courier waiting near a kitchen fires no watchPosition
    // callbacks yet is exactly who should receive offers. Marking stale
    // from watchPosition alone silently blocked those offers.
    const freshAt = Math.max(lastSeen, lastBufferedAt);
    const stale = now - freshAt > STALE_AFTER_S * 1000;
    const next = { ...s.stats, elapsedS: Math.round((now - startedAt) / 1000), stale };
    s.setStats(next);
    // Persist counters so a page reload resumes the run instead of zeroing
    // it (throttled: localStorage every 5 s, not every tick).
    if (now - lastSavedAt > SNAPSHOT_EVERY_MS) {
      lastSavedAt = now;
      saveStatsSnapshot(next);
    }
    if (stale && !s.stats.stale) s.addNotice('stale');
    // Notices outlive the Run screen now: "tracking paused" goes once fresh.
    if (!stale) s.clearNotice('stale');
  }

  function onVisible(): void {
    if (document.visibilityState !== 'visible' || stopped) return;
    void holdWakeLock();
    // Backlog resend on return to foreground (reconnect path).
    void flushBacklog(sessionId);
  }

  function batchTick(): void {
    if (stopped) return;
    // Heartbeat: a stationary courier's watchPosition never fires, so
    // without this the server's 60 s dispatch window drops them and offers
    // stop. Re-buffer the last fix with a fresh timestamp (same position:
    // zero distance, keeps last_seen_at alive, never invents movement).
    const now = Date.now();
    if (last && now - lastBufferedAt >= LOC_BATCH_S * 1000) {
      const s = useRun.getState();
      if (s.phase === 'active') {
        queuePoint({ sessionId: s.sessionId ?? sessionId, ts: now, lat: last.lat, lng: last.lng, acc: last.acc, speedMps: null });
        lastBufferedAt = now;
        last = { ...last, ts: now };
      }
    }
    void flushBacklog(sessionId);
  }

  function noteDenied(): void {
    weakRejects = 0;
    useRun.getState().setGps('denied');
    logger.warn('geolocation denied — offers wait for location permission');
  }

  function noteRejectedAccuracy(): void {
    weakRejects += 1;
    if (weakRejects >= WEAK_REJECT_LIMIT) {
      const sig = useRun.getState().gps;
      if (sig === 'waiting' || sig === 'ok') useRun.getState().setGps('weak');
    }
  }

  function noteUnavailable(): void {
    const sig = useRun.getState().gps;
    if (sig === 'waiting') {
      useRun.getState().setGps('unavailable');
      logger.warn('geolocation silent — no position from this device');
    }
  }

  /** Spoken split cue each completed km (or mile): number + pace/speed. */
  function announceSplit(distanceM: number, movingS: number): void {
    // Staff mode is a restaurant delivery, not a workout: no split coaching.
    if (useStaff.getState().active) return;
    const { lang, units } = resolveCourierLocale(i18n.language);
    const splits = Math.floor(distanceM / (units === 'mi' ? METERS_PER_MILE : METERS_PER_KM));
    if (splits <= cues.splits) return;
    cues.splits = splits;
    const splitDist = distanceM - cues.distM;
    const splitTime = movingS - cues.movingS;
    cues.distM = distanceM;
    cues.movingS = movingS;
    const unitWord = units === 'mi' ? 'Mile' : 'Kilometer';
    const pace = mode === 'biker' ? formatSpeed(splitTime, splitDist, units) : formatPace(splitTime, splitDist, units);
    speak(`${unitWord} ${splits}. ${pace}. Keep it easy.`, { lang });
  }

  /** One accepted fix: stats + buffer + signal. Shared by the continuous
   * watch and the one-shot seed below so both paths stay identical. */
  function acceptFix(fix: { lat: number; lng: number; acc: number; speed: number | null; ts: number }): void {
    if (stopped) return;
    lastSeen = Date.now();
    weakRejects = 0;
    const s = useRun.getState();
    if (s.phase !== 'active') return;
    if (s.gps !== 'ok') s.setGps('ok');
    const { lat, lng, acc, speed, ts } = fix;
    let { distanceM, movingS, activeS, gapCount, gapS } = s.stats;
    if (last) {
      const dtS = (ts - last.ts) / 1000;
      const distM = haversineM(last, { lat, lng });
      const cls = classifySegment({ distM, dtS, gapAfterS: GAP_MARK_S, teleportMps: TELEPORT_MPS[mode] });
      if (cls === 'gap') {
        gapCount += 1;
        gapS += dtS;
        logger.warn(`gps gap ${Math.round(dtS)}s marked, not interpolated`);
        if (dtS > GAP_INVALID_S) s.addNotice('gap');
      } else if (cls === 'teleport') {
        logger.warn('teleport fix rejected (anti-cheat signal)');
      } else {
        distanceM += distM;
        const v = dtS > 0 ? distM / dtS : 0;
        if (cls === 'moving') movingS += dtS;
        if (v >= ACTIVE_MPS[mode]) activeS += dtS;
      }
      announceSplit(distanceM, movingS);
    }
    last = { lat, lng, ts, acc };
    s.setStats({
      ...s.stats,
      distanceM,
      movingS: Math.round(movingS),
      activeS: Math.round(activeS),
      gapCount,
      gapS: Math.round(gapS),
      lastTs: ts,
      lastLat: lat,
      lastLng: lng,
      stale: false,
      elapsedS: Math.round((Date.now() - startedAt) / 1000),
    });
    lastBufferedAt = Date.now();
    queuePoint({
      sessionId: s.sessionId ?? sessionId,
      ts,
      lat,
      lng,
      acc,
      speedMps: typeof speed === 'number' && Number.isFinite(speed) ? speed : null,
    });
    if (activeS >= cues.hydrateAtS) {
      cues.hydrateAtS += HYDRATION_EVERY_S;
      s.addNotice('hydration');
      if (!useStaff.getState().active) speak('Time for a sip of water.', { lang: resolveCourierLocale(i18n.language).lang });
    }
  }

  /** Guard rail shared by watch + seed: finite coords inside the accuracy
   * gate become a fix; anything else is counted (weak) or ignored, never
   * buffered — the server must never see a position we don't trust. */
  function handlePos(pos: GeolocationPosition): void {
    if (stopped) return;
    geoCallbackSeen = true;
    const { latitude, longitude, accuracy, speed } = pos.coords;
    const ts = pos.timestamp || Date.now();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return;
    // lastSeen tracks watch callbacks; accepted fixes (above) plus the
    // heartbeat track server-visible liveness inside statsTick.
    lastSeen = Date.now();
    if (!Number.isFinite(accuracy) || accuracy > GPS_MAX_ACCURACY_M) {
      noteRejectedAccuracy();
      return;
    }
    acceptFix({ lat: latitude, lng: longitude, acc: Math.round(accuracy), speed, ts });
  }

  function handleGeoError(err: { code?: number }): void {
    if (stopped) return;
    geoCallbackSeen = true;
    // 1 = PERMISSION_DENIED: surface it so the run screen can say how to
    // fix it instead of silently aging into `stale` with no offers.
    if (err?.code === 1) {
      noteDenied();
    } else if (err?.code === 2) {
      // POSITION_UNAVAILABLE: provider exists but has no position (tunnels,
      // OS location off). The reseed below keeps probing; the banner says
      // what to do meanwhile.
      noteUnavailable();
    } else if (err?.code === 3) {
      // TIMEOUT with nothing else heard: watch + seed both waited 15 s for
      // a provider that never answered. Two in a row means silent hardware.
      geoTimeouts += 1;
      if (geoTimeouts >= 2) noteUnavailable();
    }
    logger.warn('watchPosition error', err);
  }

  /** One-shot position: a cached/OS-level fix through the same guards. */
  function seedPosition(): void {
    try {
      geo?.getCurrentPosition(handlePos, handleGeoError, {
        enableHighAccuracy: true,
        timeout: GEO_TIMEOUT_MS,
        maximumAge: SEED_MAX_AGE_MS,
      });
    } catch {
      /* unsupported — the continuous watch owns positioning */
    }
  }

  void holdWakeLock();
  const clock = window.setInterval(statsTick, CLOCK_TICK_MS);
  document.addEventListener('visibilitychange', onVisible);
  const batchTimer = window.setInterval(batchTick, LOC_BATCH_S * 1000);

  // No Geolocation API at all: say so honestly instead of crashing every
  // screen (the tracker is app-wide); the clock and backlog keep running.
  if (!geo) noteUnavailable();
  const watchId = geo
    ? geo.watchPosition(handlePos, handleGeoError, { enableHighAccuracy: true, maximumAge: 0, timeout: GEO_TIMEOUT_MS })
    : null;

  // One-shot seed: the continuous watch can take 10–60 s for its first
  // fix (cold GPS, indoors), during which dispatch and the CMS see nothing
  // and offers can't flow. A cached/OS-level fix gets the session visible
  // in seconds; the same guards above still apply.
  seedPosition();

  void socket.connect();
  void flushBacklog(sessionId);
  background('sent-point prune failed', pruneSentPoints);

  // Silent-provider watchdog: permission granted but the OS never answers
  // (desktop without GPS, location services off) leaves the signal on
  // `waiting` forever with no error callback at all. After 20 s of total
  // silence say so honestly instead of promising a lock that can't come.
  const silenceTimer = window.setTimeout(() => {
    if (!stopped && !geoCallbackSeen) noteUnavailable();
  }, SILENCE_AFTER_MS);

  // Re-seed while unfixed: a provider that appears late (toggled services,
  // first lock after moving outside) is picked up within ~30 s without a
  // reload. Stops the moment a fix is accepted.
  const reseedTimer = window.setInterval(() => {
    if (stopped || useRun.getState().phase !== 'active') return;
    const sig = useRun.getState().gps;
    if (sig !== 'waiting' && sig !== 'unavailable') return;
    seedPosition();
  }, RESEED_EVERY_MS);

  return () => {
    stopped = true;
    if (geo && watchId !== null) geo.clearWatch(watchId);
    window.clearInterval(batchTimer);
    window.clearInterval(clock);
    window.clearInterval(reseedTimer);
    window.clearTimeout(silenceTimer);
    document.removeEventListener('visibilitychange', onVisible);
    // Final flush: whatever is buffered leaves now (or on the next start).
    void flushBacklog(sessionId);
    releaseWakeLock(wake);
    wake = null;
  };
}

/** The single tracker slot: at most one GPS watch + batch loop app-wide. */
const slot = createTrackerSlot(bindRunTracker);

// Dev hot reload must not orphan a live watcher from the old module copy.
import.meta.hot?.dispose(() => slot.stop());

/** Track `sessionId` (no-op when already tracking it; replaces another id). */
export function startRunTracking(sessionId: string): void {
  slot.ensure(sessionId);
}

/** Stop tracking: clear the watch + timers, final flush, release Wake Lock. */
export function stopRunTracking(): void {
  slot.stop();
}
