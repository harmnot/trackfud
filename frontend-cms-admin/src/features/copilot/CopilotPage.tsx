/**
 * Ops Copilot (A9, PLAN §10.F P2): ask in plain words, get an answer with
 * evidence tables. Suggested questions cover the §10.F example ("Which
 * bikers had in-window deliveries under 80% last week?"). The `live` badge
 * tells a model-worded answer from the honest offline summary; tool chips
 * show which read-only analytics ran. Asked questions stay in-session only.
 */
import { useState } from 'react';
import { logger } from '../../lib/logger';
import { Button, Note, Page, StatusBadge, TextArea } from '../../components/ui';
import { askCopilot } from './api';
import { COPILOT_SUGGESTIONS, type CopilotResult, type CopilotTable } from './types';

export function CopilotPage() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [history, setHistory] = useState<Array<{ question: string; result: CopilotResult }>>([]);

  async function onAsk(q?: string) {
    const text = (q ?? question).trim();
    setErr('');
    if (text.length < 2) {
      setErr('Ask something in a few words or more.');
      return;
    }
    setBusy(true);
    try {
      // Server picks fixed read-only tools by keyword; the question never
      // becomes SQL, and the server stays the decider on length/shape.
      const result = await askCopilot(text);
      setHistory((h) => [{ question: text, result }, ...h].slice(0, 10));
      setQuestion('');
    } catch (e) {
      logger.warn('copilot ask failed', {});
      setErr(e instanceof Error ? e.message : 'The copilot could not answer.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Page>
      <h1 className="tb-display">Ops Copilot</h1>
      <p className="tb-sub">
        Ask in plain words — e.g. in-window rates, volume trends, top couriers. Answers cite the
        read-only analytics tables below; the question itself never becomes SQL.
      </p>

      <div className="tb-card">
        <TextArea
          label="Question"
          value={question}
          onChange={setQuestion}
          rows={2}
          placeholder="Which bikers had in-window deliveries under 80% last week?"
          maxLength={500}
        />
        <div className="tb-actions mt-3">
          <Button variant="clay" disabled={busy || question.trim().length < 2} onClick={() => void onAsk()}>
            {busy ? 'Thinking…' : 'Ask'}
          </Button>
        </div>
        {err !== '' && (
          <div className="mt-2">
            <Note tone="error">{err}</Note>
          </div>
        )}
        <div className="mt-3" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }} aria-label="Suggested questions">
          {COPILOT_SUGGESTIONS.map((s) => (
            <button key={s} type="button" className="tb-link" disabled={busy} onClick={() => void onAsk(s)}>
              {s}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-3"></div>
      {history.length === 0 && !busy && <Note tone="info">No questions yet this session — try a suggestion above.</Note>}
      {busy && history.length === 0 && (
        <div className="tb-card mt-3">
          <div className="tb-skel" style={{ height: 90 }} />
        </div>
      )}
      <div className="tb-grid-2 mt-3">
        {history.map((h, i) => (
          <CopilotCard key={`${h.question}-${i}`} question={h.question} result={h.result} />
        ))}
      </div>
    </Page>
  );
}

function CopilotCard({ question, result }: { question: string; result: CopilotResult }) {
  return (
    <div className="tb-card">
      <h2 className="tb-h2">{question}</h2>
      <p className="tb-sub tb-tight">
        <StatusBadge status={result.live ? 'live' : 'fallback'} />{' '}
        {result.tools_used.map((t) => (
          <span key={t} className="tb-badge" style={{ marginRight: '0.25rem' }}>
            {t}
          </span>
        ))}
      </p>
      <p className="mt-3">{result.answer}</p>
      {result.tables.map((t) => (
        <EvidenceTable key={t.title} table={t} />
      ))}
    </div>
  );
}

function EvidenceTable({ table }: { table: CopilotTable }) {
  if (table.columns.length === 0) return null;
  return (
    <div className="mt-3" style={{ overflowX: 'auto' }}>
      <table className="tb-table" aria-label={table.title}>
        <caption className="tb-sub" style={{ textAlign: 'left', paddingBottom: '0.5rem' }}>
          {table.title}
        </caption>
        <thead>
          <tr>
            {table.columns.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.length === 0 && (
            <tr>
              <td colSpan={table.columns.length}>No rows in the last 7 days.</td>
            </tr>
          )}
          {table.rows.map((r, i) => (
            <tr key={i}>
              {table.columns.map((c, j) => (
                <td key={c}>{r[j] ?? '—'}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
