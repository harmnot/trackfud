/**
 * AI usage domain (A9 "AI under the hood", PLAN §4.4 P1): every model call
 * the backend makes — feature, model, latency, tokens, integer-micro cost —
 * plus the per-feature summary. Only metadata ships; never prompts or
 * personal data.
 *
 * Wire shapes come from `GET /v1/admin/ai/calls?feature=` and
 * `GET /v1/admin/ai/summary`. Rows that fail validation parse to null.
 */

export const AI_FEATURES = [
  'all',
  'menu_import',
  'chat_translate',
  'trust_brief',
  'proof_check',
  'feedback_labels',
  'coach_report',
  'voice_copilot',
  'voice_transcribe',
  'copilot',
] as const;
export type AIFeatureFilter = (typeof AI_FEATURES)[number];

export type AICall = {
  feature: string;
  model: string;
  prompt_version: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  fallback: boolean;
  error: string;
  created_at: string;
};

export type AISummaryRow = {
  feature: string;
  model: string;
  calls: number;
  avg_latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cost_micros: number;
  fallbacks: number;
  errors: number;
  last_at: string | null;
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function str(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function num(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

function bool(raw: unknown): boolean {
  return raw === true;
}

/** Parse one call row; null when feature/model shape is unusable. */
export function parseAICall(raw: unknown): AICall | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['feature'] !== 'string' || typeof raw['model'] !== 'string') return null;
  return {
    feature: raw['feature'],
    model: raw['model'],
    prompt_version: str(raw['prompt_version']),
    latency_ms: num(raw['latency_ms']),
    input_tokens: num(raw['input_tokens']),
    output_tokens: num(raw['output_tokens']),
    cost_micros: num(raw['cost_micros']),
    fallback: bool(raw['fallback']),
    error: str(raw['error']),
    created_at: str(raw['created_at']),
  };
}

/** Parse one summary row; null when the feature key is missing. */
export function parseAISummaryRow(raw: unknown): AISummaryRow | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['feature'] !== 'string') return null;
  return {
    feature: raw['feature'],
    model: str(raw['model']),
    calls: num(raw['calls']),
    avg_latency_ms: num(raw['avg_latency_ms']),
    input_tokens: num(raw['input_tokens']),
    output_tokens: num(raw['output_tokens']),
    cost_micros: num(raw['cost_micros']),
    fallbacks: num(raw['fallbacks']),
    errors: num(raw['errors']),
    last_at: typeof raw['last_at'] === 'string' ? raw['last_at'] : null,
  };
}

/** Format integer micro-USD for display only (never for math). */
export function formatMicros(costMicros: number): string {
  if (!Number.isFinite(costMicros)) return '—';
  return `$${(costMicros / 1e6).toFixed(4)}`;
}

/** Total cost across summary rows, in micro-USD. */
export function totalCostMicros(rows: AISummaryRow[]): number {
  return rows.reduce((sum, r) => sum + r.cost_micros, 0);
}
