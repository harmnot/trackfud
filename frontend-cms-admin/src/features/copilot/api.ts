/**
 * Ops Copilot calls (`POST /v1/admin/copilot/ask`): one plain-words
 * question in, an answer plus evidence tables out. The question is validated
 * client-side first; the backend picks fixed read-only tools by keyword and
 * rate-limits nothing client-side — the server stays the decider.
 */
import { api } from '../../lib/api';
import { copilotError, parseCopilotResult, type CopilotResult } from './types';

export async function askCopilot(question: string): Promise<CopilotResult> {
  const problem = copilotError(question);
  if (problem !== '') throw new Error(problem);
  const d = await api<unknown>('/admin/copilot/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: question.trim() }),
  });
  const r = parseCopilotResult(d);
  if (!r) throw new Error('The copilot returned an unusable answer.');
  return r;
}
