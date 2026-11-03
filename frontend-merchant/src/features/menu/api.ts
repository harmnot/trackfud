/** Typed calls for menu CRUD + presigned photo upload (openapi.yaml shapes). */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { LocaleMap, MenuCategory, MenuItem, SizeClass } from './types';

export interface CategoryPatch {
  name?: LocaleMap;
  sort?: number;
}

export interface ItemInput {
  category_id?: string | null;
  name: LocaleMap;
  description?: LocaleMap;
  price_minor?: number;
  size_class: SizeClass;
  travels_well?: boolean;
  photo_url?: string;
  available?: boolean;
}

type ListParams = { categoryId?: string };

/** List categories for the caller's own store. */
export async function listCategories(): Promise<MenuCategory[]> {
  try {
    const data = await api<{ categories: MenuCategory[] }>('/merchant/menu/categories');
    return data.categories;
  } catch (e) {
    logger.warn('listCategories failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Create a category; needs a name in at least one language. */
export async function createCategory(params: { name: LocaleMap; sort: number }): Promise<{ id: string }> {
  return api<{ id: string }>('/merchant/menu/categories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
}

/** Patch a category's name and/or sort order. */
export async function updateCategory(params: { id: string; patch: CategoryPatch }): Promise<void> {
  await api(`/merchant/menu/categories/${params.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.patch),
  });
}

/** Delete a category; its items keep their row with category nulled. */
export async function deleteCategory(params: { id: string }): Promise<void> {
  await api(`/merchant/menu/categories/${params.id}`, { method: 'DELETE' });
}

/** List items for the caller's own store, optionally filtered by category. */
export async function listItems(params: ListParams = {}): Promise<MenuItem[]> {
  const qs = params.categoryId ? `?category_id=${encodeURIComponent(params.categoryId)}` : '';
  try {
    const data = await api<{ items: MenuItem[] }>(`/merchant/menu/items${qs}`);
    return data.items;
  } catch (e) {
    logger.warn('listItems failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Create a menu item (price in integer minor units, never floats). */
export async function createItem(params: { input: ItemInput }): Promise<{ id: string }> {
  return api<{ id: string }>('/merchant/menu/items', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(params.input),
  });
}

/** Patch any subset of an item (available toggle, labels, photo, price…). */
export async function updateItem(params: { id: string; patch: Partial<ItemInput> }): Promise<void> {
  await api(`/merchant/menu/items/${params.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params.patch),
  });
}

/** Delete an item permanently. */
export async function deleteItem(params: { id: string }): Promise<void> {
  await api(`/merchant/menu/items/${params.id}`, { method: 'DELETE' });
}

export interface Presign {
  file_id: string;
  upload_url: string;
  /** 'r2' = direct-to-R2 PUT, then POST complete; 'local' = PUT to the API. */
  storage?: 'r2' | 'local';
  expires_at?: string;
}

/** Ask the API for an upload slot (same contract as the R2 presign). */
export async function presignPhoto(params: { contentType: string; sizeBytes: number }): Promise<Presign> {
  const data = await api<Presign>('/files/presign', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket: 'public', content_type: params.contentType, size_bytes: params.sizeBytes }),
  });
  return data;
}

/** PUT bytes to a presigned upload URL.
 * Always sends the blob's Content-Type: R2 presigned PUTs sign it, and the
 * local API fallback ignores the header. */
export async function putUpload(params: { url: string; blob: Blob; contentType?: string }): Promise<void> {
  const res = await fetch(params.url, {
    method: 'PUT',
    headers: params.contentType ? { 'Content-Type': params.contentType } : undefined,
    body: params.blob,
  });
  if (!res.ok) throw new ApiError(`upload failed (${res.status})`, res.status);
}

/** Mark an R2 direct upload ready after the PUT (local uploads skip this). */
export async function completeUpload(params: { fileId: string; sizeBytes: number }): Promise<void> {
  await api(`/files/${params.fileId}/complete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ size_bytes: params.sizeBytes }),
  });
}

/** Public content URL for an uploaded file id. */
export function contentUrl(params: { fileId: string }): string {
  return `/api/v1/files/${params.fileId}/content`;
}

/** One AI draft row from the server. Prices are always null (see B6 rule). */
export interface ServerImportDraft {
  name: LocaleMap;
  description: LocaleMap;
  price_minor: number | null;
  price_unreadable?: boolean;
  size_class: SizeClass;
  travels_well: boolean;
  category_hint?: string;
  confident: boolean;
}

export type ServerImportStatus = 'queued' | 'uploading' | 'analyzing' | 'needs_review' | 'done' | 'failed';

/** Poll shape of `GET /v1/merchant/menu/import-jobs/{id}` (openapi.yaml B6). */
export interface ServerImportJob {
  id: string;
  status: ServerImportStatus;
  progress: number;
  photo_url: string;
  drafts: ServerImportDraft[];
  error: string;
  prices_checked: boolean;
  created_at: string;
  updated_at: string;
}

/** Narrow one unknown payload into a ServerImportJob; null when unusable. */
export function parseServerJob(raw: unknown): ServerImportJob | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const rec = raw as Record<string, unknown>;
  if (typeof rec.id !== 'string') return null;
  if (typeof rec.status !== 'string') return null;
  const drafts = Array.isArray(rec.drafts) ? (rec.drafts as ServerImportDraft[]) : [];
  return {
    id: rec.id,
    status: rec.status as ServerImportStatus,
    progress: typeof rec.progress === 'number' ? rec.progress : 0,
    photo_url: typeof rec.photo_url === 'string' ? rec.photo_url : '',
    drafts,
    error: typeof rec.error === 'string' ? rec.error : '',
    prices_checked: rec.prices_checked === true,
    created_at: typeof rec.created_at === 'string' ? rec.created_at : '',
    updated_at: typeof rec.updated_at === 'string' ? rec.updated_at : '',
  };
}

/** Start Snap-a-Menu on the server: photo file in, reviewed drafts out. */
export async function createServerImportJob(params: { fileId: string }): Promise<ServerImportJob> {
  try {
    const data = await api<unknown>('/merchant/menu/import-jobs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: params.fileId }),
    });
    const job = parseServerJob(data);
    if (!job) throw new ApiError('bad import job response', 502);
    return job;
  } catch (e) {
    logger.warn('createImportJob failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Poll one import job (server owns the analysis; client only renders). */
export async function getServerImportJob(params: { id: string }): Promise<ServerImportJob> {
  try {
    const data = await api<unknown>(`/merchant/menu/import-jobs/${params.id}`);
    const job = parseServerJob(data);
    if (!job) throw new ApiError('bad import job response', 502);
    return job;
  } catch (e) {
    logger.warn('getImportJob failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/**
 * Shrink → presign → upload in one step. Returns the content URL to store
 * as `photo_url` on the item.
 */
export async function uploadPhoto(params: { blob: Blob; contentType: string }): Promise<string> {
  const uploaded = await uploadMenuFile({ blob: params.blob, contentType: params.contentType });
  return uploaded.photoUrl;
}

/**
 * Presign → upload in one step. Returns both the file id (for
 * `POST /v1/merchant/menu/import-jobs`) and the content URL (for photos).
 */
export async function uploadMenuFile(params: { blob: Blob; contentType: string }): Promise<{ fileId: string; photoUrl: string }> {
  const slot = await presignPhoto({ contentType: params.contentType, sizeBytes: params.blob.size });
  await putUpload({ url: slot.upload_url, blob: params.blob, contentType: params.contentType });
  if (slot.storage === 'r2') {
    await completeUpload({ fileId: slot.file_id, sizeBytes: params.blob.size });
  }
  return { fileId: slot.file_id, photoUrl: contentUrl({ fileId: slot.file_id }) };
}

/** Merchant profile patch needs the full body; busy mode reuses this. */
export interface MerchantProfile {
  name: string;
  phone: string;
  country: string;
  currency: string;
  timezone: string;
  address: string;
  pickup_note: string;
  lat: number;
  lng: number;
  prep_minutes: number;
  opening_hours: Record<string, { open: string; close: string }>;
}

/** Update prep time while keeping every other profile field intact. */
export async function setPrepMinutes(params: { profile: MerchantProfile; prep: number }): Promise<void> {
  await api('/merchant/merchants/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...params.profile, prep_minutes: params.prep }),
  });
}
