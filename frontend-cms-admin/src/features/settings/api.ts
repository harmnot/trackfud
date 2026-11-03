/**
 * Platform settings calls: editor model + single-key upsert
 * (`GET/PUT /v1/admin/settings`). A null value clears the override back to
 * `config.yaml`; the server validates the key, scope and range.
 */
import { api } from '../../lib/api';
import { parseSettingList, type SettingItem } from './types';

export async function fetchSettings(scope: string): Promise<SettingItem[]> {
  const q = scope === '' ? '' : `?scope=${encodeURIComponent(scope)}`;
  const d = await api<unknown>(`/admin/settings${q}`);
  return parseSettingList(d)?.settings ?? [];
}

/** Save one override. Pass null to clear it back to the default. */
export async function saveSetting(args: { scope: string; key: string; value: number | null }): Promise<void> {
  await api('/admin/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope: args.scope, key: args.key, value: args.value }),
  });
}
