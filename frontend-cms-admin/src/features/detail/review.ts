import { ApiError } from '../../lib/api';
import type { CourierApplication, CourierProfile } from '../../lib/types';
import type { BriefView } from '../../lib/trust';

/** Application statuses the backend still lets an admin decide. A courier
 * mid-test ("testing") is never decidable: only submitted applications
 * (pending/pending_review/passed_test) can be approved or rejected. */
export const DECIDABLE_APPLICATION = ['pending', 'pending_review', 'passed_test'];

/** Sanction kinds that need no reason (restorative actions). */
export const REASON_OPTIONAL = ['unfreeze', 'unban'];

/** Merchant statuses where the admin decision card is shown. Anything else
 * (approved / rejected / banned / draft) hides Approve + Reject — a rejected
 * merchant shows its reason + updated_at instead. */
export const DECIDABLE_MERCHANT = ['pending'];

/** No automatic retries for 404s; one retry for transient failures. */
export function detailRetry(failureCount: number, error: Error): boolean {
  if (error instanceof ApiError && error.status === 404) return false;
  return failureCount < 1;
}

export type CourierReview = {
  app: CourierApplication | null;
  profile: CourierProfile | null;
  brief: BriefView | null;
  briefPending: boolean;
};

export type SanctionTarget = 'courier' | 'merchant';

export type SanctionInput = {
  kind: string;
  reason: string;
  note: string;
  endsAt: string;
};

/** True when the courier decision card should render (submitted, undecided). */
export function isCourierDecidable(status: string | undefined): boolean {
  if (!status) return false;
  return DECIDABLE_APPLICATION.includes(status);
}

/** True when the merchant decision card should render (pending review). */
export function isMerchantDecidable(status: string | undefined): boolean {
  if (!status) return false;
  return status === 'pending';
}
