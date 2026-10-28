import type { PaymentStatus } from '@/lib/types'

/** What the customer sees. The API status is the only source: timers and redirects never change it. */
export type CheckoutPhase = 'awaiting' | 'observed' | 'settling' | 'settled' | 'expired' | 'underpaid' | 'recovery'

export function checkoutPhase(status: PaymentStatus): CheckoutPhase {
  switch (status) {
    case 'created':
    case 'awaiting_payment':
      return 'awaiting'
    case 'deposit_detected':
      return 'observed'
    case 'verifying':
    case 'settling':
    case 'retryable_failure':
      return 'settling'
    case 'settled':
      return 'settled'
    case 'expired':
      return 'expired'
    case 'underpaid':
      return 'underpaid'
    case 'recovery_required':
      return 'recovery'
  }
}

/** Statuses after which nothing more will change for the customer. */
export const isFinalPhase = (phase: CheckoutPhase): boolean => phase === 'settled' || phase === 'expired'

/** Poll quickly while money may be in flight, slowly once only recovery remains. */
export function pollIntervalMs(phase: CheckoutPhase): number | false {
  if (isFinalPhase(phase)) return false
  return phase === 'underpaid' || phase === 'recovery' ? 15_000 : 4_000
}

export const PHASE_LABEL: Record<PaymentStatus, string> = {
  created: 'Waiting for payment',
  awaiting_payment: 'Waiting for payment',
  deposit_detected: 'Payment seen',
  verifying: 'Verifying',
  settling: 'Settling',
  retryable_failure: 'Settling (retrying)',
  settled: 'Settled',
  expired: 'Expired',
  underpaid: 'Underpaid',
  recovery_required: 'Refund in progress',
}

export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger'
export function statusTone(status: PaymentStatus): Tone {
  switch (checkoutPhase(status)) {
    case 'settled': return 'success'
    case 'expired': return 'neutral'
    case 'underpaid':
    case 'recovery': return 'warning'
    case 'awaiting': return 'neutral'
    default: return 'info'
  }
}

/** Remaining time using the server's clock so a wrong device clock cannot mislead the customer. */
export function remainingMs(expiresAtIso: string, serverTimeIso: string | undefined, receivedAtMs: number, nowMs: number): number {
  const expires = Date.parse(expiresAtIso)
  const offset = serverTimeIso ? Date.parse(serverTimeIso) - receivedAtMs : 0
  return expires - (nowMs + (Number.isFinite(offset) ? offset : 0))
}
