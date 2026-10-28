import clsx from 'clsx'
import { Check } from 'lucide-react'
import type { CheckoutPhase } from '@/lib/status'

const STEPS = ['Waiting for payment', 'Payment seen', 'Settling', 'Complete'] as const
const INDEX: Partial<Record<CheckoutPhase, number>> = { awaiting: 0, observed: 1, settling: 2, settled: 3 }

/** Progress is driven only by the server's payment status. */
export function Steps({ phase }: { phase: CheckoutPhase }) {
  const current = INDEX[phase]
  if (current === undefined) return null
  return (
    <ol className="grid grid-cols-4 gap-2" aria-label="Payment progress">
      {STEPS.map((label, i) => {
        const done = i < current || phase === 'settled'
        const active = i === current && phase !== 'settled'
        return (
          <li key={label} className="flex flex-col items-center gap-2 text-center" aria-current={active ? 'step' : undefined}>
            <span
              className={clsx(
                'flex size-8 items-center justify-center rounded-full border text-xs font-semibold',
                done && 'border-[var(--success)] bg-[var(--success)] text-white',
                active && 'border-[var(--accent)] bg-[var(--accent)] text-white',
                !done && !active && 'border-[var(--border)] bg-white/70 text-[var(--subtle)]',
              )}
            >
              {done ? <Check size={14} aria-hidden /> : i + 1}
            </span>
            <span className={clsx('text-[11px] leading-tight sm:text-xs', active || done ? 'font-semibold text-[var(--ink)]' : 'text-[var(--muted)]')}>{label}</span>
          </li>
        )
      })}
    </ol>
  )
}
