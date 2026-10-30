import { ExternalLink } from 'lucide-react'
import { AddressQr } from '@/components/Qr'
import { Alert, CopyButton } from '@/components/ui'
import { addressUrl } from '@/lib/format'
import type { PublicPayment } from '@/lib/types'
import { LIVE_PAYMENT_CAPABILITY } from '@/payment-capabilities'

/** The only place a receiver address is shown. Shown while the window is open and nothing has been seen yet. */
export function PayInstructions({ payment, networkName }: { payment: PublicPayment; networkName: string }) {
  const explorer = addressUrl(payment.chain_id, payment.receiver_address)
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2" aria-label="Payment method selection">
        <div className="rounded-2xl border border-[var(--success)]/30 bg-[#e6f4ec]/70 p-3 text-sm">
          <p className="font-semibold">Pay with: {LIVE_PAYMENT_CAPABILITY.asset} · {LIVE_PAYMENT_CAPABILITY.network}</p>
          <p className="mt-0.5 text-xs text-[var(--success)]">Available now</p>
        </div>
        <div className="cursor-not-allowed rounded-2xl border border-[var(--border)] bg-[var(--surface-muted)] p-3 text-sm text-[var(--muted)]" aria-disabled="true">
          <p className="font-semibold">Other networks and assets</p>
          <p className="mt-0.5 text-xs">Coming soon</p>
        </div>
      </div>
      <div>
        <p className="text-sm text-[var(--ink-2)]">
          Send exactly <strong className="tabular-nums">{payment.amount} USDC</strong> on <strong>{networkName}</strong> to this address:
        </p>
        <div className="mt-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
          <p className="mono break-all text-sm leading-relaxed" data-testid="receiver-address">{payment.receiver_address}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton value={payment.receiver_address} label="Copy address" />
            <CopyButton value={payment.amount} label="Copy amount" />
            {explorer && (
              <a href={explorer} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full px-3 text-sm font-medium text-[var(--accent-hover)] underline-offset-2 hover:underline">
                View address <ExternalLink size={14} aria-hidden />
              </a>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2 sm:flex-row sm:items-center sm:gap-5">
        <AddressQr value={payment.receiver_address} label={`QR code containing the receiver address ${payment.receiver_address}`} />
        <p className="max-w-xs text-xs text-[var(--muted)]">
          This QR code holds the address only. It is not a payment request, so enter the amount yourself and check the network before you send.
        </p>
      </div>

      <Alert tone="warning" title="Before you send">
        <ul className="list-disc space-y-1 pl-4">
          <li><strong>Only send USDC on Arc to this address.</strong> This checkout uses {networkName} (chain ID {payment.chain_id}); other networks and tokens are not recovered automatically.</li>
          <li>Send the full amount in one transfer, from a wallet or exchange account that supports {networkName}.</li>
          {payment.livemode && <li>This is a live payment: you are sending real USDC, and a transfer cannot be reversed. Check the address and network before you confirm.</li>}
          <li>Transfers that arrive after the countdown ends are not credited to this order. They are returned through the refund process, which takes time.</li>
        </ul>
      </Alert>
    </div>
  )
}
