/**
 * AI usage calls (`GET /v1/admin/ai/calls` newest first with an optional
 * `?feature=` allowlist filter, `GET /v1/admin/ai/summary` for the cards).
 */
import { api } from '../../lib/api';
import { parseAICall, parseAISummaryRow, type AICall, type AIFeatureFilter, type AISummaryRow } from './types';

export async function fetchAICalls(feature: AIFeatureFilter): Promise<AICall[]> {
  const q = feature === 'all' ? '' : `?feature=${encodeURIComponent(feature)}`;
  const d = await api<{ calls: unknown }>(`/admin/ai/calls${q}`);
  if (!Array.isArray(d.calls)) return [];
  const out: AICall[] = [];
  for (const raw of d.calls) {
    const c = parseAICall(raw);
    if (c) out.push(c);
  }
  return out;
}

export async function fetchAISummary(): Promise<AISummaryRow[]> {
  const d = await api<{ summary: unknown }>('/admin/ai/summary');
  if (!Array.isArray(d.summary)) return [];
  const out: AISummaryRow[] = [];
  for (const raw of d.summary) {
    const r = parseAISummaryRow(raw);
    if (r) out.push(r);
  }
  return out;
}
