/**
 * Courier↔customer chat, text first (P1). Live thread per delivery via
 * `GET+POST /courier/deliveries/{id}/messages`, server translation +
 * moderation via `.../messages/translate`, with the offline quick-reply
 * dictionary as fallback — clearly labelled until the server answers.
 * Voice notes record with MediaRecorder and stay on-device (IDB blob).
 * Messages cache in IndexedDB so the thread survives offline gaps.
 */
import { create } from 'zustand';
import { db } from '../../lib/db';
import { logger } from '../../lib/logger';
import { fetchMessages, sendChat, translateMessage, type ServerMessage } from '../delivery/courierApi';

/** One chat line. `mine` = courier wrote it. Names are never stored. */
export type ChatMsg = {
  id: string;
  ts: number;
  mine: boolean;
  text: string;
  /** Language the line was written in (`en` | `id` | `ms`). */
  lang: string;
  /** Server translation, or the offline-dictionary rendering (fallback). */
  translated: string | null;
  /** True while the server translation is live (false = offline dict). */
  translatedLive: boolean;
  /** False while the line is local-only (queued, not yet acked). */
  synced: boolean;
};

/** Quick replies: same meaning in three languages (tap, no typing). */
export const QUICK_REPLIES: readonly { key: string; en: string; id: string; ms: string }[] = [
  { key: 'gate', en: "I'm at the gate", id: 'Saya di gerbang', ms: 'Saya di pagar' },
  { key: 'two-min', en: '2 minutes away', id: '2 menit sampai', ms: '2 minit sampai' },
  { key: 'waiting', en: 'Waiting at pickup', id: 'Menunggu di resto', ms: 'Menunggu di restoran' },
  { key: 'thanks', en: 'Thanks for supporting my run!', id: 'Makasih sudah mendukung lariku!', ms: 'Terima kasih menyokong larian saya!' },
];

/** Tiny offline dictionary for the quick replies (labelled in the UI). */
export function quickTranslate(args: { text: string; to: string }): string | null {
  for (const q of QUICK_REPLIES) {
    const all = [q.en.toLowerCase(), q.id.toLowerCase(), q.ms.toLowerCase()];
    if (all.includes(args.text.trim().toLowerCase())) {
      if (args.to === 'id') return q.id;
      if (args.to === 'ms') return q.ms;
      return q.en;
    }
  }
  return null;
}

/** Map one server line (sender names never stored). */
function fromServer(m: ServerMessage): ChatMsg {
  const ts = Date.parse(m.created_at);
  return {
    id: m.id,
    ts: Number.isFinite(ts) ? ts : Date.now(),
    mine: m.sender === 'courier',
    text: m.body,
    lang: m.lang || 'en',
    translated: m.translated_body || null,
    translatedLive: m.translated_body !== '',
    synced: true,
  };
}

type ChatState = {
  messages: ChatMsg[];
  loaded: boolean;
  deliveryId: string | null;
  load: (args: { deliveryId: string | null }) => Promise<void>;
  send: (args: { deliveryId: string | null; text: string; lang: string }) => Promise<void>;
  receive: (args: { text: string; lang: string }) => Promise<void>;
  translate: (args: { deliveryId: string | null; messageId: string; to: string }) => Promise<void>;
};

export const useChat = create<ChatState>((set, get) => ({
  messages: [],
  loaded: false,
  deliveryId: null,
  load: async ({ deliveryId }) => {
    set({ deliveryId, loaded: false });
    let server: ServerMessage[] = [];
    if (deliveryId) {
      try {
        server = await fetchMessages({ deliveryId });
      } catch (err) {
        logger.warn('chat fetch failed, IDB cache owns the thread', err);
      }
    }
    try {
      if (server.length > 0) {
        const rows = server.map(fromServer);
        await db.chat.clear();
        await db.chat.bulkAdd(rows);
        set({ messages: rows, loaded: true });
        return;
      }
      const cached = await db.chat.orderBy('ts').toArray();
      set({ messages: cached.map((r) => ({ ...r, translatedLive: r.translatedLive ?? false })), loaded: true });
    } catch (err) {
      logger.error('chat load failed', err);
      set({ loaded: true });
    }
  },
  send: async ({ deliveryId, text, lang }) => {
    const clean = text.trim().slice(0, 280);
    if (clean.length === 0) return;
    let synced = false;
    if (deliveryId) {
      try {
        await sendChat({ deliveryId, text: clean, lang });
        synced = true;
      } catch (err) {
        logger.warn('chat send failed, kept local for retry', err);
      }
    }
    const msg: ChatMsg = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      mine: true,
      text: clean,
      lang,
      translated: null,
      translatedLive: false,
      synced,
    };
    try {
      await db.chat.add(msg);
    } catch (err) {
      logger.error('chat save failed', err);
      return;
    }
    set({ messages: [...get().messages, msg] });
    // Refresh server ids after a successful post (POST returns 201, no body).
    if (synced && deliveryId) {
      try {
        const server = await fetchMessages({ deliveryId });
        const unsynced = get().messages.filter((m) => !m.synced);
        const seen = new Set(server.map((m) => `${m.sender}:${m.body}`));
        const kept = unsynced.filter((m) => !seen.has(`courier:${m.text}`));
        const rows = [...server.map(fromServer), ...kept].sort((a, b) => a.ts - b.ts);
        await db.chat.clear();
        await db.chat.bulkAdd(rows);
        set({ messages: rows });
      } catch (err) {
        logger.warn('chat refresh failed, local copy stays', err);
      }
    }
  },
  receive: async ({ text, lang }) => {
    const msg: ChatMsg = {
      id: crypto.randomUUID(),
      ts: Date.now(),
      mine: false,
      text: text.slice(0, 280),
      lang,
      translated: null,
      translatedLive: false,
      synced: true,
    };
    try {
      await db.chat.add(msg);
    } catch (err) {
      logger.error('chat save failed', err);
      return;
    }
    set({ messages: [...get().messages, msg] });
  },
  translate: async ({ deliveryId, messageId, to }) => {
    const cur = get().messages.find((m) => m.id === messageId);
    if (!cur || cur.translatedLive) return;
    if (!deliveryId) {
      applyOffline({ id: messageId, to });
      return;
    }
    try {
      const res = await translateMessage({ deliveryId, messageId, to });
      set({
        messages: get().messages.map((m) =>
          m.id === messageId ? { ...m, translated: res.translated, translatedLive: res.live } : m,
        ),
      });
    } catch (err) {
      logger.warn('server translate failed, offline dictionary owns it', err);
      applyOffline({ id: messageId, to });
    }

    function applyOffline(args: { id: string; to: string }): void {
      const line = get().messages.find((m) => m.id === args.id);
      if (!line) return;
      const dict = quickTranslate({ text: line.text, to: args.to });
      if (dict && dict !== line.text) {
        set({
          messages: get().messages.map((m) =>
            m.id === args.id ? { ...m, translated: dict, translatedLive: false } : m,
          ),
        });
      }
    }
  },
}));
