/** Merchant earnings API: settled totals + weekly buckets from GET /v1/merchant/earnings. */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';

export interface EarningsTotal {
  currency: string;
  orders: number;
  gross_minor: number;
  commission_minor: number;
  net_minor: number;
  payable_minor?: number;
  lifetime_minor?: number;
}

export interface EarningsWeek {
  week_start: string;
  currency: string;
  orders: number;
  gross_minor: number;
  commission_minor: number;
  net_minor: number;
}

export interface MerchantEarnings {
  totals: EarningsTotal[];
  weeks: EarningsWeek[];
  payouts_note?: string;
}

/** Fetch settled earnings for the caller's store (server-computed, no mocks). */
export async function fetchMerchantEarnings(params: { weeks?: number } = {}): Promise<MerchantEarnings> {
  const q = params.weeks ? `?weeks=${params.weeks}` : '';
  try {
    const data = await api<MerchantEarnings>(`/merchant/earnings${q}`);
    return {
      totals: Array.isArray(data.totals) ? data.totals : [],
      weeks: Array.isArray(data.weeks) ? data.weeks : [],
      payouts_note: data.payouts_note,
    };
  } catch (e) {
    logger.warn('fetchMerchantEarnings failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}
