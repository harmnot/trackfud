/**
 * Ops Copilot domain (A9, PLAN §10.F P2): plain-words questions answered
 * from fixed read-only analytics tools (never raw SQL) plus an optional
 * model pass. The `live` flag tells a model word from an offline summary.
 *
 * Wire shape comes from `POST /v1/admin/copilot/ask` (`answer`, `tables`,
 * `tools_used`, `live`). Rows that fail validation parse to null.
 */

export const COPILOT_SUGGESTIONS = [
  'Which bikers had in-window deliveries under 80% last week?',
  'Order volume trend this week',
  'Top couriers by deliveries',
  'Which restaurants sell the most?',
  'How much did AI cost us this week?',
] as const;

export type CopilotTable = { title: string; columns: string[]; rows: string[][] };

export type CopilotResult = { answer: string; tables: CopilotTable[]; tools_used: string[]; live: boolean };

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function parseTable(raw: unknown): CopilotTable | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['title'] !== 'string' || !Array.isArray(raw['columns'])) return null;
  const columns = raw['columns'].filter((c): c is string => typeof c === 'string');
  const rows: string[][] = [];
  if (Array.isArray(raw['rows'])) {
    for (const r of raw['rows']) {
      if (Array.isArray(r)) rows.push(r.map((cell) => (typeof cell === 'string' ? cell : String(cell ?? '—'))));
    }
  }
  return { title: raw['title'], columns, rows };
}

/** Parse the copilot envelope; null when the answer is missing. */
export function parseCopilotResult(raw: unknown): CopilotResult | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['answer'] !== 'string' || raw['answer'].trim() === '') return null;
  const tables: CopilotTable[] = [];
  if (Array.isArray(raw['tables'])) {
    for (const t of raw['tables']) {
      const p = parseTable(t);
      if (p) tables.push(p);
    }
  }
  const tools = Array.isArray(raw['tools_used'])
    ? raw['tools_used'].filter((t): t is string => typeof t === 'string')
    : [];
  return { answer: raw['answer'], tables, tools_used: tools, live: raw['live'] === true };
}

/** Client-side question check mirroring the backend (server decides). */
export function copilotError(question: string): string {
  const t = question.trim();
  if (t.length < 2) return 'Ask something in a few words or more.';
  if (t.length > 500) return 'Keep the question under 500 characters.';
  return '';
}
