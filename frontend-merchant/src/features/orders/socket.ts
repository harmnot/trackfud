/**
 * Merchant socket: single-use `/v1/ws/ticket` auth, `order.status` events
 * plus forward-compatible staff/delivery notices. Reconnects with backoff.
 * Unknown frames are surfaced as notices, never dropped silently.
 */
import { api } from '../../lib/api';
import { logger } from '../../lib/logger';

export type MerchantMsg =
  | { type: 'hello'; user_id: string }
  | { type: 'pong' }
  | { type: 'order.status'; order_id: string; status: string }
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
    return { type: 'order.status', order_id: rec.order_id, status: rec.status };
  }
  if (typeof rec.type === 'string') {
    const text = typeof rec.text === 'string' ? rec.text : typeof rec.body === 'string' ? rec.body : rec.type;
    return { type: 'notice', text: String(text) };
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
