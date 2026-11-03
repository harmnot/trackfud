/** C3 operations against the real customer endpoints: one combined ratings
 * POST, cheers, messages (+translate), delivery-choice, and impact.
 * Writes go to the server first; only network failures queue in the outbox
 * (never the no-courier choice, see `chooseNoCourier`). */

import { ApiError, api } from '../../lib/api';
import { logger } from '../../lib/logger';
import { haversineKm } from '../orders/quote';
import type { OrderDetail } from '../orders/types';
import { enqueue } from './outbox';
import {
  IMPACT_PLANNING_KMH,
  isQuickReplyId,
  parseChatMessage,
  parseNoCourierOutcome,
  parseRating,
  parseServerImpact,
  parseServerMessage,
  parseTranslateResult,
  toServerChoice,
  type ChatMessage,
  type ChatSide,
  type Cheer,
  type CheerId,
  type Impact,
  type NoCourierChoice,
  type NoCourierOutcome,
  type QuickReplyId,
  type Rating,
  type RatingTarget,
  type ServerImpact,
  type ServerMessage,
  type Stars,
  type TranslateResult,
} from './types';

const RATINGS_KEY = 'tb:customer:post:ratings';
const CHAT_KEY = 'tb:customer:post:chat';
const CHEERS_KEY = 'tb:customer:post:cheers';

/** True when the request never reached the server (offline, DNS, reset). */
function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError;
}

function readArray(key: string): unknown[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeArray(key: string, rows: unknown[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(rows));
  } catch {
    logger.warn('post store save failed', { key });
  }
}

/* ---------- ratings (one combined POST per order) ---------- */

export type RatingsInput = {
  courierStars: Stars | null;
  courierTags: string[];
  restaurantStars: Stars | null;
};

/** Submit courier + restaurant stars in the single `POST .../ratings` call.
 * The server keeps one row per order, so both sides always go together. */
export async function submitRatings(args: { orderId: string } & RatingsInput): Promise<void> {
  if (args.courierStars === null && args.restaurantStars === null) {
    throw new Error('Rate the courier, the restaurant, or both.');
  }
  const body: Record<string, unknown> = {};
  if (args.courierStars !== null) {
    body['courier_stars'] = args.courierStars;
    body['courier_tags'] = args.courierTags.slice(0, 5);
  }
  if (args.restaurantStars !== null) body['restaurant_stars'] = args.restaurantStars;
  try {
    await api<unknown>(`/customer/orders/${args.orderId}/ratings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(body),
    });
  } catch (err) {
    if (err instanceof ApiError && err.status === 409 && err.message.includes('already rated')) {
      logger.info('order already rated, marking local done', { orderId: args.orderId });
    } else if (!isNetworkError(err)) {
      throw err;
    } else {
      logger.warn('ratings offline, kept locally only', { orderId: args.orderId });
      throw new Error('You are offline. Reconnect and send the rating again.');
    }
  }
  const at = new Date().toISOString();
  const rest = readArray(RATINGS_KEY)
    .map(parseRating)
    .filter((r): r is Rating => r !== null && r.orderId !== args.orderId);
  const rows: Rating[] = [...rest];
  if (args.courierStars !== null) {
    rows.push({
      orderId: args.orderId, target: 'courier', stars: args.courierStars,
      tags: args.courierTags, note: '', createdAt: at, synced: true,
    });
  }
  if (args.restaurantStars !== null) {
    rows.push({
      orderId: args.orderId, target: 'restaurant', stars: args.restaurantStars,
      tags: [], note: '', createdAt: at, synced: true,
    });
  }
  writeArray(RATINGS_KEY, rows);
  logger.info('ratings submitted', { orderId: args.orderId });
}

/** Read the saved rating for one order + target (null when not yet rated). */
export function getRating(args: { orderId: string; target: RatingTarget }): Rating | null {
  for (const raw of readArray(RATINGS_KEY)) {
    const r = parseRating(raw);
    if (r && r.orderId === args.orderId && r.target === args.target) return r;
  }
  return null;
}

/* ---------- chat (server thread + local unsynced rows) ---------- */

function fromServerMessage(orderId: string, s: ServerMessage): ChatMessage {
  return {
    id: s.id,
    orderId,
    from: s.sender === 'customer' ? 'me' : 'them',
    text: s.body,
    canonicalId: null,
    lang: s.lang,
    at: s.createdAt === '' ? new Date().toISOString() : s.createdAt,
    synced: true,
    serverId: s.id,
    translated: s.translatedBody,
  };
}

/** Server thread for one order, oldest first. Unknown rows are skipped. */
export async function fetchThread(args: { orderId: string }): Promise<ChatMessage[]> {
  const res = await api<{ messages: unknown }>(`/customer/orders/${args.orderId}/messages`);
  if (!Array.isArray(res.messages)) return [];
  const out: ChatMessage[] = [];
  for (const raw of res.messages) {
    const s = parseServerMessage(raw);
    if (s) out.push(fromServerMessage(args.orderId, s));
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

/** All messages for one order: server thread merged with local unsynced rows. */
export function listMessages(args: { orderId: string }): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (const raw of readArray(CHAT_KEY)) {
    const m = parseChatMessage(raw);
    if (m && m.orderId === args.orderId) out.push(m);
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : 1));
}

function replaceLocal(rows: ChatMessage[], msg: ChatMessage): void {
  const rest = rows.filter((r) => r.id !== msg.id);
  writeArray(CHAT_KEY, [...rest, msg]);
}

/** Merge a server thread into local storage, keeping unsynced drafts. */
export function mergeThread(args: { orderId: string; thread: ChatMessage[] }): ChatMessage[] {
  const local = listMessages({ orderId: args.orderId });
  const byServer = new Map<string, ChatMessage>();
  for (const m of args.thread) {
    if (m.serverId) byServer.set(m.serverId, m);
  }
  const merged = new Map<string, ChatMessage>();
  for (const m of args.thread) merged.set(m.id, m);
  for (const m of local) {
    if (m.serverId && byServer.has(m.serverId)) continue;
    merged.set(m.id, m);
  }
  const out = [...merged.values()].sort((a, b) => (a.at < b.at ? -1 : 1));
  const others = readArray(CHAT_KEY)
    .map(parseChatMessage)
    .filter((r): r is ChatMessage => r !== null && r.orderId !== args.orderId);
  writeArray(CHAT_KEY, [...others, ...out]);
  return out;
}

/** Store an incoming courier message (from the WS `chat.message` feed). */
export function storeIncoming(args: {
  orderId: string;
  text: string;
  canonicalId?: string;
  lang?: string;
  at?: string;
  serverId?: string;
}): ChatMessage {
  const msg: ChatMessage = {
    id: args.serverId ?? crypto.randomUUID(),
    orderId: args.orderId,
    from: 'them',
    text: args.text,
    canonicalId: isQuickReplyId(args.canonicalId) ? (args.canonicalId as QuickReplyId) : null,
    lang: args.lang ?? 'en',
    at: args.at ?? new Date().toISOString(),
    synced: true,
    serverId: args.serverId ?? null,
    translated: null,
  };
  const rows = listMessages({ orderId: args.orderId });
  if (rows.some((r) => r.id === msg.id)) return msg;
  replaceLocal(rows, msg);
  return msg;
}

/** Send one message: POST `{body, lang}` first, queue only when offline. */
export async function sendMessage(args: { orderId: string; text: string; canonicalId?: QuickReplyId }): Promise<ChatMessage> {
  const lang = localStorage.getItem('tb:customer:lang') ?? 'en';
  const clean = args.text.slice(0, 500);
  try {
    const res = await api<{ id: string; created_at: string }>(`/customer/orders/${args.orderId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ body: clean, lang }),
    });
    const msg: ChatMessage = {
      id: res.id,
      orderId: args.orderId,
      from: 'me' as ChatSide,
      text: clean,
      canonicalId: args.canonicalId ?? null,
      lang,
      at: res.created_at,
      synced: true,
      serverId: res.id,
      translated: null,
    };
    replaceLocal(listMessages({ orderId: args.orderId }), msg);
    return msg;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      orderId: args.orderId,
      from: 'me' as ChatSide,
      text: clean,
      canonicalId: args.canonicalId ?? null,
      lang,
      at: new Date().toISOString(),
      synced: false,
      serverId: null,
      translated: null,
    };
    replaceLocal(listMessages({ orderId: args.orderId }), msg);
    enqueue({
      path: `/customer/orders/${args.orderId}/messages`,
      method: 'POST',
      body: { body: clean, lang, client_id: msg.id },
    });
    logger.info('chat queued offline', { orderId: args.orderId });
    return msg;
  }
}

/** Mark a queued message synced after the outbox confirms it another way. */
export function markMessageSynced(args: { orderId: string; clientId: string; serverId?: string }): void {
  const rows = listMessages({ orderId: args.orderId });
  const found = rows.find((r) => r.id === args.clientId);
  if (!found) return;
  replaceLocal(rows, { ...found, synced: true, serverId: args.serverId ?? found.serverId });
}

/** Translate one stored message via `POST .../messages/translate`.
 * Quick replies stay dictionary-based (closed set, fully local); this is
 * for free text, keeping the offline dictionary as the fallback. */
export async function translateMessage(args: {
  orderId: string;
  messageId: string;
  to: 'en' | 'id' | 'ms';
}): Promise<TranslateResult> {
  const res = await api<unknown>(`/customer/orders/${args.orderId}/messages/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message_id: args.messageId, to: args.to }),
  });
  const parsed = parseTranslateResult(res);
  if (!parsed) {
    logger.error('translate payload failed validation', { orderId: args.orderId });
    throw new Error('Unexpected translate response from server.');
  }
  const rows = listMessages({ orderId: args.orderId });
  const found = rows.find((r) => r.serverId === args.messageId || r.id === args.messageId);
  if (found) replaceLocal(rows, { ...found, translated: parsed.translatedBody });
  return parsed;
}

/* ---------- cheers ---------- */

/** Cheers sent on one order, newest first. */
export function listCheers(args: { orderId: string }): Cheer[] {
  const out: Cheer[] = [];
  for (const raw of readArray(CHEERS_KEY)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const m = raw as Record<string, unknown>;
    if (m['orderId'] !== args.orderId || typeof m['id'] !== 'string') continue;
    if (typeof m['text'] !== 'string' || typeof m['at'] !== 'string') continue;
    out.push({
      id: m['id'] as string,
      orderId: args.orderId,
      cheerId: typeof m['cheerId'] === 'string' ? (m['cheerId'] as CheerId) : null,
      text: m['text'] as string,
      at: m['at'] as string,
      synced: m['synced'] === true,
    });
  }
  return out.sort((a, b) => (a.at < b.at ? 1 : -1));
}

/** Send a cheer: POST `{message}` first so the runner hears it at once;
 * queue only when offline. The 3/min server limit surfaces as an error. */
export async function sendCheer(args: { orderId: string; cheerId: CheerId | null; text: string }): Promise<Cheer> {
  const clean = args.text.slice(0, 140);
  let synced = false;
  try {
    await api<unknown>(`/customer/orders/${args.orderId}/cheers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ message: clean }),
    });
    synced = true;
  } catch (err) {
    if (!isNetworkError(err)) throw err;
    enqueue({
      path: `/customer/orders/${args.orderId}/cheers`,
      method: 'POST',
      body: { message: clean, client_id: crypto.randomUUID() },
    });
  }
  const cheer: Cheer = {
    id: crypto.randomUUID(),
    orderId: args.orderId,
    cheerId: args.cheerId,
    text: clean,
    at: new Date().toISOString(),
    synced,
  };
  writeArray(CHEERS_KEY, [...readArray(CHEERS_KEY), cheer]);
  logger.info('cheer sent', { orderId: args.orderId, synced });
  return cheer;
}

/** Mark unsent cheers synced after the outbox flush confirms them. */
export function markCheersSynced(args: { orderId: string }): void {
  const rows = listCheers({ orderId: args.orderId });
  const others = readArray(CHEERS_KEY).filter((raw) => {
    if (typeof raw !== 'object' || raw === null) return true;
    return (raw as Record<string, unknown>)['orderId'] !== args.orderId;
  });
  writeArray(CHEERS_KEY, [...others, ...rows.map((c) => ({ ...c, synced: true }))]);
}

/* ---------- no-courier choices ---------- */

/** Send keep-waiting / pickup / cancel through `POST .../delivery-choice`.
 * The server re-checks that dispatch gave up on an accepted or ready order
 * (409 otherwise, e.g. a courier was just found) and refunds a cancel in
 * full through the ledger. Never queued offline: a stale choice must not
 * replay minutes later, so errors surface and the customer chooses again. */
export async function chooseNoCourier(args: { orderId: string; choice: NoCourierChoice }): Promise<NoCourierOutcome> {
  const res = await api<unknown>(`/customer/orders/${args.orderId}/delivery-choice`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ choice: toServerChoice(args.choice) }),
  });
  const outcome = parseNoCourierOutcome(res);
  if (!outcome) {
    logger.error('delivery-choice payload failed validation', { orderId: args.orderId });
    throw new Error('Unexpected delivery-choice response from server.');
  }
  logger.info('no-courier choice', { orderId: args.orderId, choice: outcome.choice });
  return outcome;
}

/* ---------- impact ---------- */

/** Measured impact from `GET /v1/customer/impact` (courier-GPS totals). */
export async function fetchImpact(): Promise<ServerImpact> {
  const res = await api<unknown>('/customer/impact');
  const impact = parseServerImpact(res);
  if (!impact) {
    logger.error('impact payload failed validation', {});
    throw new Error('Unexpected impact response from server.');
  }
  return impact;
}

/** Estimate powered distance + active minutes from pickup→dropoff haversine.
 * Offline fallback only: the server totals above are authoritative. */
export function estimateImpact(args: {
  orderId: string;
  pickup: { lat: number; lng: number };
  dropoff: { lat: number; lng: number };
}): Impact {
  const km = haversineKm(args.pickup, args.dropoff);
  const distanceKm = Math.max(0.1, Math.round(km * 10) / 10);
  return {
    orderId: args.orderId,
    distanceKm,
    activeMin: Math.max(1, Math.round((distanceKm / IMPACT_PLANNING_KMH) * 60)),
    estimated: true,
  };
}

/* ---------- receipt ---------- */

export type ReceiptLine = { name: string; qty: number; totalMinor: number };

export type Receipt = {
  code: string;
  restaurant: string;
  createdAt: string;
  lines: ReceiptLine[];
  subtotalMinor: number;
  deliveryMinor: number;
  serviceMinor: number;
  tipMinor: number;
  totalMinor: number;
  currency: string;
  paymentMethod: string;
  refunded: boolean;
};

/** Build the email-receipt view from order detail (server totals, never recomputed). */
export function buildReceipt(args: { detail: OrderDetail; restaurant: string }): Receipt {
  const o = args.detail.order;
  return {
    code: o.code,
    restaurant: args.restaurant,
    createdAt: o.created_at,
    lines: args.detail.items.map((i) => ({
      name: i.name['en'] ?? Object.values(i.name)[0] ?? '?',
      qty: i.qty,
      totalMinor: i.line_total.amount_minor,
    })),
    subtotalMinor: o.subtotal.amount_minor,
    deliveryMinor: o.delivery_fee.amount_minor,
    serviceMinor: o.service_fee.amount_minor,
    tipMinor: o.tip.amount_minor,
    totalMinor: o.total.amount_minor,
    currency: o.currency,
    paymentMethod: o.payment_method,
    refunded: o.payment_status === 'refunded' || o.status === 'cancelled' || o.status === 'rejected',
  };
}
