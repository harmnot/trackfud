import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '../../lib/api';
import { logger } from '../../lib/logger';
import type { SanctionInput, SanctionTarget } from './review';
import { REASON_OPTIONAL } from './review';

export function useDecide(prefix: (string | number)[], path: (id: string, approve: boolean) => string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  async function decide(id: string, approve: boolean, reason: string) {
    setErr('');
    setDone('');
    if (!approve && reason.trim() === '') {
      setErr('A rejection reason is required.');
      return;
    }
    setBusy(true);
    try {
      await api(path(id, approve), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(approve ? {} : { reason: reason.trim() }),
      });
      setDone(approve ? 'Approved.' : 'Rejected with reason.');
      await qc.invalidateQueries({ queryKey: prefix });
    } catch (e) {
      logger.warn('review decision failed', {});
      setErr(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }

  return { decide, busy, err, done };
}

/** Server-state hook for freeze/ban/unban: posts to the sanctions endpoint and refetches review data. */
export function useSanction(target: SanctionTarget, path: (id: string) => string) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState('');

  async function sanction(id: string, input: SanctionInput) {
    setErr('');
    setDone('');
    const kind = input.kind.trim();
    const reason = input.reason.trim();
    if (kind === '') {
      setErr('Choose a sanction kind.');
      return;
    }
    if (!REASON_OPTIONAL.includes(kind) && reason === '') {
      setErr('A reason is required and is audit-logged.');
      return;
    }
    let endsAt: string | undefined;
    if (input.endsAt !== '') {
      const parsed = new Date(input.endsAt);
      if (Number.isNaN(parsed.getTime())) {
        setErr('The end date is not a valid date.');
        return;
      }
      endsAt = parsed.toISOString();
    }
    setBusy(true);
    try {
      const body =
        target === 'courier'
          ? { kind, reason_code: reason, note: input.note.trim(), ends_at: endsAt }
          : { kind, reason, note: input.note.trim() };
      const res = await api<{ status: string }>(path(id), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      setDone(`Saved. Status is now ${res.status}.`);
      await qc.invalidateQueries({ queryKey: ['admin'] });
    } catch (e) {
      logger.warn('sanction failed', {});
      setErr(e instanceof Error ? e.message : 'Sanction failed.');
    } finally {
      setBusy(false);
    }
  }

  return { sanction, busy, err, done };
}
