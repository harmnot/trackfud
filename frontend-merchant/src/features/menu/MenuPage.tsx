/** Menu management: categories, items, labels, photos, extras, store toggles. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { Badge, Button, Field, Item, List, Note, Page, Switch } from '../../components/ui';
import {
  createCategory,
  createItem,
  deleteCategory,
  deleteItem,
  listCategories,
  listItems,
  setPrepMinutes,
  updateCategory,
  updateItem,
  uploadPhoto,
  type ItemInput,
} from './api';
import { blankOption, clearExtras, getExtras, setExtras, toggleAllergen } from './extras';
import { shrinkPhoto } from './image';
import { useMerchant } from './useMerchant';
import {
  ALLERGENS,
  BUSY_EXTRA_MIN,
  MAX_PREP_MIN,
  SIZE_OPTIONS,
  SPILL_OPTIONS,
  SUPPORTED_LANGS,
  formatMinor,
  minorToMajorText,
  parseMajorToMinor,
  pickLocale,
  type Allergen,
  type ItemExtras,
  type LocaleMap,
  type MenuItem,
  type SizeClass,
  type SpillRisk,
} from './types';

/**
 * Pause-store stays device-local: the merchant PATCH contract has no
 * paused/is-open column (busy mode is real — it writes prep_minutes).
 */
const PAUSE_KEY = 'tb:merchant:paused';
const NORMAL_PREP_KEY = 'tb:merchant:normal-prep';

function readFlag(key: string): boolean {
  return localStorage.getItem(key) === '1';
}

/** Blank multilingual map for the editor. */
function blankLocales(): LocaleMap {
  return { en: '', id: '', ms: '' };
}

interface EditorState {
  category_id: string | null;
  name: LocaleMap;
  description: LocaleMap;
  priceText: string;
  size_class: SizeClass;
  spill_risk: SpillRisk;
  travels_well: boolean;
  photo_url: string;
  available: boolean;
  extras: ItemExtras;
}

function editorFromItem(item: MenuItem): EditorState {
  return {
    category_id: item.category_id,
    name: { ...blankLocales(), ...item.name },
    description: { ...blankLocales(), ...item.description },
    priceText: '',
    size_class: item.size_class,
    spill_risk: item.spill_risk,
    travels_well: item.travels_well,
    photo_url: item.photo_url,
    available: item.available,
    extras: getExtras({ itemId: item.id }),
  };
}

function blankEditor(): EditorState {
  return {
    category_id: null,
    name: blankLocales(),
    description: blankLocales(),
    priceText: '',
    size_class: 'M',
    spill_risk: 'low',
    travels_well: true,
    photo_url: '',
    available: true,
    extras: { options: [], allergens: [] },
  };
}

export default function MenuPage(): React.ReactNode {
  const { t, i18n } = useTranslation();
  const { profile, currency, refetch: refetchMerchant } = useMerchant();
  const cats = useQuery({ queryKey: ['menu-cats'], queryFn: listCategories });
  const [filter, setFilter] = useState<string>('');
  const items = useQuery({
    queryKey: ['menu-items', filter],
    queryFn: () => listItems(filter ? { categoryId: filter } : {}),
  });
  const [catName, setCatName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>(blankEditor);
  const [priceSeeded, setPriceSeeded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [paused, setPaused] = useState(readFlag(PAUSE_KEY));
  const [photoBusy, setPhotoBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function fail(e: unknown): void {
    const m = e instanceof ApiError ? e.message : t('common.error');
    setErr(m);
    logger.warn('menu action failed', { err: m });
  }

  async function refresh(): Promise<void> {
    await Promise.all([cats.refetch(), items.refetch()]);
  }

  async function addCategory(): Promise<void> {
    setErr('');
    const name = catName.trim();
    if (!name) return;
    try {
      await createCategory({ name: { [i18n.language]: name }, sort: (cats.data?.length ?? 0) + 1 });
      setCatName('');
      await cats.refetch();
    } catch (e) {
      fail(e);
    }
  }

  function openNew(): void {
    setEditingId('new');
    setEditor({ ...blankEditor(), category_id: filter || null });
    setPriceSeeded(false);
    setErr('');
  }

  function openEdit(item: MenuItem): void {
    setEditingId(item.id);
    setEditor({ ...editorFromItem(item), priceText: minorToMajorText({ minor: item.price_minor, currency }) });
    setPriceSeeded(true);
    setErr('');
  }

  async function saveEditor(): Promise<void> {
    setErr('');
    const minor = parseMajorToMinor({ text: editor.priceText, currency });
    if (minor === null) {
      setErr(t('menu.badPrice'));
      return;
    }
    const named = Object.values(editor.name).some((v) => v.trim() !== '');
    if (!named) {
      setErr(t('menu.needName'));
      return;
    }
    const input: ItemInput = {
      category_id: editor.category_id,
      name: editor.name,
      description: editor.description,
      price_minor: minor,
      size_class: editor.size_class,
      spill_risk: editor.spill_risk,
      travels_well: editor.travels_well,
      photo_url: editor.photo_url,
      available: editor.available,
    };
    try {
      if (editingId === 'new') {
        const created = await createItem({ input });
        setExtras({ itemId: created.id, extras: editor.extras });
      } else if (editingId) {
        await updateItem({ id: editingId, patch: input });
        setExtras({ itemId: editingId, extras: editor.extras });
      }
      setEditingId(null);
      setMsg(t('menu.saved'));
      await refresh();
    } catch (e) {
      fail(e);
    }
  }

  async function flipAvailable(item: MenuItem): Promise<void> {
    try {
      await updateItem({ id: item.id, patch: { available: !item.available } });
      await items.refetch();
    } catch (e) {
      fail(e);
    }
  }

  async function removeItem(item: MenuItem): Promise<void> {
    if (!window.confirm(t('menu.confirmDelete'))) return;
    try {
      await deleteItem({ id: item.id });
      clearExtras({ itemId: item.id });
      if (editingId === item.id) setEditingId(null);
      await items.refetch();
    } catch (e) {
      fail(e);
    }
  }

  async function attachPhoto(file: File): Promise<void> {
    setPhotoBusy(true);
    setErr('');
    try {
      const shrunk = await shrinkPhoto({ file });
      const url = await uploadPhoto({ blob: shrunk.blob, contentType: shrunk.contentType });
      setEditor((e) => ({ ...e, photo_url: url }));
    } catch (e) {
      fail(e);
    } finally {
      setPhotoBusy(false);
    }
  }

  async function flipBusy(next: boolean): Promise<void> {
    if (!profile) return;
    const normal = Number(localStorage.getItem(NORMAL_PREP_KEY) ?? profile.prep_minutes);
    try {
      if (next) {
        localStorage.setItem(NORMAL_PREP_KEY, String(profile.prep_minutes));
        await setPrepMinutes({ profile, prep: Math.min(profile.prep_minutes + BUSY_EXTRA_MIN, MAX_PREP_MIN) });
      } else {
        await setPrepMinutes({ profile, prep: normal });
      }
      setBusy(next);
      refetchMerchant();
    } catch (e) {
      fail(e);
    }
  }

  function flipPaused(next: boolean): void {
    localStorage.setItem(PAUSE_KEY, next ? '1' : '0');
    setPaused(next);
  }

  const lang = SUPPORTED_LANGS.includes(i18n.language as (typeof SUPPORTED_LANGS)[number])
    ? i18n.language
    : 'en';
  void priceSeeded;

  return (
    <Page>
      <h1 className="tb-display">{t('menu.title')}</h1>
      <p className="tb-sub">{t('menu.sub')}</p>

      <section className="tb-card mt-3 flex flex-col gap-3" aria-label={t('menu.store')}>
        <Switch checked={busy} onChange={(v) => void flipBusy(v)} label={`${t('menu.busy')} (${t('menu.prep', { min: profile?.prep_minutes ?? 15 })})`} />
        <Switch checked={paused} onChange={flipPaused} label={t('menu.pause')} />
        {paused && <Note tone="info">{t('menu.pauseNote')}</Note>}
      </section>

      <section className="mt-4" aria-label={t('menu.cats')}>
        <h2 className="tb-h2">{t('menu.cats')}</h2>
        <span className="flex gap-2 mt-2">
          <input className="tb-input" value={catName} onChange={(e) => setCatName(e.target.value)} placeholder={t('menu.catName')} aria-label={t('menu.catName')} />
          <Button variant="soft" onClick={() => void addCategory()}>{t('menu.add')}</Button>
        </span>
        <List className="flex flex-col gap-2 mt-2">
          {(cats.data ?? []).map((c, i) => (
            <Item key={c.id} index={i}>
              <article className="tb-person">
                <span className="tb-person-main">
                  <span className="tb-person-name block">{pickLocale({ map: c.name, lang })}</span>
                  <span className="tb-person-sub">{t('menu.sort', { n: c.sort })}</span>
                </span>
                <Button
                  variant="soft"
                  onClick={() => {
                    const name = window.prompt(t('menu.catName'), pickLocale({ map: c.name, lang }));
                    if (name?.trim()) void updateCategory({ id: c.id, patch: { name: { ...c.name, [lang]: name.trim() } } }).then(() => cats.refetch()).catch(fail);
                  }}
                >
                  {t('menu.rename')}
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    if (window.confirm(t('menu.confirmDelete'))) void deleteCategory({ id: c.id }).then(() => refresh()).catch(fail);
                  }}
                >
                  {t('menu.delete')}
                </Button>
              </article>
            </Item>
          ))}
        </List>
      </section>

      <section className="mt-4" aria-label={t('menu.items')}>
        <span className="flex items-center gap-2 flex-wrap">
          <h2 className="tb-h2">{t('menu.items')}</h2>
          <Badge green={(items.data?.length ?? 0) > 0}>{t('menu.count', { n: items.data?.length ?? 0 })}</Badge>
        </span>
        <span className="flex gap-2 mt-4">
          <select className="tb-input" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label={t('menu.filterCat')}>
            <option value="">{t('menu.allCats')}</option>
            {(cats.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>{pickLocale({ map: c.name, lang })}</option>
            ))}
          </select>
          <Button onClick={openNew}>{t('menu.new')}</Button>
        </span>

        {editingId && (
          <article className="tb-card mt-3 flex flex-col gap-3" aria-label={t('menu.editor')}>
            {SUPPORTED_LANGS.map((l) => (
              <Field key={l} label={`${t('menu.name')} (${l})`}>
                <input
                  className="tb-input"
                  value={editor.name[l] ?? ''}
                  onChange={(e) => setEditor({ ...editor, name: { ...editor.name, [l]: e.target.value } })}
                />
              </Field>
            ))}
            {SUPPORTED_LANGS.map((l) => (
              <Field key={l} label={`${t('menu.desc')} (${l})`}>
                <input
                  className="tb-input"
                  value={editor.description[l] ?? ''}
                  onChange={(e) => setEditor({ ...editor, description: { ...editor.description, [l]: e.target.value } })}
                />
              </Field>
            ))}
            <span className="grid grid-cols-2 gap-2">
              <Field label={`${t('menu.price')} (${currency})`}>
                <input className="tb-input" inputMode="decimal" value={editor.priceText} onChange={(e) => setEditor({ ...editor, priceText: e.target.value })} placeholder="35000" />
              </Field>
              <Field label={t('menu.cat')}>
                <select className="tb-input" value={editor.category_id ?? ''} onChange={(e) => setEditor({ ...editor, category_id: e.target.value || null })}>
                  <option value="">{t('menu.noCat')}</option>
                  {(cats.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>{pickLocale({ map: c.name, lang })}</option>
                  ))}
                </select>
              </Field>
            </span>
            <span className="grid grid-cols-2 gap-2">
              <Field label={t('menu.size')}>
                <select className="tb-input" value={editor.size_class} onChange={(e) => setEditor({ ...editor, size_class: e.target.value as SizeClass })}>
                  {SIZE_OPTIONS.map((s) => (<option key={s} value={s}>{s}</option>))}
                </select>
              </Field>
              <Field label={t('menu.spill')}>
                <select className="tb-input" value={editor.spill_risk} onChange={(e) => setEditor({ ...editor, spill_risk: e.target.value as SpillRisk })}>
                  {SPILL_OPTIONS.map((s) => (<option key={s} value={s}>{t(`menu.spill_${s}`)}</option>))}
                </select>
              </Field>
            </span>
            <Switch checked={editor.travels_well} onChange={(v) => setEditor({ ...editor, travels_well: v })} label={t('menu.travels')} />
            <Switch checked={editor.available} onChange={(v) => setEditor({ ...editor, available: v })} label={t('menu.available')} />
            <Field label={t('menu.photo')}>
              <input
                className="tb-input"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void attachPhoto(f);
                }}
              />
            </Field>
            {photoBusy && <Note tone="info">{t('menu.photoUp')}</Note>}
            {editor.photo_url && <img src={editor.photo_url} alt="" className="tb-thumb" />}
            <div className="tb-card">
              <p className="font-extrabold text-sm mb-2">{t('menu.options')}</p>
              {editor.extras.options.map((o) => (
                <span key={o.id} className="flex gap-2 mb-2">
                  <input
                    className="tb-input"
                    value={o.name.en ?? ''}
                    placeholder={t('menu.optName')}
                    onChange={(e) => setEditor({
                      ...editor,
                      extras: { ...editor.extras, options: editor.extras.options.map((x) => (x.id === o.id ? { ...x, name: { ...x.name, en: e.target.value } } : x)) },
                    })}
                  />
                  <input
                    className="tb-input"
                    inputMode="numeric"
                    style={{ maxWidth: '7rem' }}
                    value={String(o.delta_minor)}
                    aria-label={t('menu.optDelta')}
                    onChange={(e) => {
                      const n = parseInt(e.target.value, 10);
                      setEditor({
                        ...editor,
                        extras: { ...editor.extras, options: editor.extras.options.map((x) => (x.id === o.id ? { ...x, delta_minor: Number.isSafeInteger(n) && n >= 0 ? n : 0 } : x)) },
                      });
                    }}
                  />
                  <Button
                    variant="danger"
                    onClick={() => setEditor({ ...editor, extras: { ...editor.extras, options: editor.extras.options.filter((x) => x.id !== o.id) } })}
                  >
                    ×
                  </Button>
                </span>
              ))}
              <Button variant="soft" onClick={() => setEditor({ ...editor, extras: { ...editor.extras, options: [...editor.extras.options, blankOption()] } })}>
                {t('menu.addOpt')}
              </Button>
            </div>
            <div className="tb-card">
              <p className="font-extrabold text-sm mb-2">{t('menu.allergens')}</p>
              <p className="flex gap-2 flex-wrap">
                {ALLERGENS.map((a: Allergen) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={editor.extras.allergens.includes(a)}
                    className={editor.extras.allergens.includes(a) ? 'tb-chip on' : 'tb-chip'}
                    onClick={() => setEditor({ ...editor, extras: toggleAllergen({ extras: editor.extras, tag: a }) })}
                  >
                    {t(`menu.al_${a}`)}
                  </button>
                ))}
              </p>
            </div>
            <span className="flex gap-2">
              <Button block onClick={() => void saveEditor()}>{t('menu.save')}</Button>
              <Button variant="soft" onClick={() => setEditingId(null)}>{t('menu.cancel')}</Button>
            </span>
          </article>
        )}

        <List className="flex flex-col gap-2 mt-3">
          {(items.data ?? []).map((item, i) => (
            <Item key={item.id} index={i}>
              <article className="tb-person">
                {item.photo_url ? (
                  <img src={item.photo_url} alt="" className="tb-face" style={{ objectFit: 'cover' }} />
                ) : (
                  <span className="tb-face" aria-hidden>🍜</span>
                )}
                <span className="tb-person-main">
                  <span className="tb-person-name block">{pickLocale({ map: item.name, lang }) || t('menu.unnamed')}</span>
                  <span className="tb-person-sub">
                    {formatMinor({ minor: item.price_minor, currency, lang })} · {item.size_class} · {t(`menu.spill_${item.spill_risk}`)}
                  </span>
                  <span className="flex gap-1 mt-1 flex-wrap">
                    {!item.travels_well && <Badge>{t('menu.pickupOnly')}</Badge>}
                    {!item.available && <Badge>{t('menu.soldOut')}</Badge>}
                    {item.travels_well && item.available && <Badge green>{t('menu.deliverable')}</Badge>}
                  </span>
                </span>
              </article>
              <p className="flex gap-4 mt-2 ml-1 flex-wrap items-center">
                <Switch checked={item.available} onChange={() => void flipAvailable(item)} label={t('menu.available')} />
                <Button variant="soft" onClick={() => openEdit(item)}>{t('menu.edit')}</Button>
                <Button variant="danger" onClick={() => void removeItem(item)}>{t('menu.delete')}</Button>
              </p>
            </Item>
          ))}
        </List>
        {(items.data?.length ?? 0) === 0 && (
          <div className="tb-quote mt-3"><p>{t('menu.empty')}</p><small>{t('menu.emptySub')}</small></div>
        )}
      </section>

      {msg && <div className="mt-3"><Note tone="info">{msg}</Note></div>}
      {err && <div className="mt-3"><Note tone="error">{err}</Note></div>}
    </Page>
  );
}
