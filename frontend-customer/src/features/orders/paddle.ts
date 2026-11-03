/**
 * Paddle Billing overlay for the customer PWA (openapi `createPaymentCheckout`).
 *
 * Paddle Billing checkouts need either a pre-created price or — for arbitrary
 * wallet top-up / order totals — a server-created transaction opened by id.
 * The old code passed an ad-hoc `amount` with no price, which Paddle rejects
 * with `required price_id`. This module only ever opens the overlay with a
 * `transactionId` from `POST /customer/payments/{id}/checkout` (preferred) or
 * an explicit `priceId` when the caller has one. Amount-only opens are refused
 * with a typed error instead of reaching Paddle.
 *
 * Card data never touches this app: Paddle.js renders its own overlay; we
 * only load the CDN script and hand it the server transaction.
 */
import { ApiError, api } from '../../lib/api';
import { logger } from '../../lib/logger';

/** Typed Paddle failure for user-safe messages. */
export class PaddleError extends Error {
  code: 'missing' | 'load_failed' | 'no_transaction' | 'open_failed';
  constructor(code: PaddleError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

type PaddleCheckoutOpen = {
  transactionId?: string;
  priceId?: string;
  customer?: { email?: string };
  settings?: Record<string, unknown>;
};

type PaddleInstance = {
  Checkout: { open: (args: PaddleCheckoutOpen) => void };
};

declare global {
  interface Window {
    Paddle?: {
      Environment: { set: (env: string) => void };
      Initialize: (args: { token: string }) => void;
    } & Partial<PaddleInstance>;
  }
}

const PADDLE_CDN = 'https://cdn.paddle.com/paddle/v2/paddle.js';

type PublicPayments = {
  provider?: string;
  paddle_env?: string;
  paddle_client_token?: string;
  card_enabled?: boolean;
};

let cachedToken: string | null | undefined;
let cachedEnv: 'sandbox' | 'production' | undefined;
let loadPromise: Promise<PaddleInstance> | null = null;

function buildToken(): string | null {
  const token = import.meta.env.VITE_PADDLE_CLIENT_TOKEN as string | undefined;
  return token && token.length > 0 ? token : null;
}

function buildEnv(): 'sandbox' | 'production' {
  return (import.meta.env.VITE_PADDLE_ENV as string | undefined) === 'production'
    ? 'production'
    : 'sandbox';
}

/** Resolve the client token + env: build-time VITE vars first, then the
 * server public config (so a sandbox/production mismatch shows clearly). */
export async function paddleConfig(): Promise<{ token: string | null; env: 'sandbox' | 'production' }> {
  if (cachedToken !== undefined && cachedEnv !== undefined) {
    return { token: cachedToken, env: cachedEnv };
  }
  const build = { token: buildToken(), env: buildEnv() };
  try {
    const res = await api<{ payments?: PublicPayments }>('/config/public');
    const server = res.payments;
    const token = build.token ?? (typeof server?.paddle_client_token === 'string' && server.paddle_client_token !== ''
      ? server.paddle_client_token
      : null);
    const env = build.token
      ? build.env
      : server?.paddle_env === 'production' ? 'production' : 'sandbox';
    cachedToken = token;
    cachedEnv = env;
    return { token, env };
  } catch (err) {
    logger.warn('paddle public config fallback to build env', {
      err: err instanceof ApiError ? err.message : 'unknown',
    });
    cachedToken = build.token;
    cachedEnv = build.env;
    return build;
  }
}

/** Lazy-load Paddle.js and initialise with the client token (single-flight). */
export function loadPaddle(): Promise<PaddleInstance> {
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const { token, env } = await paddleConfig();
    if (!token) {
      throw new PaddleError('missing', 'Card payments are not configured in this build. Please pay with wallet.');
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
      tag.onerror = () => reject(new PaddleError('load_failed', 'Could not load the card payment form. Try wallet pay.'));
      if (!script) document.head.appendChild(tag);
    });
    const paddle = window.Paddle;
    if (!paddle?.Environment || !paddle?.Initialize || !paddle?.Checkout) {
      throw new PaddleError('load_failed', 'Card payment form failed to start. Try wallet pay.');
    }
    paddle.Environment.set(env);
    paddle.Initialize({ token });
    if (env === 'sandbox') logger.info('paddle sandbox overlay ready', {});
    return paddle as PaddleInstance;
  })().catch((err) => {
    loadPromise = null;
    throw err;
  });
  return loadPromise;
}

type OpenCheckoutArgs = {
  transactionId?: string;
  priceId?: string;
  email?: string;
  paymentId: string;
  onAuthorized: (transactionId: string) => void;
};

/** Open the Paddle overlay for a server-created transaction (or explicit
 * price). Refuses amount-only opens — the exact `required price_id` failure. */
export async function openPaddleCheckout(args: OpenCheckoutArgs): Promise<void> {
  const transactionId = args.transactionId?.trim() || undefined;
  const priceId = args.priceId?.trim() || undefined;
  if (!transactionId && !priceId) {
    throw new PaddleError(
      'no_transaction',
      'Card checkout is not ready yet (no Paddle transaction). Please retry — if it persists the server Paddle key is missing.',
    );
  }
  const paddle = await loadPaddle();
  try {
    if (transactionId) {
      paddle.Checkout.open({
        transactionId,
        customer: args.email ? { email: args.email } : undefined,
        settings: {
          theme: 'dark',
          successUrl: `${location.origin}/customer/orders?card=authorized`,
        },
      });
      // Paddle v2 with a transaction id closes the overlay on success without
      // a reliable callback across versions: resolve through the caller's
      // payment poll (see pay.ts), not a checkoutCompleted hook here.
      args.onAuthorized(transactionId);
      return;
    }
    paddle.Checkout.open({
      priceId,
      customer: args.email ? { email: args.email } : undefined,
      settings: {
        theme: 'dark',
        successUrl: `${location.origin}/customer/orders?card=authorized`,
      },
    });
    args.onAuthorized(args.paymentId);
  } catch (err) {
    throw new PaddleError('open_failed', err instanceof Error ? err.message : 'Card payment failed.');
  }
}

/** Test hook: reset cached config + loader between tests. */
export function resetPaddleForTests(): void {
  cachedToken = undefined;
  cachedEnv = undefined;
  loadPromise = null;
}
