/** Shared pay module: wallet pay (idempotent) + card via a server-created
 * Paddle payment confirmed by the webhook (or instantly in demo mode).
 * Card data never touches the app: Paddle.js renders its own overlay. */

import { ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';
import { confirmPaymentDemo, createCardOrder, createTopup, createWalletOrder } from './api';
import type { Order, Payment } from './types';

export type PayMethod = 'wallet' | 'card';

export type PayResult =
  | { kind: 'placed'; order: Order }
  | { kind: 'card_authorized'; transactionId: string; totalMinor: number; currency: string }
  | { kind: 'topup_credited'; payment: Payment };

/** Typed pay failure for user-safe messages. */
export class PayError extends Error {
  code: 'insufficient' | 'paddle_missing' | 'paddle_failed' | 'order_failed' | 'topup_failed' | 'confirm_unavailable' | 'card_unavailable';
  constructor(code: PayError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

type PaddleCheckoutArgs = {
  items: Array<{ priceId?: string; quantity: number; amount?: string }>;
  customer?: { email?: string };
};

type PaddleInstance = {
  Checkout: { open: (args: PaddleCheckoutArgs & { settings?: Record<string, unknown> }) => void };
};

declare global {
  interface Window {
    Paddle?: { Setup: (args: { token: string }) => void } & Partial<PaddleInstance>;
  }
}

const PADDLE_CDN = 'https://cdn.paddle.com/paddle/v2/paddle.js';

function paddleToken(): string | null {
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  return token && token.length > 0 ? token : null;
}

function paddleEnv(): 'sandbox' | 'production' {
  return (import.meta.env.VITE_PADDLE_ENV as string | undefined) === 'production' ? 'production' : 'sandbox';
}

/** Lazy-load Paddle.js (CDN) and initialise with the client token. */
async function loadPaddle(): Promise<PaddleInstance> {
  const token = paddleToken();
  if (!token) {
    throw new PayError('paddle_missing', 'Card payments are not configured in this build. Please pay with wallet.');
  }
  if (window.Paddle?.Checkout) return window.Paddle as PaddleInstance;
  await new Promise<void>((resolve, reject) => {
    const script = document.querySelector<HTMLScriptElement>('script[data-paddle]');
    if (script?.dataset['loaded'] === 'true') {
      resolve();
      return;
    }
    const tag = script ?? document.createElement('script');
    tag.src = PADDLE_CDN;
    tag.async = true;
    tag.dataset['paddle'] = 'true';
    tag.onload = () => {
      tag.dataset['loaded'] = 'true';
      resolve();
    };
    tag.onerror = () => reject(new PayError('paddle_failed', 'Could not load the card payment form. Try wallet pay.'));
    if (!script) document.head.appendChild(tag);
  });
  if (!window.Paddle) throw new PayError('paddle_failed', 'Card payment form failed to start. Try wallet pay.');
  window.Paddle.Setup({ token });
  if (paddleEnv() === 'sandbox') logger.info('paddle sandbox overlay ready', {});
  return window.Paddle as PaddleInstance;
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

/** Open the Paddle sandbox overlay for an already-created server payment. */
function openPaddleOverlay(args: {
  payment: Payment;
  email?: string;
  priceId?: string;
  totalMinor: number;
  currency: string;
}): Promise<PayResult> {
  return loadPaddle().then((paddle) => new Promise<PayResult>((resolve, reject) => {
    const amount = (args.totalMinor / 100).toFixed(2);
    try {
      paddle.Checkout.open({
        items: [{ priceId: args.priceId, quantity: 1, amount: args.priceId ? undefined : amount }],
        customer: args.email ? { email: args.email } : undefined,
        settings: {
          theme: 'dark',
          customData: { payment_id: args.payment.id },
          successUrl: `${location.origin}/customer/orders?card=authorized`,
          checkoutCompleted: (tx: unknown) => {
            const id = typeof tx === 'object' && tx !== null
              ? String((tx as Record<string, unknown>)['id'] ?? args.payment.id)
              : args.payment.id;
            logger.info('paddle sandbox authorized', { id, payment: args.payment.id });
            resolve({ kind: 'card_authorized', transactionId: id, totalMinor: args.totalMinor, currency: args.currency });
          },
        },
      });
    } catch (err) {
      reject(new PayError('paddle_failed', err instanceof Error ? err.message : 'Card payment failed.'));
    }
  }));
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

/** Card pay: create the `awaiting_payment` order server-side, then confirm.
 * With a Paddle client token the sandbox overlay collects the card and the
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
  if (paddleToken()) {
    return openPaddleOverlay({
      payment: created.payment,
      email: args.email,
      priceId: args.priceId,
      totalMinor: created.order.total.amount_minor,
      currency: created.order.currency,
    });
  }
  const confirmed = await tryDemoConfirm({ paymentId: created.payment.id });
  if (confirmed?.order) {
    logger.info('card order placed via demo confirm', { id: confirmed.order.id });
    return { kind: 'placed', order: confirmed.order };
  }
  if (confirmed) {
    return { kind: 'card_authorized', transactionId: created.payment.id, totalMinor: created.order.total.amount_minor, currency: created.order.currency };
  }
  throw new PayError(
    'paddle_missing',
    'Card payments are not configured in this build (no Paddle token, server not in demo mode). Please pay with wallet.',
  );
}

/** Wallet top-up: create the pending top-up server-side, then confirm it.
 * With a Paddle client token the sandbox overlay collects the card and the
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
  if (paddleToken()) {
    const overlay = await openPaddleOverlay({
      payment,
      email: args.email,
      totalMinor: payment.amountMinor,
      currency: payment.currency,
    });
    if (overlay.kind === 'card_authorized') {
      const confirmed = await tryDemoConfirm({ paymentId: payment.id });
      if (confirmed && confirmed.payment.status === 'paid') {
        return { kind: 'topup_credited', payment: confirmed.payment };
      }
    }
    return overlay;
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
