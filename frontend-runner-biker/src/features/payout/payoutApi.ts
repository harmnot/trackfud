/**
 * Payout currencies + FX conversion for the courier PWA (openapi `listCurrencies`,
 * `getFxRate`, `payoutInfo`). All lists and rates come from the API — the PWA
 * never hardcodes currencies or conversion numbers.
 */
import { ApiError, api } from '../../lib/api';
import { logger } from '../../lib/logger';

export type PayoutCurrency = {
  code: string;
  paddle_supported: boolean;
};

export type FxRate = {
  from: string;
  to: string;
  rate: number;
  source: string;
  updated_at: string;
  paddle_supported_from: boolean;
  paddle_supported_to: boolean;
  stale: boolean;
};

export type PayoutInfo = {
  country_currency: string;
  settle_currency: string;
  paddle_supported: boolean;
  rate: number;
  rate_source: string;
  rate_updated_at: string | null;
};

/** List every platform payout currency with its Paddle flag. */
export async function fetchPayoutCurrencies(): Promise<PayoutCurrency[]> {
  try {
    const d = await api<{ currencies: PayoutCurrency[] }>('/fx/currencies');
    return Array.isArray(d.currencies) ? d.currencies : [];
  } catch (e) {
    logger.warn('payout currencies failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Live conversion rate with freshness metadata (stale rows refresh server-side). */
export async function fetchFxRate(params: { from: string; to: string }): Promise<FxRate> {
  try {
    return await api<FxRate>(`/fx/rate?from=${encodeURIComponent(params.from)}&to=${encodeURIComponent(params.to)}`);
  } catch (e) {
    logger.warn('fx rate failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/**
 * Which currency Paddle will actually pay: the country currency when Paddle
 * supports it, else USD with the live rate. Pass the courier's country or an
 * explicit currency; the server maps countries to currencies.
 */
export async function fetchPayoutInfo(params: { currency?: string; country?: string }): Promise<PayoutInfo> {
  try {
    const q = new URLSearchParams();
    if (params.currency) q.set('currency', params.currency);
    if (params.country) q.set('country', params.country);
    const suffix = q.toString() ? `?${q.toString()}` : '';
    return await api<PayoutInfo>(`/fx/payout-info${suffix}`);
  } catch (e) {
    logger.warn('payout info failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}
