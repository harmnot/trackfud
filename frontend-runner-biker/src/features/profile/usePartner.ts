import { useQuery } from '@tanstack/react-query';
import {
  fetchApplication,
  isPartnerUnlocked,
  partnerStateOf,
  standingOf,
  type PartnerState,
} from './profileApi';
import { useStaff } from '../staff/staffStore';

/**
 * Shared partner gate: deliveries + earnings unlock for approved partners
 * or clocked-in merchant staff. One query key for the whole app so the
 * nav, delivery and wallet screens never disagree. `sanctioned` mirrors an
 * admin freeze/ban (operational standing): new sessions and offers are
 * blocked server-side, the wallet stays open per plan 8.4, and callers show
 * the matching notice instead of the normal CTA.
 */
export function usePartner(args?: { enabled?: boolean }): {
  partner: PartnerState;
  unlocked: boolean;
  sanctioned: boolean;
  standing: string;
  isLoading: boolean;
} {
  const staffActive = useStaff((s) => s.active);
  const appQ = useQuery({
    queryKey: ['partner-application'],
    queryFn: fetchApplication,
    enabled: args?.enabled ?? true,
    retry: false,
    staleTime: 30_000,
  });
  const partner = partnerStateOf(appQ.data?.status);
  const standing = standingOf(appQ.data, undefined);
  return {
    partner,
    unlocked: isPartnerUnlocked({ partner, staffActive }),
    sanctioned: standing === 'frozen' || standing === 'banned',
    standing,
    isLoading: appQ.isLoading,
  };
}
