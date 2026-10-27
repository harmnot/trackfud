/**
 * Voice Copilot server relay (B6): WebSocket to `GET /courier/voice`
 * with a single-use `?ticket=` from `POST /ws/ticket`. Binary frames
 * carry 24 kHz Int16 mono PCM; the text frame `{"type":"voice.end"}`
 * closes one utterance. Server replies are `voice.intent` frames with a
 * signed `confirmation` that `POST /courier/voice/confirm` executes.
 * The local EN+ID parser in `voiceCommands` stays as the no-key/offline
 * fallback — this relay never replaces it, only precedes it.
 */
import { api } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { VoiceIntentFrame } from '../delivery/courierApi';

type RelayCallbacks = {
  /** A full server intent arrived (speak `reply_text`, act on `intent`). */
  onIntent: (frame: VoiceIntentFrame) => void;
  /** The socket closed or failed; the caller falls back to local parsing. */
  onClose: () => void;
};

/** Parse one text frame; null for binary acks and unknown shapes. */
function parseIntent(data: string): VoiceIntentFrame | null {
  let raw: unknown;
  try {
    raw = JSON.parse(data);
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (o['type'] !== 'voice.intent') return null;
  if (typeof o['intent'] !== 'string' || typeof o['reply_text'] !== 'string') return null;
  return {
    intent: o['intent'],
    reply_text: o['reply_text'],
    offer_id: typeof o['offer_id'] === 'string' ? o['offer_id'] : null,
    confirmation: typeof o['confirmation'] === 'string' ? o['confirmation'] : null,
    live: o['live'] === true,
  };
}

/** One shared relay: PCM frames stream while the courier holds to talk. */
class VoiceRelay {
  private ws: WebSocket | null = null;
  private callbacks: RelayCallbacks | null = null;
  private connecting = false;

  /** True while the relay socket is open and taking PCM. */
  get open(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  /** Open the relay (idempotent); false when no ticket or no route. */
  async connect(callbacks: RelayCallbacks): Promise<boolean> {
    this.callbacks = callbacks;
    if (this.open || this.connecting) return this.open;
    this.connecting = true;
    try {
      const res = await api<{ ticket: string }>('/ws/ticket', { method: 'POST' });
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const url = `${proto}://${location.host}/api/v1/courier/voice?ticket=${encodeURIComponent(res.ticket)}`;
      const ws = new WebSocket(url);
      this.ws = ws;
      const opened = await new Promise<boolean>((resolve) => {
        ws.onopen = () => resolve(true);
        ws.onerror = () => resolve(false);
      });
      if (!opened) {
        this.drop();
        return false;
      }
      ws.onmessage = (ev) => {
        if (typeof ev.data !== 'string') return;
        const frame = parseIntent(ev.data);
        if (frame) this.callbacks?.onIntent(frame);
      };
      ws.onclose = () => {
        const mine = this.ws === ws;
        if (mine) this.drop();
        this.callbacks?.onClose();
      };
      ws.onerror = () => {
        ws.close();
      };
      return true;
    } catch (err) {
      logger.warn('voice relay unavailable, local parser owns intents', err);
      this.drop();
      return false;
    } finally {
      this.connecting = false;
    }
  }

  /** Stream one 24 kHz Int16 PCM frame; false when the relay is down. */
  sendPcm(buf: ArrayBuffer): boolean {
    if (!this.open || !this.ws) return false;
    try {
      this.ws.send(buf);
      return true;
    } catch (err) {
      logger.warn('voice pcm send failed', err);
      return false;
    }
  }

  /** Close the current utterance so the server transcribes + replies. */
  endUtterance(): void {
    if (!this.open || !this.ws) return;
    try {
      this.ws.send(JSON.stringify({ type: 'voice.end' }));
    } catch (err) {
      logger.warn('voice end failed', err);
    }
  }

  /** Close the relay (release on session end). */
  close(): void {
    this.callbacks = null;
    this.drop();
  }

  private drop(): void {
    try {
      this.ws?.close();
    } catch {
      /* already gone */
    }
    this.ws = null;
  }
}

/** One shared Voice Copilot relay for the whole Courier PWA. */
export const voiceRelay = new VoiceRelay();
