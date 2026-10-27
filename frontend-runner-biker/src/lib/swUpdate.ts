/**
 * Service-worker update prompt with a mid-run guard: a new version never
 * interrupts an active session. While `tb:courier:midrun` is set the
 * prompt waits and re-checks every 30 s; the worker still installs.
 */
import { logger } from './logger';
import { isMidRun } from '../features/run/sessionStore';

const RECHECK_MS = 30000;

/** Watch for an installed-but-waiting worker and call back when safe. */
export function watchSwUpdates(onReady: () => void): void {
  if (!('serviceWorker' in navigator)) return;
  let fired = false;
  function ready(): void {
    if (fired) return;
    if (isMidRun()) {
      window.setTimeout(ready, RECHECK_MS);
      return;
    }
    fired = true;
    onReady();
  }
  void watchReady(ready);
}

async function watchReady(ready: () => void): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    if (reg.waiting && navigator.serviceWorker.controller) {
      ready();
      return;
    }
    reg.addEventListener('updatefound', () => {
      const next = reg.installing;
      if (!next) return;
      next.addEventListener('statechange', () => {
        if (next.state === 'installed' && navigator.serviceWorker.controller) ready();
      });
    });
  } catch (err) {
    logger.warn('sw watch failed', err);
  }
}

/** Activate the waiting worker now (user tapped reload outside a run). */
export function activateUpdate(): void {
  void activateWaiting();
  navigator.serviceWorker.addEventListener('controllerchange', () => window.location.reload(), {
    once: true,
  });
}

async function activateWaiting(): Promise<void> {
  try {
    const reg = await navigator.serviceWorker.ready;
    reg.waiting?.postMessage({ type: 'SKIP_WAITING' });
  } catch (err) {
    logger.warn('sw activate failed', err);
  }
}
