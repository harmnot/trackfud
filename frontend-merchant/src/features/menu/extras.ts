/**
 * Compact custom extras the API has no columns for yet: per-item options
 * (priced add-ons) and allergen tags. One localStorage record keyed by item
 * id; never sent to the server. Drops cleanly when B6 adds real columns.
 */
import type { Allergen, ItemExtras, MenuOption } from './types';

const STORE_KEY = 'tb:merchant:item-extras';

function readAll(): Record<string, ItemExtras> {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) return {};
    return parsed as Record<string, ItemExtras>;
  } catch {
    return {};
  }
}

function writeAll(all: Record<string, ItemExtras>): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(all));
  } catch {
    /* storage full — extras stay in memory for this session */
  }
}

/** Extras for one item; empty options + allergens when never edited. */
export function getExtras(params: { itemId: string }): ItemExtras {
  return readAll()[params.itemId] ?? { options: [], allergens: [] };
}

/** Replace the extras for one item. */
export function setExtras(params: { itemId: string; extras: ItemExtras }): void {
  writeAll({ ...readAll(), [params.itemId]: params.extras });
}

/** Drop extras when the item is deleted. */
export function clearExtras(params: { itemId: string }): void {
  const all = readAll();
  delete all[params.itemId];
  writeAll(all);
}

/** Blank option row with a client-generated id. */
export function blankOption(): MenuOption {
  return { id: crypto.randomUUID(), name: { en: '' }, delta_minor: 0 };
}

/** Toggle one allergen tag on an extras record. */
export function toggleAllergen(params: { extras: ItemExtras; tag: Allergen }): ItemExtras {
  const has = params.extras.allergens.includes(params.tag);
  return {
    ...params.extras,
    allergens: has
      ? params.extras.allergens.filter((a) => a !== params.tag)
      : [...params.extras.allergens, params.tag],
  };
}
