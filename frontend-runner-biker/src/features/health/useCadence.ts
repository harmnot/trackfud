/**
 * Step cadence for runners (P1 anti-cheat/health signal): counts steps from
 * `DeviceMotionEvent` with a peak detector and reports steps/min over a
 * rolling 60 s window. iOS needs `requestPermission()` from a tap — call
 * `enable()` from the Run Mode "enable" button. Bikers see it as
 * unavailable-by-design (pedals, not steps).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { logger } from '../../lib/logger';

const PEAK_G = 1.18;
const REFRACTORY_MS = 240;
const WINDOW_MS = 60_000;

type Cadence = {
  /** False on desktop / biker mode / denied permission (display hides). */
  supported: boolean;
  steps: number;
  /** Steps per minute over the rolling window. */
  spm: number;
  /** Request motion permission (iOS) and start counting. Call from a tap. */
  enable: () => void;
};

/** Peak-detector step counting over the device accelerometer. */
export function useCadence(args: { enabled: boolean }): Cadence {
  const [supported, setSupported] = useState(false);
  const [steps, setSteps] = useState(0);
  const [spm, setSpm] = useState(0);
  const stamps = useRef<number[]>([]);
  const lastPeak = useRef(0);
  const wasAbove = useRef(false);

  const enable = useCallback(() => {
    const d = window as unknown as {
      DeviceMotionEvent?: { requestPermission?: () => Promise<string> } & typeof DeviceMotionEvent;
    };
    if (!d.DeviceMotionEvent) {
      setSupported(false);
      return;
    }
    const start = (): void => setSupported(true);
    if (d.DeviceMotionEvent.requestPermission) {
      void d.DeviceMotionEvent.requestPermission()
        .then((p) => {
          if (p === 'granted') start();
        })
        .catch((err: unknown) => logger.warn('motion permission denied', err));
      return;
    }
    start();
  }, []);

  useEffect(() => {
    if (!args.enabled || !supported) return;
    function onMotion(ev: DeviceMotionEvent): void {
      const a = ev.accelerationIncludingGravity;
      if (!a || a.x === null || a.y === null || a.z === null) return;
      const g = Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z) / 9.81;
      const now = Date.now();
      if (g > PEAK_G && !wasAbove.current && now - lastPeak.current > REFRACTORY_MS) {
        wasAbove.current = true;
        lastPeak.current = now;
        stamps.current = [...stamps.current.filter((t) => now - t < WINDOW_MS), now];
        setSteps((s) => s + 1);
        setSpm(Math.round((stamps.current.length / Math.min(WINDOW_MS, Math.max(10_000, now - (stamps.current[0] ?? now) + 1))) * 60_000));
      } else if (g < PEAK_G * 0.97) {
        wasAbove.current = false;
      }
    }
    window.addEventListener('devicemotion', onMotion);
    return () => window.removeEventListener('devicemotion', onMotion);
  }, [args.enabled, supported]);

  return { supported, steps, spm, enable };
}
