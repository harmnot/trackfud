/** Snap-a-Menu: photo upload → job polling → editable review → publish. */
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { Badge, Button, Check, Field, FileUpload, Item, List, Note, Page, Select, Switch, TextInput } from '../../components/ui';
import { createItem, createServerImportJob, listCategories, uploadMenuFile } from './api';
import {
  draftReady,
  isTerminal,
  jobReady,
  noteSubmission,
  pollServerJob,
  recentSubmissions,
  recordSubmission,
  toReviewJob,
  withAddedRow,
  withDraft,
  withPricesChecked,
  withoutDraft,
} from './importJob';
import { shrinkPhoto } from './image';
import { useMerchant } from './useMerchant';
import {
  SIZE_OPTIONS,
  SUPPORTED_LANGS,
  formatMinor,
  parseMajorToMinor,
  type ImportDraft,
  type ImportJob,
  type SizeClass,
} from './types';

function priceTextOf(draft: ImportDraft, currency: string): string {
  if (draft.price_minor === null) return '';
  return currency === 'IDR' ? String(draft.price_minor) : (draft.price_minor / 100).toFixed(2);
}

export default function ImportPage(): React.ReactNode {
  const { t, i18n } = useTranslation();
  const nav = useNavigate();
  const { currency } = useMerchant();
  const cats = useQuery({ queryKey: ['menu-cats'], queryFn: listCategories });
  const [job, setJob] = useState<ImportJob | null>(null);
  const [busy, setBusy] = useState(false);
  const [pickedName, setPickedName] = useState<string | null>(null);
  const [err, setErr] = useState('');
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    abortRef.current = new AbortController();
    const signal = abortRef.current.signal;
    return () => abortRef.current?.abort(signal);
  }, []);

  function watch(id: string): void {
    const signal = abortRef.current?.signal;
    if (!signal) return;
    // Polling stops at needs_review, so server drafts never overwrite edits.
    let settled = false;
    pollServerJob({
      id,
      signal,
      onUpdate: (next) => {
        if (settled) return;
        if (isTerminal(next.status)) settled = true;
        setJob((prev) => (prev && isTerminal(prev.status) ? prev : next));
      },
      onError: (message) => {
        settled = true;
        setErr(message);
        logger.warn('menu import poll failed', { err: message });
      },
    });
  }

  async function onFile(file: File): Promise<void> {
    setErr('');
    setBusy(true);
    setPickedName(file.name);
    try {
      const shrunk = await shrinkPhoto({ file });
      const uploaded = await uploadMenuFile({ blob: shrunk.blob, contentType: shrunk.contentType });
      const server = await createServerImportJob({ fileId: uploaded.fileId });
      recordSubmission({ jobId: server.id, photoUrl: server.photo_url || uploaded.photoUrl, createdAt: server.created_at });
      const review = toReviewJob(server);
      setJob(review);
      if (!isTerminal(review.status)) watch(server.id);
    } catch (e) {
      const m = e instanceof ApiError ? e.message : t('common.error');
      setErr(m);
      logger.warn('menu import upload failed', { err: m });
    } finally {
      setBusy(false);
      setPickedName(null);
    }
  }

  function editDraft(draft: ImportDraft): void {
    if (!job) return;
    setJob(withDraft({ job, draft }));
  }

  function setPrice(draft: ImportDraft, text: string): void {
    const minor = text.trim() === '' ? null : parseMajorToMinor({ text, currency });
    editDraft({ ...draft, price_minor: minor, needs_price: minor === null });
  }

  async function publish(): Promise<void> {
    if (!job || !jobReady(job)) return;
    setErr('');
    setBusy(true);
    try {
      for (const draft of job.drafts) {
        if (draft.price_minor === null) throw new Error(t('menu.needPrices'));
        await createItem({
          input: {
            category_id: draft.category_id,
            name: draft.name,
            description: draft.description,
            price_minor: draft.price_minor,
            size_class: draft.size_class,
            travels_well: draft.travels_well,
            photo_url: draft.photo_url,
            available: true,
          },
        });
      }
      noteSubmission({ jobId: job.id, status: 'done', drafts: job.drafts.length });
      nav('/menu');
    } catch (e) {
      const m = e instanceof Error || e instanceof ApiError ? e.message : t('common.error');
      setErr(m);
      logger.warn('menu import publish failed', { err: m });
    } finally {
      setBusy(false);
    }
  }

  const lang = i18n.language;
  const history = recentSubmissions().filter((j) => j.jobId !== job?.id);
  const reviewing = job !== null && (job.status === 'analyzing' || job.status === 'needs_review' || job.status === 'uploading' || job.status === 'queued');

  return (
    <Page>
      <h1 className="tb-display">{t('import.title')}</h1>
      <p className="tb-sub">{t('import.sub')}</p>

      <section className="tb-card mt-3 flex flex-col gap-3" aria-label={t('import.upload')}>
        <p className="tb-label">{t('import.photo')}</p>
        <FileUpload
          title={t('import.dropTitle')}
          hint={t('import.dropHint')}
          accept="image/jpeg,image/png,image/webp"
          fileName={pickedName}
          busy={busy}
          done={false}
          onFile={(f) => void onFile(f)}
          onClear={() => setPickedName(null)}
        />
        <p className="tb-sub">{t('import.shrink')}</p>
        {busy && <div className="tb-skel" style={{ height: 64 }} role="status" aria-label={t('common.loading')} />}
      </section>

      {job && (
        <section className="mt-4" aria-label={t('import.review')}>
          <span className="flex items-center gap-2 flex-wrap">
            <h2 className="tb-h2">{t('import.review')}</h2>
            <Badge green={job.status === 'needs_review'}>{t(`import.st_${job.status}`)}</Badge>
          </span>
          {reviewing && job.status !== 'needs_review' && (
            <div className="tb-skel mt-2" style={{ height: 48 }} role="status" aria-label={t('common.loading')} />
          )}
          {job.status === 'failed' && <div className="mt-2"><Note tone="error">{job.error}</Note></div>}

          {job.status === 'needs_review' && (
            <>
              <List className="flex flex-col gap-3 mt-3">
                {job.drafts.map((draft, i) => (
                  <Item key={draft.id} index={i}>
                    <article className={`tb-card${!draft.confident ? ' tb-low' : ''}`}>
                      <span className="flex gap-2 items-start">
                        {draft.photo_url && <img src={draft.photo_url} alt="" className="tb-thumb" />}
                        <span className="flex-1 flex flex-col gap-2">
                          {SUPPORTED_LANGS.map((l) => (
                            <Field key={l} label={`${t('menu.name')} (${l})`}>
                              <TextInput
                                className={!draft.confident && !(draft.name[l]?.trim()) ? 'tb-input-low' : ''}
                                value={draft.name[l] ?? ''}
                                placeholder={t('menu.namePh', { defaultValue: 'e.g. Nasi Goreng' })}
                                onChange={(v) => editDraft({ ...draft, name: { ...draft.name, [l]: v } })}
                              />
                            </Field>
                          ))}
                          <span className="grid grid-cols-2 gap-2">
                            <Field label={`${t('menu.price')} (${currency})`}>
                              <TextInput
                                className={draft.needs_price ? 'tb-input-low' : ''}
                                inputMode="decimal"
                                value={priceTextOf(draft, currency)}
                                placeholder={t('import.typePrice')}
                                onChange={(v) => setPrice(draft, v)}
                              />
                            </Field>
                            <Field label={t('menu.cat')}>
                              <Select
                                value={draft.category_id ?? ''}
                                ariaLabel={t('menu.cat')}
                                onChange={(v) => editDraft({ ...draft, category_id: v || null })}
                                options={[
                                  { value: '', label: t('menu.noCat') },
                                  ...(cats.data ?? []).map((c) => ({ value: c.id, label: c.name[lang] ?? c.name.en ?? '' })),
                                ]}
                              />
                            </Field>
                          </span>
                          <span>
                            <Field label={t('menu.size')}>
                              <Select
                                className={!draft.confident ? 'tb-input-low' : ''}
                                value={draft.size_class}
                                ariaLabel={t('menu.size')}
                                onChange={(v) => editDraft({ ...draft, size_class: v as SizeClass, confident: false })}
                                options={SIZE_OPTIONS.map((s) => ({ value: s, label: s }))}
                              />
                            </Field>
                          </span>
                          <Switch
                            checked={draft.travels_well}
                            onChange={(v) => editDraft({ ...draft, travels_well: v })}
                            label={draft.travels_well ? t('menu.travels') : t('menu.pickupOnly')}
                          />
                          <p className="flex gap-2 items-center flex-wrap">
                            {!draftReady(draft) && <Badge>{t('import.needsWork')}</Badge>}
                            {draft.needs_price && <Badge>{t('import.noAiPrice')}</Badge>}
                            <span className="tb-sub">
                              {draft.price_minor !== null && formatMinor({ minor: draft.price_minor, currency, lang })}
                            </span>
                          </p>
                          {job.drafts.length > 1 && (
                            <Button variant="danger" onClick={() => setJob(withoutDraft({ job, draftId: draft.id }))}>
                              {t('menu.delete')}
                            </Button>
                          )}
                        </span>
                      </span>
                    </article>
                  </Item>
                ))}
              </List>
              <div className="mt-2">
                <Button variant="soft" block onClick={() => setJob(withAddedRow({ job }))}>
                  {t('import.addRow')}
                </Button>
              </div>
              <Check
                checked={job.prices_checked}
                onChange={(v) => setJob(withPricesChecked({ job, checked: v }))}
                label={t('import.checked')}
              />
              <div className="mt-2">
                <Button block disabled={!jobReady(job) || busy} onClick={() => void publish()}>
                  {t('import.publish')}
                </Button>
              </div>
              {!job.prices_checked && <p className="tb-sub mt-2">{t('import.tickFirst')}</p>}
            </>
          )}
        </section>
      )}

      {history.length > 0 && (
        <section className="mt-4" aria-label={t('import.history')}>
          <h2 className="tb-h2">{t('import.history')}</h2>
          <List className="flex flex-col gap-2 mt-2">
            {history.map((h, i) => (
              <Item key={h.jobId} index={i}>
                <article className="tb-person">
                  <span className="tb-person-main">
                    <span className="tb-person-name block">{h.createdAt ? new Date(h.createdAt).toLocaleString(lang) : h.jobId.slice(0, 8)}</span>
                    <span className="tb-person-sub">{t(`import.st_${h.status}`)} · {h.drafts} {t('menu.items')}</span>
                  </span>
                  <Badge green={h.status === 'done'}>{h.status}</Badge>
                </article>
              </Item>
            ))}
          </List>
        </section>
      )}

      {err && <div className="mt-3"><Note tone="error">{err}</Note></div>}
    </Page>
  );
}
