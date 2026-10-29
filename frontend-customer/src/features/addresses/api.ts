/** Typed calls to the customer address book (`/v1/customer/addresses`). */

import { api } from '../../lib/api';
import { logger } from '../../lib/logger';
import { parseAddress, type AddressInput, type CustomerAddress } from './types';

function toAddress(raw: unknown, where: string): CustomerAddress {
  const addr = parseAddress(raw);
  if (!addr) {
    logger.error('address payload failed validation', { where });
    throw new Error('Unexpected address response from server.');
  }
  return addr;
}

/** Saved addresses, default first. */
export async function listAddresses(): Promise<CustomerAddress[]> {
  const res = await api<{ addresses: unknown }>('/customer/addresses');
  if (!Array.isArray(res.addresses)) return [];
  const out: CustomerAddress[] = [];
  for (const raw of res.addresses) {
    const addr = parseAddress(raw);
    if (addr) out.push(addr);
  }
  return out;
}

/** Save a new pin. The first address becomes the default server-side. */
export async function createAddress(input: AddressInput): Promise<CustomerAddress> {
  const res = await api<unknown>('/customer/addresses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  return toAddress(res, 'createAddress');
}

/** Edit a saved pin (label, address text, coords, note, default flag). */
export async function updateAddress(args: { id: string } & AddressInput): Promise<CustomerAddress> {
  const { id, ...body } = args;
  const res = await api<unknown>(`/customer/addresses/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return toAddress(res, 'updateAddress');
}

/** Delete a pin. The server promotes the newest remaining one when the
 * default is deleted, and returns the promoted id ("" when none left). */
export async function deleteAddress(id: string): Promise<{ promotedId: string }> {
  const res = await api<{ promoted_default_id?: unknown }>(`/customer/addresses/${id}`, {
    method: 'DELETE',
  });
  return { promotedId: typeof res.promoted_default_id === 'string' ? res.promoted_default_id : '' };
}

/** Make one pin the default delivery address. */
export async function setDefaultAddress(id: string): Promise<void> {
  await api(`/customer/addresses/${id}/default`, { method: 'POST' });
}
