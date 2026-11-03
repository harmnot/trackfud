/**
 * Platform settings domain (A9 settings editor, PLAN §4.4 P0): per-scope
 * overrides of `config.yaml`, edited in the CMS and applied by the backend
 * without a restart. Scopes are `global` or a 2-letter country code.
 *
 * Wire shapes come from `GET /v1/admin/settings?scope=` (definitions +
 * stored override + effective value) and `PUT /v1/admin/settings`
 * (single-key upsert; null clears back to `config.yaml`). Nothing here is
 * hardcoded: rows that fail validation parse to null.
 */

export const SETTING_SCOPES = ['global', 'ID', 'GB', 'MY'] as const;
export type SettingScope = (typeof SETTING_SCOPES)[number] | string;

export function scopeParam(scope: string): string {
  const s = scope.trim();
  if (s === '' || s.toLowerCase() === 'global') return 'global';
  return s.toUpperCase();
}

export type SettingItem = {
  key: string;
  group: string;
  label: string;
  kind: 'int' | 'float';
  min: number;
  max: number;
  hint: string;
  /** Stored override for this scope; null means "use config.yaml". */
  override: number | null;
  /** Effective value after global + country merge. */
  effective: number;
  /** The config.yaml default, for reference. */
  is_default: number;
};

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return typeof raw === 'object' && raw !== null && !Array.isArray(raw);
}

function num(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : null;
}

/** Parse one settings row; null when the key/shape is unusable. */
export function parseSettingItem(raw: unknown): SettingItem | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['key'] !== 'string' || typeof raw['group'] !== 'string') return null;
  const effective = num(raw['effective']);
  const isDefault = num(raw['is_default']);
  if (effective === null || isDefault === null) return null;
  const min = num(raw['min']) ?? 0;
  const max = num(raw['max']) ?? 0;
  const overrideRaw = raw['override'];
  return {
    key: raw['key'],
    group: raw['group'],
    label: typeof raw['label'] === 'string' ? raw['label'] : raw['key'],
    kind: raw['kind'] === 'float' ? 'float' : 'int',
    min,
    max,
    hint: typeof raw['hint'] === 'string' ? raw['hint'] : '',
    override: typeof overrideRaw === 'number' && Number.isFinite(overrideRaw) ? overrideRaw : null,
    effective,
    is_default: isDefault,
  };
}

/** Parse the editor model `{"scope", "settings"}`. */
export function parseSettingList(raw: unknown): { scope: string; settings: SettingItem[] } | null {
  if (!isRecord(raw)) return null;
  if (typeof raw['scope'] !== 'string' || !Array.isArray(raw['settings'])) return null;
  const settings: SettingItem[] = [];
  for (const it of raw['settings']) {
    const s = parseSettingItem(it);
    if (s) settings.push(s);
  }
  return { scope: raw['scope'], settings };
}

/** Group settings in registry order for the editor sections. */
export function groupSettings(settings: SettingItem[]): Array<{ group: string; items: SettingItem[] }> {
  const order: string[] = [];
  const byGroup = new Map<string, SettingItem[]>();
  for (const s of settings) {
    if (!byGroup.has(s.group)) {
      byGroup.set(s.group, []);
      order.push(s.group);
    }
    byGroup.get(s.group)?.push(s);
  }
  return order.map((group) => ({ group, items: byGroup.get(group) ?? [] }));
}

/** Client-side range check mirroring the backend registry (server decides). */
export function settingError(item: SettingItem, value: string): string {
  const t = value.trim();
  if (t === '') return 'Enter a value, or clear the override.';
  const v = Number(t);
  if (!Number.isFinite(v)) return 'Value must be a number.';
  if (item.kind === 'int' && !Number.isInteger(v)) return 'Must be a whole number.';
  if (v < item.min || v > item.max) return `Must be between ${item.min} and ${item.max}.`;
  return '';
}
