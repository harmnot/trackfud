/** Menu domain types for M2 (Snap-a-Menu + menu management). */

export type LocaleMap = Record<string, string>;
export type SizeClass = 'S' | 'M' | 'L';

/** Locales the merchant UI edits; matches `src/locales/*.json`. */
export const SUPPORTED_LANGS = ['en', 'id', 'ms'] as const;
export type SupportedLang = (typeof SUPPORTED_LANGS)[number];

/** Menu photo cap: upload shrinks to this long edge before presign PUT. */
export const MAX_PHOTO_PX = 1600;
/** Poll cadence for import-job status (local now, server job later). */
export const IMPORT_POLL_MS = 1200;
/** Busy mode adds this many prep minutes on top of the normal value. */
export const BUSY_EXTRA_MIN = 15;
/** Backend clamps prep_minutes to 1..120. */
export const MAX_PREP_MIN = 120;

export const SIZE_OPTIONS: ReadonlyArray<SizeClass> = ['S', 'M', 'L'];

/** Common allergen tags (compact codes, rendered via i18n). */
export const ALLERGENS = [
  'peanut',
  'tree-nut',
  'milk',
  'egg',
  'fish',
  'shellfish',
  'soy',
  'wheat',
  'sesame',
] as const;
export type Allergen = (typeof ALLERGENS)[number];

export interface MenuCategory {
  id: string;
  name: LocaleMap;
  sort: number;
}

export interface MenuItem {
  id: string;
  category_id: string | null;
  name: LocaleMap;
  description: LocaleMap;
  price_minor: number;
  size_class: SizeClass;
  travels_well: boolean;
  photo_url: string;
  available: boolean;
}

/** Priced add-on (e.g. extra egg). Compact custom data, see `ItemExtras`. */
export interface MenuOption {
  id: string;
  name: LocaleMap;
  delta_minor: number;
}

/**
 * Compact custom data the API has no columns for yet (no options/allergens
 * fields in `menu_items`). Stored per item in localStorage until B6 extends
 * the contract; never sent to the server.
 */
export interface ItemExtras {
  options: MenuOption[];
  allergens: Allergen[];
}

export type ImportStatus =
  | 'queued'
  | 'uploading'
  | 'analyzing'
  | 'needs_review'
  | 'publishing'
  | 'done'
  | 'failed';

/**
 * One AI review row. The AI never sets a price alone: `price_minor` starts
 * null with `needs_price` raised, and the merchant must type every price.
 */
export interface ImportDraft {
  id: string;
  name: LocaleMap;
  description: LocaleMap;
  /** Null until the merchant types a price — AI output is never trusted. */
  price_minor: number | null;
  size_class: SizeClass;
  travels_well: boolean;
  photo_url: string;
  category_id: string | null;
  /** False when the value came from AI/defaults instead of the merchant. */
  confident: boolean;
  needs_price: boolean;
}

export interface ImportJob {
  id: string;
  status: ImportStatus;
  progress: number;
  photo_url: string;
  error: string;
  drafts: ImportDraft[];
  /** Required before publish: merchant confirms every price by hand. */
  prices_checked: boolean;
  created_at: string;
}

/** Minor-unit decimals per currency (seed: IDR 35000 = Rp 35.000, GBP 650 = £6.50). */
const MINOR_DECIMALS: Record<string, number> = {
  IDR: 0,
  GBP: 2,
  USD: 2,
  EUR: 2,
  MYR: 2,
};

/** Decimals for a currency; defaults to 2. */
export function minorDecimals(currency: string): number {
  return MINOR_DECIMALS[currency] ?? 2;
}

/** Format integer minor units via Intl (never floats in, never floats out). */
export function formatMinor(params: { minor: number; currency: string; lang: string }): string {
  const decimals = minorDecimals(params.currency);
  const major = params.minor / 10 ** decimals;
  return new Intl.NumberFormat(params.lang, {
    style: 'currency',
    currency: params.currency,
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(major);
}

/**
 * Parse a typed major-unit amount ("35.000" / "6.50") to minor units with
 * string math only. Returns null when the text is not a valid amount.
 */
export function parseMajorToMinor(params: { text: string; currency: string }): number | null {
  const clean = params.text.trim().replace(/[, ]/g, '');
  if (!/^\d+(\.\d+)?$/.test(clean)) return null;
  const decimals = minorDecimals(params.currency);
  const [whole, fracRaw] = clean.split('.');
  const frac = (fracRaw ?? '').padEnd(decimals, '0').slice(0, decimals);
  const minor = Number(`${whole ?? '0'}${frac}`);
  if (!Number.isSafeInteger(minor) || minor < 0) return null;
  return minor;
}

/** Render a major-unit string back from minor units for the price input. */
export function minorToMajorText(params: { minor: number; currency: string }): string {
  const decimals = minorDecimals(params.currency);
  if (decimals === 0) return String(params.minor);
  return (params.minor / 10 ** decimals).toFixed(decimals);
}

/** First non-empty locale string, preferring the UI language. */
export function pickLocale(params: { map: LocaleMap; lang: string }): string {
  if (params.map[params.lang]?.trim()) return params.map[params.lang]?.trim() as string;
  for (const lang of SUPPORTED_LANGS) {
    if (params.map[lang]?.trim()) return (params.map[lang] as string).trim();
  }
  const first = Object.values(params.map).find((v) => v.trim());
  return first?.trim() ?? '';
}
