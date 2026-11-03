/**
 * Web Push opt-in for courier offer alerts. Best effort, always from a user
 * tap ("Go online", the /checklist notifications row): permission → service
 * worker → `GET /push/vapid-public-key` → `pushManager.subscribe` →
 * `POST /push/subscribe {app: "courier", subscription}`. `src/sw.ts` renders
 * the pushes. Never throws: every outcome resolves to a `PushState`; skips
 * and failures go to the logger, never to the UI.
 */
import { APP, api } from './api';
import { logger } from './logger';

/** Outcome of one opt-in attempt. */
export type PushState = 'subscribed' | 'denied' | 'unsupported' | 'failed';

function pushSupported(): boolean {
  return 'Notification' in window && 'serviceWorker' in navigator && 'PushManager' in window;
}

function skip(state: 'denied' | 'unsupported', reason: string): PushState {
  logger.info(`offer push skipped: ${reason}`);
  return state;
}

/** Decode the base64url VAPID public key into `applicationServerKey` bytes. */
function vapidKeyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const pad = '='.repeat((4 - (base64url.length % 4)) % 4);
  const raw = window.atob((base64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (ch) => ch.charCodeAt(0));
}

/** `GET /push/vapid-public-key`, narrowed to its key ('' when absent). */
async function fetchVapidKey(): Promise<string> {
  const res = await api<unknown>('/push/vapid-public-key');
  if (typeof res !== 'object' || res === null) return '';
  const key = (res as Record<string, unknown>)['public_key'];
  return typeof key === 'string' ? key.trim() : '';
}

/** True when a subscription was made with this server key; a rotated VAPID
 * pair (e.g. after a database reset) needs a fresh subscription. */
function sameServerKey(sub: PushSubscription, key: Uint8Array<ArrayBuffer>): boolean {
  const current = sub.options.applicationServerKey;
  if (!current) return false;
  const bytes = new Uint8Array(current);
  return bytes.length === key.length && bytes.every((b, i) => b === key[i]);
}

/** Reuse this device's subscription when it matches the key, else (re)subscribe. */
async function deviceSubscription(args: {
  reg: ServiceWorkerRegistration;
  key: Uint8Array<ArrayBuffer>;
}): Promise<PushSubscription> {
  const existing = await args.reg.pushManager.getSubscription();
  if (existing && sameServerKey(existing, args.key)) return existing;
  if (existing) await existing.unsubscribe();
  return args.reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: args.key });
}

/** Subscribe once permission is granted. Re-sending an existing subscription
 * is safe: the API upserts by endpoint (and re-links it to this account). */
async function registerDevice(): Promise<PushState> {
  // No registration means no service worker (the Vite dev server), where
  // `serviceWorker.ready` would never settle.
  if (!(await navigator.serviceWorker.getRegistration())) return skip('unsupported', 'no service worker');
  const reg = await navigator.serviceWorker.ready;
  const key = await fetchVapidKey();
  if (key === '') {
    logger.warn('offer push failed: server sent no VAPID key');
    return 'failed';
  }
  const sub = await deviceSubscription({ reg, key: vapidKeyBytes(key) });
  await api<unknown>('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app: APP, subscription: sub.toJSON() }),
  });
  logger.info('offer push subscribed');
  return 'subscribed';
}

/**
 * Ask for notification permission and register this device for offer pushes.
 * Call straight from a click handler (the prompt needs the tap) and don't
 * await it on a critical path: it resolves 'denied'/'unsupported' silently
 * and 'failed' on any error (logged), never throws.
 */
export async function subscribeOfferPush(): Promise<PushState> {
  if (!pushSupported()) return skip('unsupported', 'push APIs missing');
  if (Notification.permission === 'denied') return skip('denied', 'notifications blocked');
  try {
    // First await on purpose: the permission prompt must open inside the tap.
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return skip('denied', `permission ${permission}`);
    return await registerDevice();
  } catch (err) {
    logger.warn('offer push failed', err instanceof Error ? err.message : err);
    return 'failed';
  }
}
