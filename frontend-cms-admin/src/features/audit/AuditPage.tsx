/**
 * Audit log viewer (A9, PLAN §4.4 P1): who changed what, when, and why.
 * Action + target filters narrow server-side; paging walks `offset`
 * forward/back through `total`. Before/after render as safe compact JSON
 * (never as React children), reasons show inline.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatValue } from '../../lib/format';
import { Dropdown, Item, List, Note, Page, StatusBadge } from '../../components/ui';
import { IdValue } from '../detail/fields';
import { fetchAudit } from './api';
import { AUDIT_ACTIONS, AUDIT_TARGETS, type AuditActionFilter, type AuditTargetFilter } from './types';

const PAGE_SIZE = 25;

export function AuditPage() {
  const [action, setAction] = useState<AuditActionFilter>('all');
  const [target, setTarget] = useState<AuditTargetFilter>('all');
  const [offset, setOffset] = useState(0);
  const q = useQuery({
    queryKey: ['admin', 'audit', action, target, offset],
    queryFn: () => fetchAudit({ action, target, limit: PAGE_SIZE, offset }),
  });
  const page = q.data;
  const rows = page?.entries ?? [];
  const total = page?.total ?? 0;

  return (
    <Page>
      <h1 className="tb-display">Audit log</h1>
      <p className="tb-sub">
        Every admin mutation with actor, reason and before/after. Sanction tables and the order
        event timeline stay the per-case trail; this is the unified who-did-what view.
      </p>

      <div className="tb-toolbar">
        <Dropdown
          label="Action filter"
          value={action}
          options={AUDIT_ACTIONS.map((a) => ({ value: a, label: a === 'all' ? 'All actions' : a }))}
          onChange={(v) => {
            setAction(v as AuditActionFilter);
            setOffset(0);
          }}
        />
        <Dropdown
          label="Target filter"
          value={target}
          options={AUDIT_TARGETS.map((t) => ({ value: t, label: t === 'all' ? 'All targets' : t }))}
          onChange={(v) => {
            setTarget(v as AuditTargetFilter);
            setOffset(0);
          }}
        />
        <span className="tb-count">{total} shown</span>
      </div>

      {q.isLoading && (
        <List>
          {[0, 1, 2].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 120 }} />
            </Item>
          ))}
        </List>
      )}
      {q.isError && (
        <Note tone="error">
          Could not load the audit log ({q.error instanceof Error ? q.error.message : 'unknown error'}).{' '}
          <button className="tb-link" onClick={() => void q.refetch()}>
            Retry
          </button>
        </Note>
      )}
      {!q.isLoading && !q.isError && rows.length === 0 && (
        <Note tone="info">No audit entries in this state yet — approve, sanction, refund, hold or save a setting to write the first row.</Note>
      )}
      <div className="tb-grid-2 mt-3">
        {rows.map((e, i) => (
          <div className="tb-card" key={`${e.created_at}-${e.action}-${i}`}>
            <p className="tb-sub tb-tight">
              <StatusBadge status={e.action} />
            </p>
            <dl className="tb-kv mt-3">
              <div className="tb-kv-row">
                <dt>Actor</dt>
                <dd>
                  <IdValue id={e.actor_id} label="actor ID" />
                </dd>
              </div>
              <div className="tb-kv-row">
                <dt>Target</dt>
                <dd>
                  {e.target_type !== '' ? `${e.target_type} · ` : ''}
                  <IdValue id={e.target_id} label="target ID" />
                </dd>
              </div>
              {e.reason !== '' && (
                <div className="tb-kv-row">
                  <dt>Reason</dt>
                  <dd>{formatValue(e.reason)}</dd>
                </div>
              )}
              <div className="tb-kv-row">
                <dt>Before → after</dt>
                <dd>
                  {formatValue(e.before)} → {formatValue(e.after)}
                </dd>
              </div>
              <div className="tb-kv-row">
                <dt>At</dt>
                <dd>{e.created_at !== '' ? formatValue(e.created_at) : '—'}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
      {total > PAGE_SIZE && (
        <div className="tb-actions mt-3">
          <button className="tb-link" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
            ← Newer
          </button>
          <span className="tb-count">
            {offset + 1}–{Math.min(offset + PAGE_SIZE, total)} of {total}
          </span>
          <button
            className="tb-link"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => setOffset(offset + PAGE_SIZE)}
          >
            Older →
          </button>
        </div>
      )}
    </Page>
  );
}
