/**
 * Stride & Earn account data: personal data + partner state composed from
 * the real backend contract (`GET /auth/me`, `GET /courier/profile`,
 * `GET /courier/application`). No local fallback invents personal data —
 * callers show loading / error / empty states honestly.
 */
import { api } from '../../lib/api';

/** `GET /auth/me` (openapi `me`). */
export type Me = {
  id: string;
  email: string;
  name: string;
  phone: string;
  roles: string[];
  email_verified: boolean;
};

/** Address object stored on the partner profile (`couriers.address`). */
export type ProfileAddress = {
  street?: string;
  city?: string;
  country?: string;
  [key: string]: unknown;
};

/** Inner profile of `GET /courier/profile` (openapi `getCourierProfile`). */
export type CourierProfile = {
  legal_name?: string;
  phone?: string;
  address?: ProfileAddress;
  mode?: string;
  status?: string;
};

/** `GET /courier/profile` envelope. */
export type ProfileResponse = {
  status: string;
  mode: string;
  profile: CourierProfile;
};

/** `GET /courier/application` (openapi `getApplication`). */
export type Application = {
  status: string;
  mode: string;
  reject_reason?: string;
  fitness?: { passed: boolean };
};

/** Partner lifecycle seen by ordinary runner/biker accounts. */
export type PartnerState = 'none' | 'draft' | 'pending' | 'approved' | 'rejected';

/** Map a raw application status to the account-page partner state. */
export function partnerStateOf(status: string | undefined | null): PartnerState {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'pending':
    case 'pending_review':
      return 'pending';
    case 'rejected':
      return 'rejected';
    case 'none':
    case '':
    case undefined:
    case null:
      return 'none';
    default:
      return 'draft';
  }
}

/** True when deliveries + earnings are unlocked (partner or staff mode). */
export function isPartnerUnlocked(args: { partner: PartnerState; staffActive: boolean }): boolean {
  return args.partner === 'approved' || args.staffActive;
}

/** Load the signed-in user's personal data (`GET /auth/me`). */
export async function fetchMe(): Promise<Me> {
  return api<Me>('/auth/me');
}

/** Load the partner profile incl. address (`GET /courier/profile`). */
export async function fetchProfile(): Promise<ProfileResponse> {
  return api<ProfileResponse>('/courier/profile');
}

/** Load the partner application + fitness state (`GET /courier/application`). */
export async function fetchApplication(): Promise<Application> {
  return api<Application>('/courier/application');
}

/** One-line address for display; empty string when nothing is stored. */
export function formatAddress(address: ProfileAddress | undefined): string {
  if (!address) return '';
  const street = typeof address.street === 'string' ? address.street.trim() : '';
  const city = typeof address.city === 'string' ? address.city.trim() : '';
  const country = typeof address.country === 'string' ? address.country.trim() : '';
  return [street, city, country].filter(Boolean).join(', ');
}
