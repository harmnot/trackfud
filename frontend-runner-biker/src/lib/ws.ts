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
  // Dispatch pings with the minimal frame (ids + expiry); the full offer
  // (merchant, fee, fit) always comes from `GET /courier/offers`, which the
  // handler refetches — frames stay small and the server stays the truth.
  // Legacy `{ offer }` frames still parse for backwards compatibility.
  // `offer.taken` clears a losing card at once: the atomic claim already
  // decided the winner, this frame is the notice (one order, one courier).
  | { type: 'offer.created'; offer?: unknown; offer_id?: string; delivery_id?: string; expires_at?: string; kind?: string }
  | { type: 'offer.taken'; delivery_id?: string; order_id?: string }
  | { type: 'order.status'; order_id: string; status: string }
  | { type: 'application.status'; status: string }
  | { type: 'courier.status'; status: string }
  // "Leave now" nudge, timed to food-ready (server is the trigger; the local
  // timer in DeliveryPage is only the offline fallback).
  | { type: 'delivery.leave_now'; delivery_id: string; order_id: string }
  | { type: 'delivery.eta'; delivery_id: string; order_id: string; eta_s: number; route_warning: string }
  // Kept for older servers that still emit the generic nudge shape.
  | { type: 'delivery.nudge'; delivery_id: string; text: string }
  | { type: 'cheer'; order_id?: string; from?: string; text?: string; message?: string; lang?: string }
  | { type: 'chat.message'; order_id?: string; message_id?: string; sender?: string; text?: string; body?: string; lang?: string }
  // The translate job stored a line's translation (live = Muse Spark, false = offline dictionary).
  | { type: 'chat.translated'; order_id: string; message_id: string; translated_body: string; lang: string; live: boolean }
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
  private connecting: Promise<void> | null = null;

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

  /**
   * Open the socket (fetches a fresh single-use ticket first). Concurrent
   * callers share one attempt: several screens connect on mount, and two
   * sockets would make the server fan every frame (offers too) out twice.
   */
  connect(): Promise<void> {
    this.wanted = true;
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) return Promise.resolve();
    if (!this.connecting) {
      this.connecting = this.open().finally(() => {
        this.connecting = null;
      });
    }
    return this.connecting;
  }

  private async open(): Promise<void> {
    let ticket: string;
    try {
      const res = await api<{ ticket: string }>('/ws/ticket', { method: 'POST' });
      ticket = res.ticket;
    } catch (err) {
      logger.warn('ws ticket failed, will retry', err);
      this.scheduleReconnect();
      return;
    }
    // disconnect() may have run while the ticket was in flight.
    if (!this.wanted) return;
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
