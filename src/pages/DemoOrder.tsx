import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/Shell'
import { Alert, LinkButton, Skeleton } from '@/components/ui'
import { api, ApiRequestError } from '@/lib/api'
import { safeHttpUrl, txUrl } from '@/lib/format'
import { usePublicConfig } from '@/lib/hooks'
import { Link } from '@/lib/route'
import type { DemoOrder as Order } from '@/lib/types'

/**
 * Where checkout sends the customer back. Arriving here proves nothing: the demo server asks the payments API
 * for the order's real status on every poll and only shows "paid" when that API reports a settled payment.
 */
export function DemoOrder({ orderId }: { orderId: string }) {
  const config = usePublicConfig()
  const order = useQuery({
    queryKey: ['demo-order', orderId],
    queryFn: () => api<Order>(`/demo/orders/${orderId}`),
    refetchInterval: (query) => {
      const f = query.state.data?.fulfilment
      return f === 'paid' || f === 'failed' || f === 'expired' ? false : 4000
    },
    retry: (count, error) => !(error instanceof ApiRequestError && error.status === 404) && count < 2,
  })

  if (order.isPending) return <Shell><Skeleton className="h-8 w-1/2" /><Skeleton className="mt-4 h-24" /></Shell>
  if (order.isError) {
    return (
      <Shell>
        <h1 className="display text-2xl font-bold">Order not found</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">We could not find this order.</p>
        <LinkButton href="/demo" variant="secondary" className="mt-4">Back to the store</LinkButton>
      </Shell>
    )
  }

  const o = order.data
  const chainId = config.data?.chain_id
  const link = o.settlement_tx_hash && chainId ? txUrl(chainId, o.settlement_tx_hash) : null
  const checkout = safeHttpUrl(o.checkout_url)

  return (
    <Shell>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Demo order</p>
      <h1 className="display mt-1 text-3xl font-bold">{o.product?.name ?? 'Order'}</h1>
      <p className="mt-1 text-[var(--ink-2)]"><span className="tabular-nums">{o.amount}</span> USDC</p>

      <div className="mt-5" aria-live="polite">
        {o.fulfilment === 'paid' && (
          <div className="space-y-3">
            <Alert tone="success" title="Order paid">
              The payments API reports this payment as settled to the merchant{o.confirmed_via === 'webhook' ? ' (confirmed by a signed webhook)' : ''}. In a real store this is when you would fulfil the order.
            </Alert>
            {link && <LinkButton href={link} external variant="secondary">View settlement transaction <ExternalLink size={14} aria-hidden /></LinkButton>}
          </div>
        )}
        {o.fulfilment === 'pending' && (
          <div className="space-y-3">
            <Alert tone="info" title="Order pending">
              Waiting for the payments API to report settlement. Coming back from checkout is not payment: this page updates only when the payment is verified.
            </Alert>
            {o.verification === 'unavailable' && (
              <Alert tone="warning" title="Verification is temporarily unavailable">We could not ask the payments API just now. Still pending.</Alert>
            )}
            {checkout && <LinkButton href={checkout} variant="secondary">Back to checkout</LinkButton>}
          </div>
        )}
        {o.fulfilment === 'expired' && (
          <Alert tone="warning" title="The payment window closed">No payment was settled for this order. Start a new order for a new payment address.</Alert>
        )}
        {o.fulfilment === 'attention' && (
          <Alert tone="warning" title="Payment needs attention">
            A transfer was seen but the order was not completed (incomplete or late). The funds are returned through the refund process. Nothing is marked paid.
          </Alert>
        )}
        {o.fulfilment === 'failed' && (
          <Alert tone="danger" title="The payment could not be created">No payment was started for this order.</Alert>
        )}
      </div>

      <p className="mt-6"><Link to="/demo" className="text-sm font-medium text-[var(--accent-hover)] underline-offset-2 hover:underline">Back to the store</Link></p>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-lg pt-6"><Card className="p-5 sm:p-7">{children}</Card></div>
}
