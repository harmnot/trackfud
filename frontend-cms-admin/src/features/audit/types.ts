/**
 * Audit log domain (A9 audit viewer, PLAN §4.4 P1): every admin mutation
 * (decisions, sanctions, refunds, hold/release, settings, demo controls)
 * lands in `audit_logs` with actor, reason and before/after.
 *
 * Wire shapes come from `GET /v1/admin/audit` (`entries` newest first plus
 * `total` for paging). Nothing here is hardcoded: rows that fail validation
 * parse to null and never render.
 */

export const AUDIT_ACTIONS = [
  'all',
  'courier.approve',
  'courier.reject',
  'courier.freeze',
  'courier.unfreeze',
  'courier.ban',
  'merchant.approve',
  'merchant.reject',
  'merchant.ban',
  'merchant.unban',
  'order.refund',
  'withdrawal.hold',
  'withdrawal.release',
  'settings.update',
  'settings.clear',
  'demo.bots_start',
  'demo.bots_stop',
  'demo.force_no_courier',
  'demo.reset',
] as const;
export type AuditActionFilter = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_TARGETS = ['all', 'courier_application', 'courier', 'merchant', 'order', 'withdrawal', 'setting', 'demo'] as const;
export type AuditTargetFilter = (typeof AUDIT_TARGETS)[number];

export type AuditEntry = {
  actor_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  before: unknown;
  after: unknown;
  created_at: string;
};

export type AuditPage = { entries: AuditEntry[]; total: number; limit: number; offset: number };

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

/** Parse one entry; null when actor/action shape is unusable. */
export function parseAuditEntry(raw: unknown): AuditEntry | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['action'] !== 'string' || typeof raw['actor_id'] !== 'string') return null;
  return {
    actor_id: raw['actor_id'],
    action: raw['action'],
    target_type: str(raw['target_type']),
    target_id: str(raw['target_id']),
    reason: str(raw['reason']),
    before: raw['before'] ?? null,
    after: raw['after'] ?? null,
    created_at: str(raw['created_at']),
  };
}

/** Parse the viewer envelope `{"entries", "total", "limit", "offset"}`. */
export function parseAuditPage(raw: unknown): AuditPage | null {
  if (!isRecord(raw) || !Array.isArray(raw['entries'])) return null;
  const entries: AuditEntry[] = [];
  for (const e of raw['entries']) {
    const p = parseAuditEntry(e);
    if (p) entries.push(p);
  }
  const n = (v: unknown, fallback: number): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
  return { entries, total: n(raw['total'], entries.length), limit: n(raw['limit'], 50), offset: n(raw['offset'], 0) };
}
