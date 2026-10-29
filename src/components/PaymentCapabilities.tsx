import clsx from 'clsx'
import {
  NetworkArc,
  NetworkBase,
  NetworkEthereum,
  NetworkSolana,
  TokenETH,
  TokenSOL,
  TokenUSDC,
  TokenUSDT,
} from '@web3icons/react'
import { PAYMENT_CAPABILITIES } from '@/payment-capabilities'

function CapabilityIcon({ id }: { id: string }) {
  const token = id.startsWith('eth-')
    ? <TokenETH variant="branded" size={30} />
    : id.startsWith('sol-')
      ? <TokenSOL variant="branded" size={30} />
      : id.startsWith('usdt-')
        ? <TokenUSDT variant="branded" size={30} />
        : <TokenUSDC variant="branded" size={30} />

  const network = id.endsWith('-arc')
    ? <NetworkArc variant="branded" size={22} />
    : id.endsWith('-base')
      ? <NetworkBase variant="branded" size={22} />
      : id.endsWith('-ethereum')
        ? <NetworkEthereum variant="branded" size={22} />
        : id.endsWith('-solana')
          ? <NetworkSolana variant="branded" size={22} />
          : null

  return (
    <div className="flex items-center -space-x-1.5" aria-hidden>
      {token}
      {network && <span className="grid size-7 place-items-center rounded-full border-2 border-white bg-white">{network}</span>}
    </div>
  )
}

export function PaymentCapabilities() {
  return (
    <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Payment-method availability">
      {PAYMENT_CAPABILITIES.map((capability) => {
        const live = capability.availability === 'live'
        return (
          <li key={capability.id}>
            <div
              className={clsx(
                'h-full min-h-40 rounded-2xl border p-5 transition-colors',
                live
                  ? 'border-emerald-200 bg-emerald-50/70'
                  : 'border-[var(--border)] bg-white/60 text-[var(--muted)]',
              )}
              aria-disabled={!live || undefined}
            >
              <div className="flex items-start justify-between gap-3">
                <CapabilityIcon id={capability.id} />
                <span className={clsx(
                  'rounded-full px-2.5 py-1 text-[11px] font-semibold',
                  live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-500',
                )}>
                  {capability.displayStatus}
                </span>
              </div>
              <p className={clsx('display mt-7 text-lg font-semibold', live && 'text-[var(--ink)]')}>{capability.asset}</p>
              <p className="mt-0.5 text-sm">on {capability.network}</p>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
