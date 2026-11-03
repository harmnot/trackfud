/** No-courier choices, shown whenever dispatch has given up (delivery
 * `no_courier`) on an order the kitchen accepted and nobody collected yet
 * (`accepted` or `ready`). Server state drives it: the WS `order.status`
 * frame (or the 10 s poll) brings it up the moment the search ends, and the
 * refetch after a choice hides it again. Choices go through
 * `POST .../delivery-choice`: keep waiting (a fresh courier wave), collect it
 * yourself (`SelfPickupCard` takes over), or cancel with a full refund. */

import { useTranslation } from 'react-i18next';
import { ApiError } from '../../lib/api';
import { Button, Note } from '../../components/ui';
import type { DeliveryInfo, Order } from '../orders/types';
import { useChooseNoCourier } from './hooks';
import { isBeforePickup, needsNoCourierChoice, type NoCourierChoice } from './types';

/** Choices while dispatch has given up; a short outcome note after one landed. */
export function NoCourierPanel(args: { order: Order; delivery: DeliveryInfo | null }) {
  const { t } = useTranslation();
  const decide = useChooseNoCourier({ orderId: args.order.id });
  const last = decide.data?.choice ?? null;

  if (!needsNoCourierChoice({ status: args.order.status, delivery: args.delivery })) {
    return <ChoiceOutcome last={last} order={args.order} delivery={args.delivery} />;
  }

  // 409 = the order moved on (a courier was just found, or the kitchen
  // changed it); the hook already refetched, so point at the fresh state.
  const error = decide.error
    ? t(decide.error instanceof ApiError && decide.error.status === 409 ? 'nocourier.conflict' : 'common.error')
    : '';
  const pick = (choice: NoCourierChoice) => decide.mutate(choice);

  return (
    <section className="tb-total mt-3" aria-label={t('nocourier.title')} aria-live="polite">
      <h2 className="tb-h2">{t('nocourier.title')}</h2>
      <p className="tb-sub">{t('nocourier.sub')}</p>
      {last === 'wait' && <div className="mt-2"><Note tone="info">{t('nocourier.stillNone')}</Note></div>}
      {error && <div className="mt-2"><Note tone="error">{error}</Note></div>}
      <div className="mt-2 flex flex-col gap-2">
        <Button variant="ember" block disabled={decide.isPending} onClick={() => pick('wait')}>
          {t('nocourier.wait')}
        </Button>
        <Button variant="ink" block disabled={decide.isPending} onClick={() => pick('pickup')}>
          {t('nocourier.pickup')}
        </Button>
        <Button variant="danger" block disabled={decide.isPending} onClick={() => pick('cancel')}>
          {t('nocourier.cancel')}
        </Button>
      </div>
    </section>
  );
}

/** What the last choice made on this page led to, until the order moves on:
 * the fresh search still running, or the refund. Pickup needs no note: the
 * server-derived `SelfPickupCard` takes over the courier slot. */
function ChoiceOutcome(args: { last: NoCourierChoice | null; order: Order; delivery: DeliveryInfo | null }) {
  const { t } = useTranslation();
  if (args.last === 'cancel' && args.order.status === 'cancelled') {
    return <div className="mt-3"><Note tone="info">{t('track.cancelledRefund')}</Note></div>;
  }
  if (args.last === 'wait' && isBeforePickup(args.order.status) && !args.delivery?.courier) {
    return <div className="mt-3"><Note tone="info">{t('nocourier.ok_wait')}</Note></div>;
  }
  return null;
}
