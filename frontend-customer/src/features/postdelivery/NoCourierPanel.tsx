/** No-courier choices: when the order sits in `placed` past the 4 min
 * courier search, the customer picks wait-5-more / switch-to-pickup /
 * cancel-with-full-refund through `POST .../delivery-choice` (cancel falls
 * back to the cancel endpoint when the delivery left `no_courier`). */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { Button, Note, Skeleton } from '../../components/ui';
import type { Order } from '../orders/types';
import { useChooseNoCourier, useNoCourier } from './hooks';
import { NO_COURIER_SEARCH_S } from './types';

function ageS(order: Order): number {
  return Math.max(0, (Date.now() - new Date(order.created_at).getTime()) / 1000);
}

/** Panel shown only when the courier search has likely run dry. */
export function NoCourierPanel(args: { order: Order }) {
  const { t } = useTranslation();
  const choice = useNoCourier({ orderId: args.order.id });
  const decide = useChooseNoCourier({ orderId: args.order.id });
  const [err, setErr] = useState('');

  if (args.order.status !== 'placed') return null;
  if (ageS(args.order) < NO_COURIER_SEARCH_S) return null;
  if (choice.isLoading) {
    return <div className="mt-3"><Skeleton height={120} /></div>;
  }
  const snoozed = choice.data?.choice === 'wait' && choice.data.snoozeUntil !== null &&
    new Date(choice.data.snoozeUntil).getTime() > Date.now();
  if (snoozed || choice.data?.choice === 'pickup') return null;

  async function pick(kind: 'wait' | 'pickup' | 'cancel') {
    setErr('');
    try {
      await decide.mutateAsync(kind);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('common.error'));
    }
  }

  return (
    <section className="tb-total mt-3" aria-label={t('nocourier.title')} aria-live="polite">
      <h2 className="tb-h2">{t('nocourier.title')}</h2>
      <p className="tb-sub">{t('nocourier.sub')}</p>
      {err && <div className="mt-2"><Note tone="error">{err}</Note></div>}
      <div className="mt-2 flex flex-col gap-2">
        <Button variant="ember" block disabled={decide.isPending} onClick={() => void pick('wait')}>
          {t('nocourier.wait')}
        </Button>
        <Button variant="ink" block disabled={decide.isPending} onClick={() => void pick('pickup')}>
          {t('nocourier.pickup')}
        </Button>
        <Button variant="danger" block disabled={decide.isPending} onClick={() => void pick('cancel')}>
          {t('nocourier.cancel')}
        </Button>
      </div>
      {decide.isSuccess && decide.data.choice !== 'cancel' && (
        <div className="mt-2"><Note tone="info">{t(`nocourier.ok_${decide.data.choice}`)}</Note></div>
      )}
      {decide.isSuccess && decide.data.choice === 'cancel' && (
        <div className="mt-2"><Note tone="info">{t('track.cancelledRefund')}</Note></div>
      )}
    </section>
  );
}
