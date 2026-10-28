import { ExternalLink } from 'lucide-react'
import { Alert, Button, Pill, Skeleton } from '@/components/ui'
import { formatWhen, sanitizeText, txUrl } from '@/lib/format'
import { errorMessage } from '@/lib/hooks'
import { usePayments } from '@/lib/merchant'
import { PHASE_LABEL, statusTone } from '@/lib/status'
import type { MerchantPayment } from '@/lib/types'

export function PaymentsTab() {
  const q = usePayments()
  const rows = q.data?.pages.flatMap((p) => p.data) ?? []

  if (q.isPending) return <Skeleton className="h-40" />
  if (q.isError) return <Alert tone="danger" title="Could not load payments">{errorMessage(q.error)}</Alert>
  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--border-strong)] p-8 text-center">
        <p className="font-semibold">No payments yet</p>
        <p className="mt-1 text-sm text-[var(--muted)]">Payments created by your server appear here. The Integration tab has a ready-made request.</p>
      </div>
    )
  }
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-[var(--border)] rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)]">
        {rows.map((p) => <Row key={p.payment_id} p={p} />)}
      </ul>
      {q.hasNextPage && <Button variant="secondary" busy={q.isFetchingNextPage} onClick={() => void q.fetchNextPage()}>Load more</Button>}
    </div>
  )
}

function Row({ p }: { p: MerchantPayment }) {
  const link = p.settlement ? txUrl(p.chain_id, p.settlement.tx_hash) : null
  return (
    <li className="grid gap-2 p-4 sm:grid-cols-[1fr_auto_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-medium">{sanitizeText(p.order_id, 80)}</p>
        <p className="text-xs text-[var(--muted)]">{formatWhen(p.created_at)}{p.description ? ` · ${sanitizeText(p.description, 60)}` : ''}</p>
        <p className="mono mt-1 break-all text-[11px] text-[var(--subtle)]">{p.payment_id}</p>
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <span className="display text-lg font-semibold tabular-nums">{p.amount} <span className="text-xs text-[var(--muted)]">USDC</span></span>
        {p.status === 'settled' && <span className="text-xs text-[var(--muted)]">net {p.fees.merchant_net}</span>}
      </div>
      <div className="flex items-center gap-3 sm:flex-col sm:items-end sm:gap-1">
        <Pill tone={statusTone(p.status)}>{PHASE_LABEL[p.status]}</Pill>
        {link && (
          <a href={link} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center gap-1 text-xs font-medium text-[var(--accent-hover)] hover:underline">
            Transaction <ExternalLink size={12} aria-hidden />
          </a>
        )}
      </div>
    </li>
  )
}
