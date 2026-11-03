/** Send-a-cheer: preset cheers + one custom line. The runner hears it read
 * aloud by the Voice Copilot in their earphones while running. */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { Button, Note, Skeleton, TextInput } from '../../components/ui';
import { useCheers, useSendCheer } from './hooks';
import { CHEER_IDS, type CheerId } from './types';

/** Cheer composer + recent cheers for one order. */
export function CheerPanel(args: { orderId: string }) {
  const { t } = useTranslation();
  const cheers = useCheers({ orderId: args.orderId });
  const send = useSendCheer({ orderId: args.orderId });
  const [custom, setCustom] = useState('');
  const [err, setErr] = useState('');

  async function cheer(cheerId: CheerId | null, text: string) {
    setErr('');
    try {
      await send.mutateAsync({ cheerId, text });
      setCustom('');
    } catch (e) {
      setErr(e instanceof ApiError || e instanceof Error ? e.message : t('common.error'));
    }
  }

  return (
    <section className="tb-total mt-3" aria-label={t('cheer.title')}>
      <h2 className="tb-h2">{t('cheer.title')}</h2>
      <p className="tb-sub">{t('cheer.sub')}</p>
      <div className="tb-chips mt-2" aria-label={t('cheer.title')}>
        {CHEER_IDS.map((id) => (
          <button
            key={id}
            type="button"
            className="tb-chip"
            disabled={send.isPending}
            onClick={() => void cheer(id, t(`cheer.c_${id}`))}
          >
            {t(`cheer.c_${id}`)}
          </button>
        ))}
      </div>
      <form
        className="flex gap-2 mt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (custom.trim().length > 0) void cheer(null, custom.trim());
        }}
      >
        <div className="flex-1">
          <TextInput
            value={custom}
            maxLength={140}
            onChange={setCustom}
            placeholder={t('cheer.customPh')}
            aria-label={t('cheer.customPh')}
          />
        </div>
        <Button type="submit" variant="soft" disabled={custom.trim().length === 0 || send.isPending}>
          {t('cheer.send')}
        </Button>
      </form>
      {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}
      {cheers.isLoading && <div className="mt-2"><Skeleton height={40} /></div>}
      {cheers.data && cheers.data.length > 0 && (
        <ul className="tb-sub mt-2 flex flex-col gap-1" aria-label={t('cheer.sent')}>
          {cheers.data.slice(0, 3).map((c) => (
            <li key={c.id} aria-live="polite">
              {c.text}{c.synced ? '' : ` · ${t('sync.pendingOne')}`}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
