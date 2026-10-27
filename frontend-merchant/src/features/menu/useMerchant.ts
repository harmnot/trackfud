/** Shared merchant profile query for menu pages (currency + prep time). */
import { useQuery } from '@tanstack/react-query';
import { api } from '../../lib/api';
import type { MerchantProfile } from './api';

interface MeResponse {
  merchant: (MerchantProfile & { id: string; status: string }) | null;
}

/** Caller's store profile; null before the store exists (M1 setup). */
export function useMerchant(): { profile: MeResponse['merchant']; currency: string; refetch: () => void } {
  const q = useQuery({
    queryKey: ['merchant-me'],
    queryFn: () => api<MeResponse>('/merchant/merchants/me'),
  });
  return {
    profile: q.data?.merchant ?? null,
    currency: q.data?.merchant?.currency ?? 'IDR',
    refetch: () => {
      void q.refetch();
    },
  };
}
