/** Shared pay module: wallet pay (idempotent) + card via a server-created
 * Paddle transaction confirmed by the webhook (or instantly in demo mode).
 * Card data never touches the app: Paddle.js renders its own overlay.
 *
 * Flow (fixes the sandbox `required price_id` failure):
 *   create pending payment (topup / card order)
 *   → POST /customer/payments/{id}/checkout (server mints a Paddle transaction
 *     with our payment id in custom_data; needs TF_PADDLE_API_KEY)
 *   → Paddle.Checkout.open({ transactionId }) (paddle.ts, never ad-hoc amount)
 *   → poll GET /customer/payments/{id} until the webhook marks it paid
 *   → demo mode (no Paddle token / 503 checkout): confirmPaymentDemo instead.
 */

import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import {
  confirmPaymentDemo,
  createCardOrder,
  createPaymentCheckout,
  createTopup,
  createWalletOrder,
  fetchOrder,
  fetchPayment,
} from './api';
import { openPaddleCheckout, paddleConfig, PaddleError } from './paddle';
import type { Order, Payment } from './types';

export type PayMethod = 'wallet' | 'card';

export type PayResult =
  | { kind: 'placed'; order: Order }
  | { kind: 'card_authorized'; transactionId: string; totalMinor: number; currency: string; orderId: string | null }
  | { kind: 'topup_credited'; payment: Payment };

/** Typed pay failure for user-safe messages. */
export class PayError extends Error {
  code: 'insufficient' | 'paddle_missing' | 'paddle_failed' | 'order_failed' | 'topup_failed' | 'confirm_unavailable' | 'card_unavailable';
  constructor(code: PayError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

type OrderInput = {
  merchantId: string;
  items: Array<{ menu_item_id: string; qty: number }>;
  addressId?: string;
  lat?: number;
  lng?: number;
  note?: string;
  tipMinor: number;
};

/** Wallet pay: creates the order server-side with an idempotency key. */
export async function payWithWallet(args: OrderInput): Promise<Order> {
  const key = crypto.randomUUID();
  try {
    const order = await createWalletOrder({ ...args, idempotencyKey: key });
    logger.info('wallet order placed', { id: order.id, status: order.status });
    return order;
  } catch (err) {
    if (err instanceof ApiError && err.status === 402) {
      throw new PayError('insufficient', 'Wallet balance is too low. Top up first, then retry.');
    }
    throw new PayError('order_failed', err instanceof Error ? err.message : 'Order failed.');
  }
}

/** Poll one payment until paid/failed or the deadline (webhook is async). */
async function pollPayment(args: { paymentId: string; timeoutMs: number }): Promise<Payment> {
  const deadline = Date.now() + args.timeoutMs;
  let last: Payment | null = null;
  while (Date.now() < deadline) {
    const payment = await fetchPayment({ id: args.paymentId });
    last = payment;
    if (payment.status === 'paid' || payment.status === 'failed' || payment.status === 'refunded' || payment.status === 'cancelled') {
      return payment;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  if (!last) throw new PayError('confirm_unavailable', 'Could not check the payment status. Please check your orders.');
  return last;
}

/** Try the demo-mode instant confirm (same apply path as the webhook). */
async function tryDemoConfirm(args: { paymentId: string }): Promise<{ payment: Payment; order: Order | null } | null> {
  try {
    return await confirmPaymentDemo({ paymentId: args.paymentId });
  } catch (err) {
    if (err instanceof ApiError && err.status === 404) return null;
    throw err;
  }
}

/** Open the Paddle overlay for a server transaction, then poll the payment.
 * Returns the updated payment: paid (webhook applied) or still pending when
 * the webhook is slow — callers map that to placed / card_authorized. */
async function authorizeViaPaddle(args: {
  payment: Payment;
  email?: string;
  priceId?: string;
}): Promise<Payment> {
  let transactionId: string | undefined;
  let priceId = args.priceId?.trim() || undefined;
  try {
    const checkout = await createPaymentCheckout({ paymentId: args.payment.id });
    transactionId = checkout.transactionId;
    logger.info('paddle transaction created', { payment: args.payment.id, env: checkout.paddleEnv });
  } catch (err) {
    if (priceId) {
      logger.warn('payment checkout failed, falling back to price', {
        err: err instanceof Error ? err.message : 'unknown',
      });
    } else if (err instanceof ApiError && (err.status === 503 || err.status === 404)) {
      // No server Paddle key (or provider off): demo confirm handles it.
      throw new PayError(
        'paddle_missing',
        'Card payments need the server Paddle key (or demo mode). Please pay with wallet.',
      );
    } else if (priceId) {
      logger.warn('payment checkout failed, price fallback', { err: err instanceof Error ? err.message : 'unknown' });
    } else {
      throw new PayError('paddle_failed', err instanceof Error ? err.message : 'Card checkout failed.');
    }
  }
  if (!transactionId && !priceId) {
    throw new PayError(
      'paddle_missing',
      'Card checkout is not ready (no Paddle transaction). Retry, or pay with wallet.',
    );
  }
  try {
    await openPaddleCheckout({
      transactionId,
      priceId,
      email: args.email,
      paymentId: args.payment.id,
      onAuthorized: (id) => logger.info('paddle sandbox authorized', { id, payment: args.payment.id }),
    });
  } catch (err) {
    if (err instanceof PaddleError && err.code === 'missing') {
      throw new PayError('paddle_missing', err.message);
    }
    throw new PayError('paddle_failed', err instanceof Error ? err.message : 'Card payment failed.');
  }
  return pollPayment({ paymentId: args.payment.id, timeoutMs: 60_000 });
}

/** Card pay: create the `awaiting_payment` order server-side, then confirm.
 * With Paddle configured the sandbox overlay collects the card and the
 * webhook places the order; otherwise demo mode confirms instantly. */
export async function payWithCard(args: OrderInput & { email?: string; priceId?: string }): Promise<PayResult> {
  const key = crypto.randomUUID();
  let created: { order: Order; payment: Payment };
  try {
    created = await createCardOrder({ ...args, idempotencyKey: key });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      throw new PayError('card_unavailable', 'Card payments are disabled on this server (Paddle sandbox only). Please pay with wallet.');
    }
    throw new PayError('order_failed', err instanceof Error ? err.message : 'Order failed.');
  }
  logger.info('card order created, awaiting payment', { id: created.order.id, payment: created.payment.id });
  const { token } = await paddleConfig().catch(() => ({ token: null as string | null }));
  if (token || args.priceId) {
    const payment = await authorizeViaPaddle({ payment: created.payment, email: args.email, priceId: args.priceId });
    if (payment.status === 'paid') {
      // The webhook places the order in the same transaction that pays it:
      // paid payment ⇒ placed order. Re-read it so the caller can navigate.
      try {
        const detail = await fetchOrder({ id: created.order.id });
        logger.info('card order placed via webhook', { id: detail.order.id });
        return { kind: 'placed', order: detail.order };
      } catch (err) {
        logger.warn('order re-read after card pay failed', { err: err instanceof Error ? err.message : 'unknown' });
      }
    }
    if (payment.status === 'failed') {
      throw new PayError('paddle_failed', 'The card payment failed. Please retry or pay with wallet.');
    }
    return {
      kind: 'card_authorized',
      transactionId: payment.orderId ?? created.payment.id,
      totalMinor: created.order.total.amount_minor,
      currency: created.order.currency,
      orderId: created.order.id,
    };
  }
  const confirmed = await tryDemoConfirm({ paymentId: created.payment.id });
  if (confirmed?.order) {
    logger.info('card order placed via demo confirm', { id: confirmed.order.id });
    return { kind: 'placed', order: confirmed.order };
  }
  throw new PayError(
    'paddle_missing',
    'Card payments are not configured in this build (no Paddle token, server not in demo mode). Please pay with wallet.',
  );
}

/** Wallet top-up: create the pending top-up server-side, then confirm it.
 * With Paddle configured the sandbox overlay collects the card and the
 * webhook credits the wallet; otherwise demo mode credits instantly. */
export async function topUpWithPaddle(args: { amountMinor: number; currency: string; email?: string }): Promise<PayResult> {
  const key = crypto.randomUUID();
  let payment: Payment;
  try {
    payment = await createTopup({ amountMinor: args.amountMinor, currency: args.currency.toUpperCase(), idempotencyKey: key });
  } catch (err) {
    if (err instanceof ApiError && err.status === 503) {
      throw new PayError('topup_failed', 'Top-ups are disabled on this server (Paddle sandbox only).');
    }
    throw new PayError('topup_failed', err instanceof Error ? err.message : 'Top-up failed.');
  }
  logger.info('top-up created, awaiting payment', { id: payment.id });
  const { token } = await paddleConfig().catch(() => ({ token: null as string | null }));
  if (token) {
    const updated = await authorizeViaPaddle({ payment, email: args.email });
    if (updated.status === 'paid') {
      logger.info('top-up credited via webhook', { id: payment.id });
      return { kind: 'topup_credited', payment: updated };
    }
    if (updated.status === 'failed') {
      throw new PayError('topup_failed', 'The top-up payment failed. Please retry.');
    }
    return { kind: 'card_authorized', transactionId: updated.id, totalMinor: updated.amountMinor, currency: updated.currency, orderId: null };
  }
  const confirmed = await tryDemoConfirm({ paymentId: payment.id });
  if (confirmed && confirmed.payment.status === 'paid') {
    logger.info('top-up credited via demo confirm', { id: payment.id });
    return { kind: 'topup_credited', payment: confirmed.payment };
  }
  throw new PayError(
    'paddle_missing',
    'Top-ups are not configured in this build (no Paddle token, server not in demo mode).',
  );
}
