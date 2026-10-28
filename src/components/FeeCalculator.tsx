import { useState } from 'react'
import { formatUsdc } from '@/onchain-money'
import { MIN_PAYMENT_AMOUNT, computeGatewayFee, usdcAmountSchema } from '@acqui/shared'
import { Card } from '@/components/Shell'

/** Pure policy preview of the gateway fee. A small fixed network reimbursement is also deducted and shown on each payment. */
export function FeeCalculator() {
  const [input, setInput] = useState('25.00')
  const parsed = usdcAmountSchema.safeParse(input)
  const gross = parsed.success ? parsed.data : null
  const fee = gross === null ? null : computeGatewayFee(gross)

  return (
    <Card>
      <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Fee preview</p>
      <label htmlFor="amount" className="mt-3 block text-sm font-medium text-[var(--ink-2)]">
        Payment amount (USDC)
      </label>
      <input
        id="amount"
        inputMode="decimal"
        value={input}
        onChange={(event) => setInput(event.target.value)}
        className="display mt-1 w-full rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] px-4 py-3 text-3xl font-semibold tabular-nums outline-none focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]"
      />
      {!parsed.success && (
        <p className="mt-2 text-sm text-[var(--danger)]">
          {parsed.error.issues[0]?.message ?? 'Invalid amount'}
        </p>
      )}
      <dl className="mt-4 space-y-2 rounded-2xl bg-[var(--surface-muted)] p-4 text-sm tabular-nums">
        <Row label="Gateway fee" value={fee === null ? '-' : `${formatUsdc(fee)} USDC`} />
        <Row label="Before network reimbursement" value={gross === null || fee === null ? '-' : `${formatUsdc(gross - fee)} USDC`} />
      </dl>
      <p className="mt-3 text-xs text-[var(--subtle)]">
        Fee is the greater of 0.10 USDC and 0.1% of the payment. Minimum payment {formatUsdc(MIN_PAYMENT_AMOUNT)} USDC.
      </p>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-[var(--muted)]">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  )
}
