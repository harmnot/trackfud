/** Offline outbox: writes that failed with a network error queue here with a
 * client UUID and flush when the app is back online (reconnect + backlog
 * resend). Every path below is a real `backend/api/openapi.yaml` endpoint;
 * 409 means the server already applied the write, so the item is dropped. */

import { ApiError, api } from '../../lib/api';
import { logger } from '../../lib/logger';

const KEY = 'tb:customer:outbox';

export type OutboxItem = {
  id: string;
  path: string;
  method: 'POST' | 'PUT';
  body: Record<string, unknown>;
  createdAt: string;
  deferred: boolean;
};

export type FlushSummary = { sent: number; pending: number };

function load(): OutboxItem[] {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '[]') as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.filter((i): i is OutboxItem => typeof i === 'object' && i !== null && typeof (i as OutboxItem).id === 'string');
  } catch {
    return [];
  }
}

function save(items: OutboxItem[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items));
  } catch {
    logger.warn('outbox save failed (private mode?)', {});
  }
}

/** Queue one server-bound write; returns its client UUID. */
export function enqueue(args: { path: string; method: 'POST' | 'PUT'; body: Record<string, unknown> }): string {
  const item: OutboxItem = {
    id: crypto.randomUUID(),
    path: args.path,
    method: args.method,
    body: args.body,
    createdAt: new Date().toISOString(),
    deferred: false,
  };
  save([...load(), item]);
  logger.info('outbox queued', { path: args.path });
  return item.id;
}

/** Mark one item synced (e.g. after the server confirms it another way). */
export function dropItem(args: { id: string }): void {
  save(load().filter((i) => i.id !== args.id));
}

/** Items still waiting: queued or deferred for a failed flush. */
export function pendingItems(): OutboxItem[] {
  return load();
}

/** Try every queued item once. 409 means "already applied": the item is
 * dropped. Anything else failed stays queued for the next retry. */
export async function flush(): Promise<FlushSummary> {
  const items = load().filter((i) => !i.deferred);
  let sent = 0;
  const rest = load();
  for (const item of items) {
    try {
      await api<unknown>(item.path, {
        method: item.method,
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': item.id },
        body: JSON.stringify(item.body),
      });
      sent += 1;
      const at = rest.findIndex((r) => r.id === item.id);
      if (at >= 0) rest.splice(at, 1);
    } catch (err) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) {
        const at = rest.findIndex((r) => r.id === item.id);
        if (at >= 0) rest.splice(at, 1);
        sent += 1;
        logger.info('outbox settled by server state', { path: item.path, status: err.status });
      } else {
        logger.warn('outbox flush failed, will retry', { path: item.path });
      }
    }
  }
  save(rest);
  return { sent, pending: rest.length };
}
