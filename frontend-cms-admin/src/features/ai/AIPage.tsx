/**
 * "AI under the hood" (A9, PLAN §4.4 P1): every backend model call with
 * model, latency, tokens and cost, plus per-feature summary cards. A
 * fallback badge marks offline summaries (no model key); errors show inline.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MISSING, formatValue } from '../../lib/format';
import { Dropdown, Item, List, Note, Page, StatusBadge } from '../../components/ui';
import { fetchAICalls, fetchAISummary } from './api';
import { AI_FEATURES, formatMicros, totalCostMicros, type AIFeatureFilter } from './types';

export function AIPage() {
  const [feature, setFeature] = useState<AIFeatureFilter>('all');
  const summary = useQuery({ queryKey: ['admin', 'ai', 'summary'], queryFn: fetchAISummary });
  const calls = useQuery({ queryKey: ['admin', 'ai', 'calls', feature], queryFn: () => fetchAICalls(feature) });
  const rows = calls.data ?? [];
  const cards = summary.data ?? [];

  return (
    <Page>
      <h1 className="tb-display">AI under the hood</h1>
      <p className="tb-sub">
        Every model call the backend makes: feature, model, latency, tokens and cost.
        {summary.data ? ` ${formatMicros(totalCostMicros(cards))} logged in total.` : ''} Fallback rows
        are honest offline summaries — the admin still decides.
      </p>

      {summary.isLoading && (
        <List>
          {[0, 1].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 90 }} />
            </Item>
          ))}
        </List>
      )}
      {summary.isError && (
        <Note tone="error">
          Could not load the AI summary ({summary.error instanceof Error ? summary.error.message : 'unknown error'}).{' '}
          <button className="tb-link" onClick={() => void summary.refetch()}>
            Retry
          </button>
        </Note>
      )}
      {!summary.isLoading && !summary.isError && cards.length === 0 && (
        <Note tone="info">No model calls logged yet — translate a chat line, run a Trust Brief or ask the Copilot to write the first row.</Note>
      )}
      <div className="tb-grid-2 mt-3">
        {cards.map((c) => (
          <div className="tb-card" key={`${c.feature}:${c.model}`}>
            <h2 className="tb-h2">
              {c.feature} · <span className="tb-sub">{c.model || MISSING}</span>
            </h2>
            <dl className="tb-kv mt-3">
              <div className="tb-kv-row">
                <dt>Calls</dt>
                <dd>{c.calls}</dd>
              </div>
              <div className="tb-kv-row">
                <dt>Avg latency</dt>
                <dd>{c.avg_latency_ms} ms</dd>
              </div>
              <div className="tb-kv-row">
                <dt>Tokens in/out</dt>
                <dd>
                  {c.input_tokens} / {c.output_tokens}
                </dd>
              </div>
              <div className="tb-kv-row">
                <dt>Cost</dt>
                <dd>{formatMicros(c.cost_micros)}</dd>
              </div>
              <div className="tb-kv-row">
                <dt>Fallbacks/errors</dt>
                <dd>
                  {c.fallbacks} / {c.errors}
                </dd>
              </div>
              <div className="tb-kv-row">
                <dt>Last call</dt>
                <dd>{c.last_at ?? MISSING}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      <div className="tb-toolbar mt-3">
        <Dropdown
          label="AI feature filter"
          value={feature}
          options={AI_FEATURES.map((f) => ({ value: f, label: f === 'all' ? 'All features' : f }))}
          onChange={(v) => setFeature(v as AIFeatureFilter)}
        />
        <span className="tb-count">{rows.length} shown</span>
      </div>
      {calls.isLoading && (
        <List>
          {[0, 1, 2].map((i) => (
            <Item key={i} index={i}>
              <div className="tb-skel" style={{ height: 76 }} />
            </Item>
          ))}
        </List>
      )}
      {calls.isError && (
        <Note tone="error">
          Could not load AI calls ({calls.error instanceof Error ? calls.error.message : 'unknown error'}).{' '}
          <button className="tb-link" onClick={() => void calls.refetch()}>
            Retry
          </button>
        </Note>
      )}
      {!calls.isLoading && !calls.isError && rows.length === 0 && <Note tone="info">No calls in this state.</Note>}
      <div className="tb-grid-2 mt-3">
        {rows.map((c, i) => (
          <div className="tb-card" key={`${c.created_at}-${c.feature}-${i}`}>
            <p className="tb-sub tb-tight">
              <StatusBadge status={c.feature} /> {c.fallback ? <StatusBadge status="fallback" /> : null}
            </p>
            <dl className="tb-kv mt-3">
              <div className="tb-kv-row">
                <dt>Model</dt>
                <dd>{c.model !== '' ? formatValue(c.model) : MISSING}</dd>
              </div>
              <div className="tb-kv-row">
                <dt>Latency</dt>
                <dd>{c.latency_ms} ms</dd>
              </div>
              <div className="tb-kv-row">
                <dt>Tokens in/out</dt>
                <dd>
                  {c.input_tokens} / {c.output_tokens}
                </dd>
              </div>
              <div className="tb-kv-row">
                <dt>Cost</dt>
                <dd>{formatMicros(c.cost_micros)}</dd>
              </div>
              {c.error !== '' && (
                <div className="tb-kv-row">
                  <dt>Error</dt>
                  <dd>{formatValue(c.error)}</dd>
                </div>
              )}
              <div className="tb-kv-row">
                <dt>At</dt>
                <dd>{c.created_at !== '' ? formatValue(c.created_at) : MISSING}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>
    </Page>
  );
}
