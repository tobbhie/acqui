import { useInfiniteQuery, useQuery, type QueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'
import type { ApiKeyInfo, MerchantPayment, MerchantSettings } from '@/lib/types'

export const useMerchant = (enabled: boolean) =>
  useQuery({ queryKey: ['merchant'], enabled, queryFn: () => api<MerchantSettings>('/v1/merchant') })

export const useApiKeys = () =>
  useQuery({ queryKey: ['api-keys'], queryFn: () => api<{ data: ApiKeyInfo[] }>('/v1/merchant/api-keys').then((r) => r.data) })

export function usePayments() {
  return useInfiniteQuery({
    queryKey: ['payments'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api<{ data: MerchantPayment[]; next_cursor: string | null }>(`/v1/payments?limit=20${pageParam ? `&cursor=${encodeURIComponent(pageParam)}` : ''}`),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    refetchInterval: 10_000,
  })
}

export const refreshMerchant = async (qc: QueryClient): Promise<void> => {
  await Promise.all([qc.invalidateQueries({ queryKey: ['merchant'] }), qc.invalidateQueries({ queryKey: ['session'] })])
}
