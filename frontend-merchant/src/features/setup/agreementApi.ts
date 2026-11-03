/** Merchant agreement status: typed fetch for the e-sign page (openapi.yaml MerchantAgreementStatus). */
import { api, ApiError } from '../../lib/api';
import { logger } from '../../lib/logger';

export interface AgreementText {
  version: string;
  text: string;
  sha256?: string;
}

export interface AgreementStatus {
  version: string;
  signer_name: string;
  agreed: boolean;
  signed_at: string;
  merchant_status: string;
  signed: boolean;
}

export interface AgreementStatusResponse {
  agreement: AgreementStatus | null;
  merchant_status?: string;
}

export interface SignResult {
  id: string;
  status: string;
  version: string;
  signed_at?: string;
  duplicate?: boolean;
}

/** Current partner-agreement text + version. */
export async function fetchAgreementText(): Promise<AgreementText> {
  try {
    return await api<AgreementText>('/merchant/agreement/current');
  } catch (e) {
    logger.warn('fetchAgreementText failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Latest signature for this store (null when never signed). */
export async function fetchMyAgreement(): Promise<AgreementStatusResponse> {
  try {
    return await api<AgreementStatusResponse>('/merchant/merchants/me/agreement');
  } catch (e) {
    logger.warn('fetchMyAgreement failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Sign the current agreement version (idempotent: same version returns the original row). */
export async function signAgreement(params: {
  signerName: string;
  agreed: boolean;
  version?: string;
}): Promise<SignResult> {
  try {
    return await api<SignResult>('/merchant/merchants/me/agreement', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': crypto.randomUUID(),
      },
      body: JSON.stringify({
        signer_name: params.signerName,
        agreed: params.agreed,
        version: params.version,
      }),
    });
  } catch (e) {
    logger.warn('signAgreement failed', { err: e instanceof ApiError ? e.message : 'unknown' });
    throw e;
  }
}

/** Format an ISO timestamp as a local date + time for the signed banner. */
export function formatSignedAt(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(d);
  } catch {
    return iso;
  }
}
