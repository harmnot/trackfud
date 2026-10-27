/** Order status timeline. Handles `awaiting_payment → placed` plus every later step. */

import { useTranslation } from 'react-i18next';
import type { OrderStatus } from '../orders/types';

const STAGES: OrderStatus[] = ['awaiting_payment', 'placed', 'accepted', 'ready', 'picked_up', 'delivered'];

/** Vertical status timeline with the current step marked for screen readers. */
export function StatusTimeline(args: { status: OrderStatus }) {
  const { t } = useTranslation();
  if (args.status === 'cancelled' || args.status === 'rejected') {
    return (
      <ol className="tb-steps" aria-label={t('track.statusTitle')}>
        <li aria-current="step" className="tb-step-now tb-step-bad">
          <strong>{t(`track.s_${args.status}`)}</strong>
          <span>{t('track.refundedNote')}</span>
        </li>
      </ol>
    );
  }
  const shown = args.status === 'completed' ? 'delivered' : args.status;
  const at = STAGES.indexOf(shown);
  return (
    <ol className="tb-steps" aria-label={t('track.statusTitle')}>
      {STAGES.map((stage, i) => {
        const done = i < at;
        const now = i === at;
        return (
          <li key={stage} aria-current={now ? 'step' : undefined} className={now ? 'tb-step-now' : done ? 'tb-step-done' : ''}>
            <strong>{t(`track.s_${stage}`)}</strong>
            <span>{t(`track.d_${stage}`)}</span>
          </li>
        );
      })}
    </ol>
  );
}
