/**
 * Merchant socket: single-use `/v1/ws/ticket` auth, `order.status` events,
 * live delivery frames (`delivery.eta`, `courier.location`), plus
 * forward-compatible staff/delivery notices. Reconnects with backoff.
 * Live frames carry real payloads (ETA seconds, courier dot) — the page
 * turns them into data refreshes, never into user-facing text. Unknown
 * frames are logged and dropped so internal frame names never leak into
 * the kitchen UI as notices.
 */
import { api } from '../../lib/api';
import { logger } from '../../lib/logger';

export type MerchantMsg =
  | { type: 'hello'; user_id: string }
  | { type: 'pong' }
  | { type: 'order.status'; order_id: string; status: string; delivery_status?: string }
  | { type: 'delivery.assigned'; delivery_id: string; order_id: string; courier_name?: string; courier_mode?: string; delivery_status?: string }
  | { type: 'merchant.status'; status: string }
  // Live delivery frames (backend dispatch): `delivery.eta` fires on route
  // (re)plans with fresh `eta_s`; `courier.location` streams the courier's
  // live dot roughly every ingest batch while a delivery is active.
  | { type: 'delivery.eta'; order_id: string; eta_s?: number }
  | { type: 'courier.location'; order_id: string; lat: number; lng: number; ts?: string }
  | { type: 'notice'; text: string };

type Handler = (msg: MerchantMsg) => void;

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const PING_MS = 25000;

/** Narrow one unknown WS frame into a MerchantMsg; null when unusable. */
export function parseMerchantMsg(raw: unknown): MerchantMsg | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (rec.type === 'hello' && typeof rec.user_id === 'string') return { type: 'hello', user_id: rec.user_id };
  if (rec.type === 'pong') return { type: 'pong' };
  if (rec.type === 'order.status' && typeof rec.order_id === 'string' && typeof rec.status === 'string') {
    const delivery = typeof rec.delivery_status === 'string' ? rec.delivery_status : undefined;
    const deliveryId = typeof rec.delivery_id === 'string' ? rec.delivery_id : undefined;
    void deliveryId;
    return { type: 'order.status', order_id: rec.order_id, status: rec.status, delivery_status: delivery };
  }
  if (rec.type === 'delivery.assigned' && typeof rec.order_id === 'string') {
    const name = typeof rec.courier_name === 'string' ? rec.courier_name : undefined;
    const mode = typeof rec.courier_mode === 'string' ? rec.courier_mode : undefined;
    const st = typeof rec.delivery_status === 'string' ? rec.delivery_status : undefined;
    const did = typeof rec.delivery_id === 'string' ? rec.delivery_id : '';
    return { type: 'delivery.assigned', order_id: rec.order_id, delivery_id: did, courier_name: name, courier_mode: mode, delivery_status: st };
  }
  if (rec.type === 'merchant.status' && typeof rec.status === 'string') {
    return { type: 'merchant.status', status: rec.status };
  }
  if (rec.type === 'delivery.eta' && typeof rec.order_id === 'string') {
    const eta = typeof rec.eta_s === 'number' && Number.isFinite(rec.eta_s) ? rec.eta_s : undefined;
    return { type: 'delivery.eta', order_id: rec.order_id, eta_s: eta };
  }
  if (rec.type === 'courier.location' && typeof rec.order_id === 'string' &&
    typeof rec.lat === 'number' && Number.isFinite(rec.lat) &&
    typeof rec.lng === 'number' && Number.isFinite(rec.lng)) {
    const ts = typeof rec.ts === 'string' ? rec.ts : undefined;
    return { type: 'courier.location', order_id: rec.order_id, lat: rec.lat, lng: rec.lng, ts };
  }
  if (rec.type === 'notice' && typeof rec.text === 'string') {
    return { type: 'notice', text: rec.text };
  }
  if (typeof rec.type === 'string') {
    logger.warn('merchant ws: dropped unknown frame', { type: rec.type });
  }
  return null;
}

export class MerchantSocket {
  private ws: WebSocket | null = null;
  private handlers = new Set<Handler>();
  private failures = 0;
  private wanted = false;
  private pingTimer: number | null = null;

  /** True while the underlying socket is open. */
  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  onMessage(handler: Handler): () => void {
    this.handlers.add(handler);
    return () => {
      this.handlers.delete(handler);
    };
  }

  /** Open the socket (fetches a fresh single-use ticket first). */
  async connect(): Promise<void> {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return;
    let ticket: string;
    try {
      const res = await api<{ ticket: string }>('/ws/ticket', { method: 'POST' });
      ticket = res.ticket;
    } catch {
      logger.warn('merchant ws ticket failed, will retry');
      this.scheduleReconnect();
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/v1/ws?ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.failures = 0;
      logger.info('merchant ws open');
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.sendPing(), PING_MS);
    };
    ws.onmessage = (ev: MessageEvent) => {
      let raw: unknown;
      try {
        raw = JSON.parse(ev.data as string) as unknown;
      } catch {
        logger.warn('merchant ws: dropped non-JSON frame');
        return;
      }
      const msg = parseMerchantMsg(raw);
      if (!msg) return;
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = () => {
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = null;
      if (this.ws === ws) this.ws = null;
      if (this.wanted) this.scheduleReconnect();
    };
    ws.onerror = () => {
      ws.close();
    };
  }

  /** Stop reconnecting and close the socket. */
  disconnect(): void {
    this.wanted = false;
    this.failures = 0;
    try {
      this.ws?.close();
    } catch {
      /* already closed */
    }
    this.ws = null;
  }

  private sendPing(): void {
    try {
      this.ws?.send(JSON.stringify({ type: 'ping' }));
    } catch (err) {
      logger.warn('merchant ws ping failed', { err: err instanceof Error ? err.message : 'unknown' });
    }
  }

  private scheduleReconnect(): void {
    const wait = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 30000;
    this.failures += 1;
    logger.info(`merchant ws reconnect in ${String(wait)}ms`);
    window.setTimeout(() => {
      if (this.wanted) void this.connect();
    }, wait);
  }
}

/** One shared socket for the whole Merchant PWA. */
export const merchantSocket = new MerchantSocket();
