import { useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Card } from '@/components/Shell'
import { Alert, Button, Skeleton } from '@/components/ui'
import { api } from '@/lib/api'
import { errorMessage, usePublicConfig } from '@/lib/hooks'
import { safeHttpUrl } from '@/lib/format'
import type { DemoProduct } from '@/lib/types'

interface Catalogue { enabled: boolean; products: DemoProduct[] }

/**
 * Sample storefront. The button calls the demo SERVER, which holds the demo merchant's API key and creates the
 * payment. This page never sees a key and never decides that anything was paid.
 */
export function Demo() {
  const config = usePublicConfig()
  const catalogue = useQuery({ queryKey: ['demo-products'], queryFn: () => api<Catalogue>('/demo/products') })
  const [pendingId, setPendingId] = useState<string | null>(null)

  const buy = useMutation({
    mutationFn: (productId: string) =>
      api<{ order_id: string; checkout_url: string }>('/demo/orders', { method: 'POST', body: { product_id: productId } }),
    onSuccess: (order) => {
      // Only follow a link that is a plain http(s) URL returned by our own server.
      const url = safeHttpUrl(order.checkout_url)
      if (url) window.location.assign(url)
    },
    onSettled: () => setPendingId(null),
  })

  const live = config.data?.livemode

  return (
    <div className="mx-auto max-w-3xl space-y-6 pt-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Demo storefront</p>
        <h1 className="display mt-2 text-4xl font-bold sm:text-5xl">Acqui Demo Store</h1>
        <p className="mt-3 max-w-xl text-pretty text-[var(--ink-2)]">
          A tiny store wired to Acqui the way your own site would be. Choosing Pay with USDC creates a real payment on {live === false ? 'Arc Testnet' : 'Arc'} and sends you to hosted checkout.
          Nothing ships: this store exists to show the payment.
        </p>
      </header>

      {config.data && !config.data.livemode && (
        <Alert tone="info" title="Test mode">This server runs on Arc Testnet. Testnet USDC has no real value.</Alert>
      )}
      {config.data && !config.data.payments_ready && (
        <Alert tone="warning" title="Payments are not enabled on this server yet">
          The payment contracts are not configured here, so checkout cannot be created. No payment is simulated.
        </Alert>
      )}
      {catalogue.data && !catalogue.data.enabled && (
        <Alert tone="warning" title="The demo store is not configured">
          The demo merchant key is not set on this server, so purchases are switched off.
        </Alert>
      )}
      {buy.isError && (
        <Alert tone="danger" title="Could not start the payment">{errorMessage(buy.error)}</Alert>
      )}
      {catalogue.isError && <Alert tone="danger" title="Could not load the store">{errorMessage(catalogue.error)}</Alert>}

      <div className="grid gap-4 sm:grid-cols-2">
        {catalogue.isPending && (<><Skeleton className="h-56" /><Skeleton className="h-56" /></>)}
        {catalogue.data?.products.map((product) => (
          <Card key={product.id} className="flex flex-col justify-between">
            <div>
              <div aria-hidden className="mb-4 flex h-28 items-center justify-center rounded-2xl bg-[var(--surface-muted)] text-5xl">
                {product.id === 'canvas-tote' ? '👜' : '✨'}
              </div>
              <h2 className="display text-xl font-semibold">{product.name}</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">{product.blurb}</p>
            </div>
            <div className="mt-5 flex items-center justify-between gap-3">
              <span className="display text-2xl font-bold tabular-nums">{product.price} <span className="text-base text-[var(--ink-2)]">USDC</span></span>
              <Button
                busy={pendingId === product.id}
                disabled={!catalogue.data?.enabled || buy.isPending}
                onClick={() => { setPendingId(product.id); buy.mutate(product.id) }}
              >
                Pay with USDC
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </div>
  )
}
