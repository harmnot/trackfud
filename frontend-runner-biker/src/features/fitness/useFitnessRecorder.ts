/**
 * GPS fitness recorder: distance / moving / elapsed from `watchPosition`.
 *
 * Backend truth (internal/app/fitness.go + config):
 * - moving counts only when speed >= 0.5 m/s (MinMovingSpeedMps) and the
 *   segment gap is <= 30 s (SegmentMaxGapS); longer gaps still count toward
 *   elapsed and max_gap but never toward moving time.
 * - fixes with accuracy > 30 m are skipped (ingest rule).
 * - teleports (>200 m in <5 s) and speed spikes above the mode max are
 *   excluded from distance (runner 25 km/h, biker 50 km/h).
 *
 * The old recorder updated `elapsed` only inside the GPS callback (so it
 * froze when the fix stalled) and used a 0.8 m/s threshold with no gap cap —
 * moving time under-counted while standing and over-counted across gaps.
 * This hook ticks `elapsed` on a 1 s interval from `startTs` and accumulates
 * moving time with the same 0.5 m/s + 30 s cap the server evaluates, so the
 * live numbers match the evaluated result.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type FitnessMode = 'runner' | 'biker';

const MIN_MOVING_MPS = 0.5;
const SEGMENT_MAX_GAP_S = 30;
const MAX_ACCURACY_M = 30;
const RUNNER_MAX_MPS = 25 / 3.6;
const BIKER_MAX_MPS = 50 / 3.6;

function haversineM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

export interface RecorderState {
  recording: boolean;
  distanceM: number;
  movingS: number;
  elapsedS: number;
  points: number;
  maxGapS: number;
}

export function useFitnessRecorder(mode: FitnessMode): RecorderState & {
  start: () => void;
  stop: () => void;
} {
  const [recording, setRecording] = useState(false);
  const [dist, setDist] = useState(0);
  const [movingFloat, setMovingFloat] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [points, setPoints] = useState(0);
  const [maxGap, setMaxGap] = useState(0);

  const watch = useRef<number | null>(null);
  const last = useRef<{ lat: number; lng: number; ts: number } | null>(null);
  const startTs = useRef(0);
  const timer = useRef<number | null>(null);
  const maxGapRef = useRef(0);
  const modeRef = useRef<FitnessMode>(mode);
  modeRef.current = mode;

  const clear = useCallback(() => {
    if (watch.current !== null) {
      navigator.geolocation.clearWatch(watch.current);
      watch.current = null;
    }
    if (timer.current !== null) {
      window.clearInterval(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => clear, [clear]);

  const start = useCallback(() => {
    clear();
    setDist(0);
    setMovingFloat(0);
    setElapsed(0);
    setPoints(0);
    setMaxGap(0);
    maxGapRef.current = 0;
    last.current = null;
    startTs.current = Date.now();
    setRecording(true);
    // Elapsed ticks every second from the wall clock — independent of GPS
    // fixes, so standing still still counts elapsed (and the max-gap rule).
    timer.current = window.setInterval(() => {
      setElapsed(Math.max(0, Math.round((Date.now() - startTs.current) / 1000)));
    }, 1000);
    watch.current = navigator.geolocation.watchPosition(
      (pos) => {
        const acc = typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : 0;
        if (acc > MAX_ACCURACY_M) return;
        const cur = { lat: pos.coords.latitude, lng: pos.coords.longitude, ts: Date.now() };
        setPoints((v) => v + 1);
        if (last.current) {
          const prev = last.current;
          const dt = (cur.ts - prev.ts) / 1000;
          if (dt <= 0) {
            last.current = cur;
            return;
          }
          if (dt > maxGapRef.current) {
            maxGapRef.current = dt;
            setMaxGap(Math.round(dt));
          }
          const d = haversineM(prev, cur);
          const speed = d / dt;
          const maxSpeed = modeRef.current === 'biker' ? BIKER_MAX_MPS : RUNNER_MAX_MPS;
          // Teleport or spike: skip the segment (flagged server-side for review).
          if ((d > 200 && dt < 5) || speed > maxSpeed) {
            last.current = cur;
            return;
          }
          if (d > 0) setDist((v) => v + d);
          // Moving only on fresh, plausible motion — same rule as the server.
          if (speed >= MIN_MOVING_MPS && dt <= SEGMENT_MAX_GAP_S) {
            setMovingFloat((v) => v + dt);
          }
        }
        last.current = cur;
      },
      undefined,
      { enableHighAccuracy: true },
    );
  }, [clear]);

  const stop = useCallback(() => {
    clear();
    setElapsed(Math.max(0, Math.round((Date.now() - startTs.current) / 1000)));
    setRecording(false);
  }, [clear]);

  return {
    recording,
    distanceM: dist,
    movingS: Math.round(movingFloat),
    elapsedS: elapsed,
    points,
    maxGapS: maxGap,
    start,
    stop,
  };
}
