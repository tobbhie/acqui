import { ArrowRight, Clock, Link2, ShieldCheck, Wallet } from 'lucide-react'
import { Card } from '@/components/Shell'
import { FeeCalculator } from '@/components/FeeCalculator'
import { Pill } from '@/components/ui'
import { usePublicConfig } from '@/lib/hooks'
import { Link } from '@/lib/route'
import { CHECKOUT_WINDOW_SECONDS } from '@acqui/shared'

const STEPS = [
  { icon: Link2, title: 'Create a checkout', body: 'Your server makes one API call with an amount and an order reference, and gets back a hosted checkout link.' },
  { icon: Wallet, title: 'Customer pays', body: 'They send USDC on Arc to a unique address made for that payment. No wallet connection or account is needed.' },
  { icon: ShieldCheck, title: 'You receive USDC', body: 'Smart contracts pay your wallet and take the fee. Acqui then sends your server a signed message that the payment settled.' },
]

const FACTS = [
  `Each checkout lasts ${CHECKOUT_WINDOW_SECONDS / 60} minutes and uses its own address. A retry gets a new one.`,
  'USDC on Arc only. Other tokens and other networks are not supported.',
  'Minimum payment 1 USDC. The fee is the greater of 0.10 USDC and 0.1%.',
  'Late or incomplete transfers are never settled to you. They are returned through a refund process.',
]

const cta = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-7 text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'

export function Landing() {
  const config = usePublicConfig()
  return (
    <div className="space-y-12 pt-6 sm:pt-10">
      <section>
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">USDC payments on Arc</p>
          {config.data && <Pill tone={config.data.livemode ? 'success' : 'info'}>{config.data.livemode ? 'Mainnet' : 'Testnet'}</Pill>}
        </div>
        <h1 className="display mt-3 max-w-3xl text-balance text-4xl font-bold leading-[1.05] sm:text-6xl">
          Accept USDC payments on Arc with one API.
        </h1>
        <p className="mt-4 max-w-xl text-pretty text-lg text-[var(--ink-2)]">
          Create a checkout from your server, send your customer to a hosted page, and get a signed webhook once the payment has settled onchain.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Link to="/demo" className={`${cta} bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`}>
            Try the demo <ArrowRight size={18} aria-hidden />
          </Link>
          <Link to="/merchants" className={`${cta} border border-[var(--border)] bg-white/80 text-[var(--ink)] hover:bg-white`}>
            Merchant dashboard
          </Link>
        </div>
      </section>

      <section aria-labelledby="how">
        <h2 id="how" className="display text-2xl font-semibold">How it works</h2>
        <ol className="mt-5 grid gap-4 md:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title}>
              <Card className="h-full">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-full bg-[var(--surface-muted)] text-[var(--ink)]"><step.icon size={20} aria-hidden /></span>
                  <span className="text-xs font-semibold text-[var(--subtle)]">Step {i + 1}</span>
                </div>
                <h3 className="display mt-4 text-lg font-semibold">{step.title}</h3>
                <p className="mt-1 text-sm text-[var(--ink-2)]">{step.body}</p>
              </Card>
            </li>
          ))}
        </ol>
      </section>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <h2 className="display flex items-center gap-2 text-xl font-semibold"><Clock size={20} aria-hidden /> Good to know</h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-[var(--ink-2)]">
            {FACTS.map((fact) => <li key={fact}>{fact}</li>)}
          </ul>
        </Card>
        <FeeCalculator />
      </div>
    </div>
  )
}
