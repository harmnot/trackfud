/**
 * Snap-a-Menu review state on top of the real B6 import-job endpoints.
 *
 * Transport (`POST /v1/merchant/menu/import-jobs`, poll
 * `GET /v1/merchant/menu/import-jobs/{id}`) is the source of truth for job
 * status and AI drafts. Draft *edits* stay local until publish: the contract
 * has no review/publish endpoint, so publishing writes each reviewed row via
 * `POST /v1/merchant/menu/items` (see `ImportPage.publish`).
 *
 * AI honesty rule: every draft keeps `price_minor: null` and
 * `needs_price: true` until the merchant types a price. The mapper forces
 * null even if a server payload ever carries a price — no model output ever
 * becomes a price, and publish stays gated on the "I checked all prices" tick.
 */
import { logger } from '../../lib/logger';
import { getServerImportJob, type ServerImportDraft, type ServerImportJob } from './api';
import { IMPORT_POLL_MS } from './types';
import type { ImportDraft, ImportJob } from './types';

const HISTORY_KEY = 'tb:merchant:import-history';

export interface SubmissionRecord {
  jobId: string;
  photoUrl: string;
  status: string;
  drafts: number;
  createdAt: string;
}

function readHistory(): SubmissionRecord[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SubmissionRecord[]) : [];
  } catch {
    return [];
  }
}

function writeHistory(records: SubmissionRecord[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records.slice(-8)));
  } catch {
    logger.warn('import history persist failed');
  }
}

/** Remember a submitted job id on this device (no list endpoint exists). */
export function recordSubmission(params: { jobId: string; photoUrl: string; createdAt: string }): void {
  const rest = readHistory().filter((r) => r.jobId !== params.jobId);
  writeHistory([...rest, { jobId: params.jobId, photoUrl: params.photoUrl, status: 'analyzing', drafts: 0, createdAt: params.createdAt }]);
}

/** Refresh one history row after a poll or a publish. */
export function noteSubmission(params: { jobId: string; status: string; drafts: number }): void {
  writeHistory(readHistory().map((r) => (r.jobId === params.jobId ? { ...r, status: params.status, drafts: params.drafts } : r)));
}

/** Recent submissions from this device, newest first. */
export function recentSubmissions(): SubmissionRecord[] {
  return readHistory().reverse();
}

/** Fill a possibly sparse locale map with the editor's three languages. */
function withLocales(map: Record<string, string> | undefined): Record<string, string> {
  return { en: map?.en ?? '', id: map?.id ?? '', ms: map?.ms ?? '' };
}

/** One server draft → one editable review row. Price is forced to null. */
function toDraft(draft: ServerImportDraft, photoUrl: string): ImportDraft {
  return {
    id: crypto.randomUUID(),
    name: withLocales(draft.name),
    description: withLocales(draft.description),
    price_minor: null,
    size_class: draft.size_class,
    spill_risk: draft.spill_risk,
    travels_well: draft.travels_well,
    photo_url: photoUrl,
    category_id: null,
    confident: draft.confident,
    needs_price: true,
  };
}

/**
 * Map the server poll shape to the review model. Server `prices_checked`
 * is ignored: the tick is the merchant's local confirmation and publish
 * stays gated on it (there is no PATCH endpoint for it).
 */
export function toReviewJob(server: ServerImportJob): ImportJob {
  return {
    id: server.id,
    status: server.status,
    progress: server.progress,
    photo_url: server.photo_url,
    error: server.error,
    prices_checked: false,
    created_at: server.created_at,
    drafts: server.drafts.map((d) => toDraft(d, server.photo_url)),
  };
}

/** Terminal poll states: reviewable, published upstream, or failed. */
export function isTerminal(status: ImportJob['status']): boolean {
  return status === 'needs_review' || status === 'done' || status === 'failed';
}

/**
 * Poll a server job until it reaches a terminal review state. Interval +
 * AbortController; each poll re-maps drafts the merchant has not edited yet,
 * so callers must stop polling once `needs_review` arrives (see isTerminal).
 */
export function pollServerJob(params: { id: string; signal: AbortSignal; onUpdate: (job: ImportJob) => void; onError: (message: string) => void }): void {
  let stopped = false;
  const stop = (): void => {
    stopped = true;
  };
  params.signal.addEventListener('abort', stop, { once: true });
  const tick = async (): Promise<void> => {
    if (stopped || params.signal.aborted) return;
    try {
      const server = await getServerImportJob({ id: params.id });
      if (stopped || params.signal.aborted) return;
      const job = toReviewJob(server);
      noteSubmission({ jobId: job.id, status: job.status, drafts: job.drafts.length });
      params.onUpdate(job);
      if (isTerminal(job.status)) return;
    } catch (e) {
      logger.warn('import job poll failed', { err: e instanceof Error ? e.message : 'unknown' });
      params.onError(e instanceof Error ? e.message : 'poll failed');
      return;
    }
    window.setTimeout(() => void tick(), IMPORT_POLL_MS);
  };
  void tick();
}

/** Replace one draft row after the merchant edits it (pure). */
export function withDraft(params: { job: ImportJob; draft: ImportDraft }): ImportJob {
  return { ...params.job, drafts: params.job.drafts.map((d) => (d.id === params.draft.id ? params.draft : d)) };
}

/** Add another dish row to the same photo's review table (pure). */
export function withAddedRow(params: { job: ImportJob }): ImportJob {
  const first = params.job.drafts[0];
  return {
    ...params.job,
    drafts: [
      ...params.job.drafts,
      {
        id: crypto.randomUUID(),
        name: { en: '', id: '', ms: '' },
        description: { en: '', id: '', ms: '' },
        price_minor: null,
        size_class: 'M',
        spill_risk: 'low',
        travels_well: true,
        photo_url: params.job.photo_url,
        category_id: first?.category_id ?? null,
        confident: false,
        needs_price: true,
      },
    ],
  };
}

/** Remove a draft row before publishing (pure). */
export function withoutDraft(params: { job: ImportJob; draftId: string }): ImportJob {
  return { ...params.job, drafts: params.job.drafts.filter((d) => d.id !== params.draftId) };
}

/** Flip the "I checked all prices" confirmation (pure, local only). */
export function withPricesChecked(params: { job: ImportJob; checked: boolean }): ImportJob {
  return { ...params.job, prices_checked: params.checked };
}

/** A draft is publishable with a typed name and a typed price. */
export function draftReady(draft: ImportDraft): boolean {
  const named = Object.values(draft.name).some((v) => v.trim() !== '');
  return named && draft.price_minor !== null && draft.price_minor >= 0;
}

/** The job can publish only when every row is ready and prices are ticked. */
export function jobReady(job: ImportJob): boolean {
  if (job.drafts.length === 0 || !job.prices_checked) return false;
  return job.drafts.every(draftReady);
}
