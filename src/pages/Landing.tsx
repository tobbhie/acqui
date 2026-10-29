import {
  ArrowRight,
  Check,
  CheckCircle2,
  Code2,
  Coins,
  LayoutTemplate,
  Link2,
  ShieldCheck,
  Store,
  UserRound,
  WalletCards,
  Webhook,
} from 'lucide-react'
import { NetworkArc, TokenUSDC } from '@web3icons/react'
import { FeeCalculator } from '@/components/FeeCalculator'
import { PaymentCapabilities } from '@/components/PaymentCapabilities'
import { usePublicConfig } from '@/lib/hooks'
import { Link } from '@/lib/route'
import { CHECKOUT_WINDOW_SECONDS } from '@acqui/shared'

const cta = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-full px-6 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'

const CAPABILITIES = [
  { icon: LayoutTemplate, title: 'Hosted checkout', body: 'Ready to use and secure' },
  { icon: Code2, title: 'API integration', body: 'Clean, documented API' },
  { icon: Webhook, title: 'Signed webhooks', body: 'Reliable event notifications' },
  { icon: Coins, title: 'Onchain settlement', body: 'Settle in USDC on Arc' },
]

const PAYMENT_FLOW = [
  { icon: UserRound, title: 'Customer pays crypto', body: 'Your customer completes payment using their preferred crypto wallet.', note: 'Any wallet' },
  { icon: Link2, title: 'Acqui checkout', body: 'We handle payment processing, confirmations and risk management.', note: 'Hosted checkout + API' },
  { icon: TokenUSDC, title: 'USDC on Arc', body: 'Payments settle in USDC on Arc.', note: 'Live today', live: true },
  { icon: Store, title: 'Your business', body: 'You receive USDC in your business wallet, with transparent fees.', note: 'Your wallet' },
]

const FACTS = [
  `Each checkout lasts ${CHECKOUT_WINDOW_SECONDS / 60} minutes and uses a unique payment address.`,
  'Only verified USDC on Arc settlement marks a payment as settled.',
  'The fee is the greater of 0.10 USDC and 0.1% of the payment.',
]

function SettlementGraphic() {
  return (
    <div className="relative mx-auto min-h-[400px] w-full max-w-[500px]" aria-label="Illustration of a crypto payment settling to a business in USDC on Arc">
      <div className="absolute inset-x-10 top-10 h-72 rounded-[2.5rem] bg-[#eef5ff]" />
      <div className="absolute left-0 top-0 z-10 w-36 rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_12px_30px_rgba(18,45,69,0.08)]">
        <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600"><WalletCards size={19} aria-hidden /></span>
        <p className="mt-3 text-xs font-semibold text-[var(--ink)]">Customer pays with crypto</p>
      </div>
      <div className="absolute right-0 top-0 z-10 w-36 rounded-2xl border border-blue-100 bg-white p-4 shadow-[0_12px_30px_rgba(18,45,69,0.08)]">
        <span className="grid size-9 place-items-center rounded-xl bg-blue-50 text-blue-600"><Store size={19} aria-hidden /></span>
        <p className="mt-3 text-xs font-semibold text-[var(--ink)]">You receive USDC on Arc</p>
      </div>

      <div className="absolute left-1/2 top-28 z-20 w-[min(280px,86%)] -translate-x-1/2 rounded-3xl border border-[var(--border)] bg-white p-6 shadow-[0_24px_70px_rgba(18,45,69,0.13)]">
        <CheckCircle2 className="mx-auto text-emerald-500" size={36} strokeWidth={1.8} aria-hidden />
        <p className="mt-3 text-center text-xs font-medium text-[var(--muted)]">Payment received</p>
        <p className="display mt-1 text-center text-2xl font-semibold text-[var(--ink)]">49.00 USDC</p>
        <p className="mt-1 text-center text-xs text-[var(--subtle)]">from a customer</p>

        <div className="my-5 border-t border-[var(--border)]" />
        <p className="text-center text-xs text-[var(--muted)]">Settles on</p>
        <div className="mt-3 flex items-center justify-center gap-4">
          <div className="text-center"><TokenUSDC variant="branded" size={34} /><p className="mt-1 text-xs font-semibold">USDC</p></div>
          <span className="text-xl text-blue-300">×</span>
          <div className="text-center"><NetworkArc variant="branded" size={34} /><p className="mt-1 text-xs font-semibold">Arc</p></div>
        </div>
        <p className="mt-4 text-center text-sm leading-6 text-[var(--ink-2)]">Your business receives USDC on Arc, automatically.</p>
      </div>
    </div>
  )
}

export function Landing() {
  const config = usePublicConfig()

  return (
    <div className="pb-4">
      <section className="grid min-h-[590px] items-center gap-10 py-12 lg:grid-cols-[1.08fr_0.92fr] lg:py-14">
        <div>
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-xs font-semibold uppercase tracking-[0.11em] text-blue-700">Payment infrastructure for modern businesses</p>
            {config.data && <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700">{config.data.livemode ? 'Mainnet' : 'Testnet'}</span>}
          </div>
          <h1 className="display mt-5 max-w-3xl text-balance text-5xl font-semibold leading-[1.02] text-[var(--ink)] sm:text-6xl lg:text-[4.5rem]">
            Crypto acceptance, without the crypto complexity.
          </h1>
          <p className="mt-6 max-w-2xl text-pretty text-lg leading-8 text-[var(--ink-2)]">
            Offer customers a crypto way to pay. Acqui handles checkout and settles your business in USDC on Arc.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link to="/merchants" className={`${cta} bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`}>
              Start accepting payments <ArrowRight size={17} aria-hidden />
            </Link>
            <Link to="/demo" className={`${cta} text-blue-700 hover:bg-blue-50`}>
              Explore the demo <ArrowRight size={17} aria-hidden />
            </Link>
          </div>
        </div>
        <SettlementGraphic />
      </section>

      <section className="border-y border-[var(--border)] py-7" aria-label="Core platform capabilities">
        <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {CAPABILITIES.map((item, index) => (
            <li key={item.title} className={`flex gap-4 lg:px-5 ${index > 0 ? 'lg:border-l lg:border-[var(--border)]' : ''}`}>
              <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600"><item.icon size={20} aria-hidden /></span>
              <div><p className="font-semibold text-[var(--ink)]">{item.title}</p><p className="mt-1 text-sm text-[var(--muted)]">{item.body}</p></div>
            </li>
          ))}
        </ul>
      </section>

      <section className="border-b border-[var(--border)] py-20" aria-labelledby="payment-flow-heading">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-700">How it works</p>
        <h2 id="payment-flow-heading" className="display mt-3 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">From customer payment to business settlement.</h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--ink-2)]">A single, streamlined flow. Your customer pays with crypto, Acqui handles the complexity, and you receive USDC on Arc in your business wallet.</p>

        <ol className="mt-12 grid gap-4 md:grid-cols-4">
          {PAYMENT_FLOW.map((item, index) => (
            <li key={item.title} className="relative">
              <div className={`h-full min-h-64 rounded-2xl border p-6 text-center ${item.live ? 'border-emerald-200 bg-emerald-50/70' : 'border-[var(--border)] bg-white/60'}`}>
                <span className="mx-auto grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600">
                  <item.icon {...(item.icon === TokenUSDC ? { variant: 'branded' as const } : {})} size={26} aria-hidden />
                </span>
                <h3 className="display mt-6 text-lg font-semibold">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-[var(--ink-2)]">{item.body}</p>
                <span className={`mt-6 inline-flex rounded-full px-3 py-1.5 text-xs font-semibold ${item.live ? 'bg-emerald-100 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{item.note}</span>
              </div>
              {index < PAYMENT_FLOW.length - 1 && <ArrowRight className="absolute -right-5 top-1/2 z-10 hidden -translate-y-1/2 rounded-full bg-white p-1 text-[var(--ink)] md:block" size={24} aria-hidden />}
            </li>
          ))}
        </ol>
      </section>

      <section className="border-b border-[var(--border)] py-20" aria-labelledby="payment-networks-heading">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-700">Payment networks</p>
            <h2 id="payment-networks-heading" className="display mt-3 max-w-3xl text-4xl font-semibold leading-tight sm:text-5xl">One integration, a growing payment surface.</h2>
            <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--ink-2)]">Start with USDC on Arc today. Additional assets and networks are a clearly labeled roadmap—not live payment routes.</p>
          </div>
          <Link to="/merchants" className="inline-flex items-center gap-2 text-sm font-semibold text-blue-700">Start now <ArrowRight size={16} aria-hidden /></Link>
        </div>
        <div className="mt-10"><PaymentCapabilities /></div>
      </section>

      <section className="border-b border-[var(--border)] py-20" aria-labelledby="stack-heading">
        <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-700">For builders and operators</p>
        <h2 id="stack-heading" className="display mt-3 text-4xl font-semibold leading-tight sm:text-5xl">Built for your existing stack.</h2>
        <p className="mt-4 max-w-2xl text-lg leading-8 text-[var(--ink-2)]">Add crypto acceptance without rebuilding your infrastructure. Acqui provides the checkout, API and operational controls your team needs.</p>

        <div className="mt-12 grid gap-10 lg:grid-cols-3 lg:divide-x lg:divide-[var(--border)]">
          <article className="lg:pr-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600"><LayoutTemplate size={22} aria-hidden /></span>
            <h3 className="display mt-5 text-2xl font-semibold">Hosted checkout</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-2)]">A ready-to-use checkout that works across devices and keeps payment status grounded in verified settlement.</p>
            <ul className="mt-5 space-y-3 text-sm text-[var(--ink-2)]">
              {['Responsive and accessible', 'No customer account required', 'Clear status and recovery states'].map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 text-blue-600" size={16} aria-hidden />{item}</li>)}
            </ul>
            <Link to="/demo" className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-700">Try the demo <ArrowRight size={15} aria-hidden /></Link>
          </article>

          <article className="lg:px-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600"><Code2 size={22} aria-hidden /></span>
            <h3 className="display mt-5 text-2xl font-semibold">Simple API</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-2)]">Create a payment intent from your server and send the customer to the returned checkout URL.</p>
            <pre className="mono mt-5 overflow-x-auto rounded-2xl border border-[var(--border)] bg-slate-50 p-4 text-[11px] leading-5 text-slate-700"><code>{`POST /v1/payment-intents\nAuthorization: Bearer …\n\n{\n  "amount": "49.00",\n  "currency": "USDC",\n  "metadata": { "order_id": "123" }\n}`}</code></pre>
          </article>

          <article className="lg:pl-8">
            <span className="grid size-12 place-items-center rounded-2xl bg-blue-50 text-blue-600"><ShieldCheck size={22} aria-hidden /></span>
            <h3 className="display mt-5 text-2xl font-semibold">Operations ready</h3>
            <p className="mt-3 text-sm leading-6 text-[var(--ink-2)]">Built around reliable settlement, transparent fees and signed events—not simulated payment success.</p>
            <ul className="mt-5 space-y-3 text-sm text-[var(--ink-2)]">
              {['Signed payment webhooks', 'Transparent fee accounting', 'USDC settlement on Arc'].map((item) => <li key={item} className="flex gap-2"><Check className="mt-0.5 text-blue-600" size={16} aria-hidden />{item}</li>)}
            </ul>
          </article>
        </div>
      </section>

      <section className="grid gap-6 py-20 lg:grid-cols-2" aria-labelledby="transparent-heading">
        <div className="rounded-3xl border border-[var(--border)] bg-white/65 p-7 sm:p-9">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-700">Clear by design</p>
          <h2 id="transparent-heading" className="display mt-3 text-3xl font-semibold">Know what happens to every payment.</h2>
          <ul className="mt-6 space-y-4 text-sm leading-6 text-[var(--ink-2)]">
            {FACTS.map((fact) => <li key={fact} className="flex gap-3"><CheckCircle2 className="mt-0.5 shrink-0 text-emerald-500" size={18} aria-hidden />{fact}</li>)}
          </ul>
        </div>
        <FeeCalculator />
      </section>

      <section className="rounded-[2rem] border border-blue-100 bg-blue-50/70 px-7 py-10 sm:px-10 md:flex md:items-center md:justify-between md:gap-8">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-blue-700">Get started</p>
          <h2 className="display mt-2 text-3xl font-semibold">Start accepting crypto payments today.</h2>
          <p className="mt-2 text-[var(--ink-2)]">Offer a better payment experience and settle in USDC on Arc.</p>
        </div>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row md:mt-0">
          <Link to="/merchants" className={`${cta} bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]`}>Start accepting payments <ArrowRight size={17} aria-hidden /></Link>
          <Link to="/demo" className={`${cta} text-blue-700 hover:bg-white/70`}>Explore the demo</Link>
        </div>
      </section>
    </div>
  )
}
