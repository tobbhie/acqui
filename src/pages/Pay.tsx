import { useQuery } from '@tanstack/react-query'
import { ExternalLink } from 'lucide-react'
import { Card } from '@/components/Shell'
import { Steps } from '@/components/checkout/Steps'
import { PayInstructions } from '@/components/checkout/PayInstructions'
import { Alert, LinkButton, Pill, Skeleton } from '@/components/ui'
import { api, ApiRequestError } from '@/lib/api'
import { safeHttpUrl, sanitizeText, txUrl } from '@/lib/format'
import { errorMessage, useNow } from '@/lib/hooks'
import { checkoutPhase, pollIntervalMs, remainingMs, statusTone, PHASE_LABEL, type CheckoutPhase } from '@/lib/status'
import { formatCountdown } from '@/lib/format'
import type { PublicPayment, PublicStatus } from '@/lib/types'
import { usePageMeta } from '@/lib/meta'

/** Hosted checkout. Reads the database-backed public API only: the browser never queries the chain. */
export function Pay({ publicId }: { publicId: string }) {
  usePageMeta({ title: 'Checkout | Acqui', description: 'Pay with USDC on Arc.', noindex: true })
  const payment = useQuery({
    queryKey: ['public-payment', publicId],
    queryFn: () => api<PublicPayment>(`/public/payments/${publicId}`),
    staleTime: Infinity,
    retry: (count, error) => !(error instanceof ApiRequestError && error.status === 404) && count < 2,
  })

  const status = useQuery({
    queryKey: ['public-status', publicId],
    enabled: payment.isSuccess,
    queryFn: () => api<PublicStatus>(`/public/payments/${publicId}/status`),
    refetchInterval: (query) => (query.state.data ? pollIntervalMs(checkoutPhase(query.state.data.status)) : 4000),
    refetchIntervalInBackground: false,
  })

  const now = useNow()

  if (payment.isPending) {
    return (
      <CheckoutFrame>
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="mt-4 h-12 w-1/2" />
        <Skeleton className="mt-6 h-40 w-full" />
      </CheckoutFrame>
    )
  }

  if (payment.isError) {
    const missing = payment.error instanceof ApiRequestError && payment.error.status === 404
    return (
      <CheckoutFrame>
        <h1 className="display text-2xl font-bold">{missing ? 'Payment not found' : 'Checkout unavailable'}</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">
          {missing
            ? 'This payment link is not valid. Return to the merchant and start the payment again.'
            : errorMessage(payment.error)}
        </p>
        {!missing && (
          <button type="button" onClick={() => void payment.refetch()} className="mt-4 min-h-11 rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white">
            Try again
          </button>
        )}
      </CheckoutFrame>
    )
  }

  const p = payment.data
  const live = status.data
  const current = live?.status ?? p.status
  const phase = checkoutPhase(current)
  const received = live?.received ?? p.received
  const settlement = live?.settlement ?? p.settlement
  const networkName = p.livemode ? 'Arc' : 'Arc Testnet'
  const remaining = remainingMs(p.expires_at, live?.server_time, status.dataUpdatedAt || now, now)
  const merchant = sanitizeText(p.merchant_name, 80) || 'Merchant'
  const description = sanitizeText(p.description, 160)
  const reference = sanitizeText(p.order_reference, 80)
  const successUrl = safeHttpUrl(p.success_url)
  const cancelUrl = safeHttpUrl(p.cancel_url)
  const open = phase === 'awaiting' && remaining > 0

  return (
    <CheckoutFrame>
      {!p.livemode && (
        <div className="mb-4">
          <Alert tone="info" title="Test mode">Arc Testnet USDC has no real value. Nothing here moves real money.</Alert>
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Pay {merchant}</p>
          <p className="display mt-1 text-4xl font-bold tabular-nums">
            {p.amount} <span className="text-2xl text-[var(--ink-2)]">USDC</span>
          </p>
        </div>
        <Pill tone={statusTone(current)}>{PHASE_LABEL[current]}</Pill>
      </div>

      <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        {description && (<><dt className="text-[var(--muted)]">For</dt><dd className="min-w-0 break-words">{description}</dd></>)}
        {reference && (<><dt className="text-[var(--muted)]">Reference</dt><dd className="mono min-w-0 break-all text-xs leading-6">{reference}</dd></>)}
        <dt className="text-[var(--muted)]">Network</dt>
        <dd>{networkName} <span className="text-[var(--muted)]">(chain ID {p.chain_id})</span></dd>
      </dl>

      <div className="mt-6">
        <Steps phase={phase} />
      </div>

      {open && (
        <p className="mt-6 flex items-center justify-between rounded-2xl bg-[var(--surface-muted)] px-4 py-3 text-sm">
          <span className="text-[var(--ink-2)]">Time left to pay</span>
          <span role="timer" aria-live="off" className="display text-xl font-semibold tabular-nums">{formatCountdown(remaining)}</span>
        </p>
      )}

      <div className="mt-6" aria-live="polite">
        <PhaseBody
          phase={phase}
          payment={p}
          received={received}
          open={open}
          networkName={networkName}
          settlementHash={settlement?.tx_hash ?? null}
          successUrl={successUrl}
          cancelUrl={cancelUrl}
        />
      </div>

      {status.isError && (
        <div className="mt-4">
          <Alert tone="warning" title="Status updates are delayed">
            We could not refresh the status just now. Do not pay twice: this page keeps retrying.
          </Alert>
        </div>
      )}
    </CheckoutFrame>
  )
}

function PhaseBody(props: {
  phase: CheckoutPhase
  payment: PublicPayment
  received: string
  open: boolean
  networkName: string
  settlementHash: string | null
  successUrl: string | null
  cancelUrl: string | null
}) {
  const { phase, payment, received, networkName, settlementHash, successUrl, cancelUrl } = props
  const hasReceived = Number(received) > 0

  if (phase === 'awaiting') {
    return props.open ? (
      <PayInstructions payment={payment} networkName={networkName} />
    ) : (
      <Alert tone="warning" title="Time is up">
        The payment window has closed. Do not send funds to this address. We are checking the final status.
      </Alert>
    )
  }

  if (phase === 'observed') {
    return (
      <Alert tone="info" title="We can see your payment">
        {received} USDC arrived. We are checking it before the merchant is paid. This usually takes a few seconds.
      </Alert>
    )
  }

  if (phase === 'settling') {
    return (
      <Alert tone="info" title="Settling">
        Your payment is confirmed and is being settled to the merchant. Keep this page open.
        The merchant is told by a signed server message once settlement is complete.
      </Alert>
    )
  }

  if (phase === 'settled') {
    const link = settlementHash ? txUrl(payment.chain_id, settlementHash) : null
    return (
      <div className="space-y-4">
        <Alert tone="success" title="Payment settled">
          The merchant has been paid onchain. This order is complete.
        </Alert>
        <div className="flex flex-wrap gap-2">
          {link && (
            <LinkButton href={link} external variant="secondary">
              View transaction <ExternalLink size={14} aria-hidden />
            </LinkButton>
          )}
          {successUrl && <LinkButton href={successUrl}>Return to merchant</LinkButton>}
        </div>
        <p className="text-xs text-[var(--muted)]">
          Returning to the merchant does not prove payment to them. They confirm it from a signed message sent by Acqui.
        </p>
      </div>
    )
  }

  if (phase === 'expired') {
    return (
      <div className="space-y-4">
        <Alert tone="warning" title="This payment has expired">
          Do not send funds to this address. Go back to the merchant to start a new payment: it gets a new address.
          {hasReceived && ' We saw a transfer to this address. It will be handled through the refund process.'}
        </Alert>
        {(cancelUrl ?? successUrl) && <LinkButton href={(cancelUrl ?? successUrl) as string} variant="secondary">Return to merchant</LinkButton>}
      </div>
    )
  }

  if (phase === 'underpaid') {
    return (
      <Alert tone="warning" title="Payment incomplete">
        We received {received} of {payment.amount} USDC before the window closed, so this order was not completed.
        The funds are not lost: they are returned through the refund process after a waiting period.
        Contact the merchant and quote the reference above.
      </Alert>
    )
  }

  return (
    <Alert tone="warning" title="Refund in progress">
      This payment could not be completed, for example because the transfer arrived after the deadline.
      The funds are returned to the refund address committed when the payment was created.
      Contact the merchant and quote the reference above if you need help.
    </Alert>
  )
}

function CheckoutFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-lg pt-2 sm:pt-6">
      <Card className="p-5 sm:p-7">{children}</Card>
      <p className="mt-4 text-center text-xs text-[var(--subtle)]">
        Checkout by Acqui. Acqui never asks for your wallet keys or seed phrase.
      </p>
    </div>
  )
}
