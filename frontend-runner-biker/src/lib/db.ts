/**
 * IndexedDB buffer (Dexie): GPS points with real timestamps, session
 * summaries, and the local wallet ledger. The GPS table is the offline
 * queue — every point carries a client UUID so the backend can
 * deduplicate on resend (frontend-architecture §3).
 */
import Dexie, { type Table } from 'dexie';

export type BufferedPoint = {
  /** Client UUID (`crypto.randomUUID()`), used for server dedupe. */
  uuid: string;
  sessionId: string;
  /** Real fix time (phone clock), never rewritten on resend. */
  ts: number;
  lat: number;
  lng: number;
  acc: number;
  speedMps: number | null;
  /** Delivery id when carrying food, else null. */
  deliveryId: string | null;
  sent: 0 | 1;
};

export type SessionSummary = {
  sessionId: string;
  mode: 'runner' | 'biker';
  startedAt: number;
  endedAt: number;
  distanceM: number;
  movingS: number;
  activeS: number;
  gapCount: number;
  gapS: number;
  earningsMinor: number;
  currency: string;
};

export type WalletTx = {
  id: string;
  ts: number;
  kind: 'delivery' | 'tip' | 'withdraw';
  amountMinor: number;
  currency: string;
  label: string;
};

/** A saved track (drawn loop or saved session shape), see trackStore. */
export type TrackRow = {
  id: string;
  name: string;
  createdAt: number;
  points: Array<{ x: number; y: number }>;
  estimateM: number;
};

/** One chat line, see chatStore (customer names never stored). */
export type ChatRow = {
  id: string;
  ts: number;
  mine: boolean;
  text: string;
  lang: string;
  translated: string | null;
  /** True when `translated` came from the server (false = offline dict). */
  translatedLive?: boolean;
  synced: boolean;
};

/** One on-device voice note (audio stays local until chat ships). */
export type VoiceNoteRow = {
  id: string;
  ts: number;
  durationS: number;
  audio: Blob;
};

class CourierDb extends Dexie {
  points!: Table<BufferedPoint, string>;
  sessions!: Table<SessionSummary, string>;
  wallet!: Table<WalletTx, string>;
  tracks!: Table<TrackRow, string>;
  chat!: Table<ChatRow, string>;
  voiceNotes!: Table<VoiceNoteRow, string>;

  constructor() {
    super('tb-courier');
    this.version(1).stores({
      points: 'uuid, sessionId, sent, ts',
      sessions: 'sessionId, startedAt',
      wallet: 'id, ts',
    });
    this.version(2).stores({
      points: 'uuid, sessionId, sent, ts',
      sessions: 'sessionId, startedAt',
      wallet: 'id, ts',
      tracks: 'id, createdAt',
      chat: 'id, ts',
      voiceNotes: 'id, ts',
    });
  }
}

export const db = new CourierDb();

/** Queue one GPS point for streaming (send happens in the run engine). */
export async function bufferPoint(point: BufferedPoint): Promise<void> {
  await db.points.add(point);
}

/** Oldest-first unsent points for one session (cap keeps resends small). */
export async function unsentPoints(args: { sessionId: string; limit: number }): Promise<BufferedPoint[]> {
  const rows = await db.points.where({ sessionId: args.sessionId, sent: 0 }).sortBy('ts');
  return rows.slice(0, args.limit);
}

/** Mark points acknowledged by the server so they are never resent. */
export async function markSent(uuids: string[]): Promise<void> {
  await db.points.where('uuid').anyOf(uuids).modify({ sent: 1 });
}

/** Drop acknowledged points older than 7 days (raw GPS is short-lived). */
export async function pruneSentPoints(): Promise<void> {
  await db.points.where('sent').equals(1).and((p) => p.ts < Date.now() - 7 * 86400_000).delete();
}

/** Active seconds logged today (device-local, for the 3 h safety cap). */
export async function activeSecondsToday(): Promise<number> {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const rows = await db.sessions.where('startedAt').aboveOrEqual(start.getTime()).toArray();
  return rows.reduce((sum, r) => sum + r.activeS, 0);
}

/** Active minutes in the last 7 days, per day, for the WHO 150-min ring. */
export async function weeklyActiveMinutes(): Promise<{ totalMin: number; days: number[] }> {
  const since = Date.now() - 7 * 86400_000;
  const rows = await db.sessions.where('startedAt').aboveOrEqual(since).toArray();
  const days = [0, 0, 0, 0, 0, 0, 0];
  for (const r of rows) {
    const idx = (6 - Math.floor((Date.now() - r.startedAt) / 86400_000)) as number;
    if (idx >= 0 && idx < 7) days[idx] += r.activeS / 60;
  }
  return { totalMin: rows.reduce((sum, r) => sum + r.activeS / 60, 0), days };
}

/** Consecutive days with a session up to today (for the rest-day nudge). */
export async function dayStreak(): Promise<number> {
  const rows = await db.sessions.orderBy('startedAt').reverse().toArray();
  const days = new Set(rows.map((r) => new Date(r.startedAt).toDateString()));
  let streak = 0;
  const d = new Date();
  if (!days.has(d.toDateString())) d.setDate(d.getDate() - 1);
  while (days.has(d.toDateString())) {
    streak += 1;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}
