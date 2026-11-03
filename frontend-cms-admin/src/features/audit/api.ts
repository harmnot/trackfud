/**
 * Audit viewer calls (`GET /v1/admin/audit`): newest first, optional
 * `?action=` / `?target_type=` allowlist filters, `?limit=` + `?offset=`
 * paging. Filters the backend does not know 400 — the page only offers the
 * allowlisted actions the contract serves.
 */
import { api } from '../../lib/api';
import { parseAuditPage, type AuditActionFilter, type AuditPage, type AuditTargetFilter } from './types';

export type AuditQuery = { action: AuditActionFilter; target: AuditTargetFilter; limit: number; offset: number };

export async function fetchAudit(q: AuditQuery): Promise<AuditPage> {
  const params = new URLSearchParams();
  if (q.action !== 'all') params.set('action', q.action);
  if (q.target !== 'all') params.set('target_type', q.target);
  params.set('limit', String(q.limit));
  params.set('offset', String(q.offset));
  const d = await api<unknown>(`/admin/audit?${params.toString()}`);
  return parseAuditPage(d) ?? { entries: [], total: 0, limit: q.limit, offset: q.offset };
}
