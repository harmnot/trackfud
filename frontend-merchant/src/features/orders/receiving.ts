/** Persisted "receiving orders" switch for the kitchen (OrdersPage).
 *
 * The alarm/polling switch used to live in React state only, so leaving the
 * page reset it to "not receiving". This hook persists the flag in
 * localStorage (per merchant when known) and re-hydrates it on mount, so the
 * button reflects the real kitchen state across navigation and reloads.
 * Audio unlock still needs the tap; a restored `true` resumes polling + WS
 * but the next tap re-arms the loud alarm.
 */
import { useCallback, useState } from 'react';

const KEY = 'tb:merchant:receiving';
const KEY_BY_MERCHANT = 'tb:merchant:receiving:byId';

function readStored(merchantId: string | null): boolean {
  try {
    if (merchantId) {
      const map = JSON.parse(localStorage.getItem(KEY_BY_MERCHANT) ?? '{}') as Record<string, boolean>;
      if (typeof map[merchantId] === 'boolean') return map[merchantId];
    }
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function writeStored(merchantId: string | null, value: boolean): void {
  try {
    localStorage.setItem(KEY, value ? '1' : '0');
    if (merchantId) {
      const map = JSON.parse(localStorage.getItem(KEY_BY_MERCHANT) ?? '{}') as Record<string, boolean>;
      map[merchantId] = value;
      localStorage.setItem(KEY_BY_MERCHANT, JSON.stringify(map));
    }
  } catch {
    /* private mode: keep in-memory only */
  }
}

export function useReceivingState(merchantId: string | null): {
  receiving: boolean;
  setReceiving: (next: boolean) => void;
} {
  const [receiving, setLocal] = useState<boolean>(() => readStored(merchantId));
  const setReceiving = useCallback(
    (next: boolean) => {
      writeStored(merchantId, next);
      setLocal(next);
    },
    [merchantId],
  );
  return { receiving, setReceiving };
}
