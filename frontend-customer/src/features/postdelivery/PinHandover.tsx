/** Customer-only delivery PIN handover: tap-to-reveal + copy, with a waiting
 * state before the PIN exists and an "at handover" emphasis once picked up. */

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

  if (!args.pin) {
    return (
      <section className="tb-pin mt-3" aria-label={t('track.pinTitle')}>
        <p className="tb-h2">{t('track.pinTitle')}</p>
        <p className="tb-pin-code" aria-live="polite">····</p>
        <p className="tb-sub">{t('pin.waiting')}</p>
      </section>
    );
  }
  const handover = args.status === 'picked_up' || args.status === 'delivered';
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
        <div className="mt-2"><Note tone="info">{t('pin.copied')}</Note></div>
      )}
    </section>
  );
}
