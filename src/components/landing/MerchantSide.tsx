import { CheckCircle2, ShoppingBag } from 'lucide-react'
import { TokenUSDC } from '@web3icons/react'
import { useRevealOnce } from '@/lib/hooks'

/** One card of the cluster. Each fades up in turn once the cluster scrolls into view; reduced motion shows them at once. */
function Reveal({ shown, delay, className, children }: { shown: boolean; delay: number; className: string; children: React.ReactNode }) {
  return (
    <div
      className={`absolute rounded-2xl border border-[var(--border)] bg-white shadow-[0_14px_34px_rgba(18,45,69,0.10)] transition-all duration-700 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none ${shown ? 'translate-y-0 opacity-100' : 'translate-y-3 opacity-0'} ${className}`}
      style={{ transitionDelay: shown ? `${delay}ms` : '0ms' }}
    >
      {children}
    </div>
  )
}

/**
 * The "after" half of the story, drawn as sample data: the merchant's own order list updates by itself.
 * Decorative: hidden from assistive technology and not interactive.
 */
export function MerchantSide() {
  const [ref, shown] = useRevealOnce<HTMLDivElement>()
  return (
    <div ref={ref} aria-hidden="true" className="pointer-events-none relative mt-12 h-[262px] w-full max-w-[560px] select-none" data-testid="merchant-side">
      <Reveal shown={shown} delay={0} className="left-0 top-0 z-10 w-[430px] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-slate-600">Your orders</p>
          <p className="text-xs text-slate-500">Sample data</p>
        </div>
        <div className="mt-3 flex items-center gap-3 text-sm text-slate-600">
          <span className="grid size-7 place-items-center rounded-lg bg-slate-100 text-slate-500"><ShoppingBag size={14} /></span>
          <span className="font-medium">#1041 · Studio mug</span>
          <span className="ml-auto">$18.00</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700">Paid · card</span>
        </div>
        <div className="mt-2 flex items-center gap-3 rounded-xl bg-emerald-50 px-2 py-2 text-sm text-[var(--ink)]">
          <span className="grid size-7 place-items-center rounded-lg bg-white text-emerald-600"><ShoppingBag size={14} /></span>
          <span className="font-semibold">#1042 · Canvas tote bag</span>
          <span className="ml-auto font-semibold">$49.00</span>
          <span className="rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-semibold text-emerald-800">Paid · crypto</span>
        </div>
      </Reveal>

      <Reveal shown={shown} delay={450} className="left-[110px] top-[136px] z-20 flex w-[400px] items-center gap-3 border-l-4 border-l-emerald-500 p-4">
        <CheckCircle2 size={22} className="shrink-0 text-emerald-600" />
        <div className="min-w-0">
          <p className="mono text-sm font-semibold text-[var(--ink)]">payment.settled</p>
          <p className="text-xs text-slate-600">Signed message received · order #1042</p>
        </div>
      </Reveal>

      <Reveal shown={shown} delay={900} className="left-[28px] top-[212px] z-30 flex items-center gap-2.5 rounded-full px-4 py-2.5">
        <TokenUSDC variant="branded" size={20} />
        <span className="text-sm font-semibold text-[var(--ink)]">Settled on Arc</span>
        <span className="text-sm text-slate-500">·</span>
        <span className="text-sm font-semibold text-blue-800">49.00 USDC</span>
      </Reveal>
    </div>
  )
}
