/** Customer-only delivery PIN handover: tap-to-reveal + copy, with staged
 * guidance so the 4-digit code is unmistakable.
 *
 * Three codes, three pairs — never mixed:
 *  1. pickup code: kitchen ↔ courier (merchant screen, you never see it);
 *  2. delivery PIN: you ↔ courier (this card, merchant never sees it);
 *  3. never share either code in chat — say the PIN face to face at the door.
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { logger } from '../../lib/logger';
import { Button, Note } from '../../components/ui';
import type { OrderStatus } from '../orders/types';

async function copyPin(pin: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(pin);
    return true;
  } catch {
    logger.warn('pin copy failed', {});
    return false;
  }
}

/** PIN handover card for one order. */
export function PinHandover(args: { pin: string | undefined; status: OrderStatus }) {
  const { t } = useTranslation();
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);

  // Dead orders never need a handover code.
  if (args.status === 'cancelled' || args.status === 'rejected') return null;

  // Handed over: the code did its job — say so instead of showing digits.
  // `pin.done` is the completion headline, `pin.doneSub` explains the PIN is
  // now inactive and points to rating below (never share it again).
  if (args.status === 'delivered' || args.status === 'completed') {
    return (
      <section className="tb-pin mt-3" aria-label={t('track.pinTitle')}>
        <p className="tb-h2">{t('track.pinTitle')}</p>
        <p className="tb-pin-code" aria-live="polite" aria-label={t('pin.done')}>✓</p>
        <p className="tb-sub font-bold">{t('pin.done')}</p>
        <p className="tb-sub mt-1">{t('pin.doneSub')}</p>
      </section>
    );
  }

  if (!args.pin) {
    return (
      <section className="tb-pin mt-3" aria-label={t('track.pinTitle')}>
        <p className="tb-h2">{t('track.pinTitle')}</p>
        <p className="tb-pin-code" aria-live="polite">····</p>
        <p className="tb-sub">{t('pin.waiting')}</p>
        <p className="tb-sub mt-1">{t('pin.howItWorks')}</p>
      </section>
    );
  }
  const handover = args.status === 'picked_up';
  return (
    <section className="tb-pin mt-3" aria-label={t('track.pinTitle')}>
      <p className="tb-h2">{t('track.pinTitle')}</p>
      <p className="tb-pin-code" aria-live="polite">{revealed ? args.pin : '····'}</p>
      <p className="tb-sub">{handover ? t('pin.handoverNow') : t('track.pinSub')}</p>
      <div className="flex gap-2 justify-center mt-2">
        <Button
          size="sm"
          variant={revealed ? 'soft' : 'ember'}
          onClick={() => setRevealed((r) => !r)}
        >
          {revealed ? t('pin.hide') : t('pin.reveal')}
        </Button>
        {revealed && (
          <Button
            size="sm"
            variant="soft"
            onClick={() => void copyPin(args.pin as string).then((ok) => setCopied(ok))}
          >
            {copied ? t('pin.copied') : t('pin.copy')}
          </Button>
        )}
      </div>
      {copied && (
        <div className="mt-2"><Note tone="info">{t('pin.copied')}</Note>
        </div>
      )}
      <div className="mt-2">
        <p className="tb-sub">{t('pin.howItWorks')}</p>
        <p className="tb-sub">{t('pin.neverChat')}</p>
      </div>
    </section>
  );
}
