/** Self-pickup card: the customer chose to collect the order after no
 * courier was free (`delivery.customer_pickup`, server-derived, so it
 * survives reloads and other devices). Codes stay in their pairs: the order
 * code (on both the customer's and the kitchen's screen) identifies the
 * customer at the counter, the kitchen's pickup code stays on the kitchen
 * screen, and the delivery PIN is courier-only — no courier is coming. */

import { useTranslation } from 'react-i18next';
import type { Order } from '../orders/types';

/** Where and how to collect, following the kitchen live (cooking → packed). */
export function SelfPickupCard(args: { order: Order }) {
  const { t } = useTranslation();
  const ready = args.order.status === 'ready';
  return (
    <section className="tb-pin mt-3" aria-label={t('nocourier.pickupTitle')} aria-live="polite">
      <h2 className="tb-h2">{t('nocourier.pickupTitle')}</h2>
      <p className="tb-sub">{ready ? t('nocourier.pickupReady') : t('nocourier.pickupCooking')}</p>
      <div className="mt-2">
        <p className="tb-sub">{t('nocourier.pickupCodeLabel')}</p>
        <p className="tb-order-code">{args.order.code}</p>
        <p className="tb-sub">{t('nocourier.pickupShowCode')}</p>
      </div>
      <div className="mt-2">
        <p className="tb-sub">{t('nocourier.pickupNoPin')}</p>
      </div>
    </section>
  );
}
