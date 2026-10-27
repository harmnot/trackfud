/**
 * Web Push subscription for order + staff-fallback notices. Permission is
 * requested from the "Start receiving orders" tap; the service worker
 * (`src/sw.ts`) already renders incoming pushes as notifications.
 */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';

export type PushState = 'subscribed' | 'denied' | 'unsupported' | 'failed';

function b64ToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const raw = window.atob(padded);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/**
 * Subscribe this device for push. Safe to call repeatedly: an existing
 * subscription is reused and re-sent to the API.
 */
export async function ensureKitchenPush(): Promise<PushState> {
  if (!('Notification' in window) || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return 'unsupported';
  }
  try {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') return 'denied';
    const reg = await navigator.serviceWorker.ready;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await sendSubscription({ subscription: existing });
      return 'subscribed';
    }
    const { public_key } = await api<{ public_key: string }>('/push/vapid-public-key');
    if (!public_key) return 'failed';
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: b64ToBytes(public_key).buffer as ArrayBuffer,
    });
    await sendSubscription({ subscription: sub });
    return 'subscribed';
  } catch (e) {
    logger.warn('kitchen push failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    return 'failed';
  }
}

async function sendSubscription(params: { subscription: PushSubscription }): Promise<void> {
  const json = params.subscription.toJSON();
  await api('/push/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ endpoint: json.endpoint, p256dh: json.keys?.p256dh, auth: json.keys?.auth }),
  });
}
