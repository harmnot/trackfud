/**
 * Courier socket: single-use `/v1/ws/ticket` auth, `loc.batch` streaming,
 * live offer/delivery events. Reconnects with backoff; queued batches are
 * never dropped here — the IndexedDB buffer owns them (see run engine).
 */
import { api } from './api';
import { logger } from './logger';

export type IncomingMsg =
  | { type: 'hello'; user_id: string }
  | { type: 'pong' }
  | { type: 'offer.created'; offer: unknown }
  | { type: 'order.status'; order_id: string; status: string }
  | { type: 'delivery.nudge'; delivery_id: string; text: string }
  | { type: 'cheer'; from: string; text: string }
  | { type: 'chat.message'; text: string; lang: string }
  | { type: 'voice.transcript'; text: string; lang: string };

export type OutgoingMsg = { type: 'loc.batch'; session_id: string; points: unknown[] } | { type: 'ping' };

type Handler = (msg: IncomingMsg) => void;

const BACKOFF_MS = [1000, 2000, 5000, 10000, 30000];
const PING_MS = 25000;

export class CourierSocket {
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
    } catch (err) {
      logger.warn('ws ticket failed, will retry', err);
      this.scheduleReconnect();
      return;
    }
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const url = `${proto}://${location.host}/api/v1/ws?ticket=${encodeURIComponent(ticket)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.failures = 0;
      logger.info('ws open');
      if (this.pingTimer !== null) window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ type: 'ping' }), PING_MS);
    };
    ws.onmessage = (ev) => {
      let msg: IncomingMsg;
      try {
        msg = JSON.parse(ev.data as string) as IncomingMsg;
      } catch {
        logger.warn('ws: dropped non-JSON frame');
        return;
      }
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

  /** Best-effort send. Returns false when offline (caller keeps the buffer). */
  send(msg: OutgoingMsg): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    try {
      this.ws.send(JSON.stringify(msg));
      return true;
    } catch (err) {
      logger.warn('ws send failed', err);
      return false;
    }
  }

  private scheduleReconnect(): void {
    const wait = BACKOFF_MS[Math.min(this.failures, BACKOFF_MS.length - 1)] ?? 30000;
    this.failures += 1;
    logger.info(`ws reconnect in ${wait}ms`);
    window.setTimeout(() => {
      if (this.wanted) void this.connect();
    }, wait);
  }
}

/** One shared socket for the whole Courier PWA. */
export const socket = new CourierSocket();
