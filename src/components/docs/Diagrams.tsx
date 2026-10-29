import type { ReactNode } from 'react'
import { ArrowRight, ArrowDown } from 'lucide-react'

/** Four-step picture of a payment, stacked on phones and in a row on wide screens. */
export function FlowDiagram() {
  const steps: { n: number; title: string; text: string; tone: string }[] = [
    { n: 1, title: 'Your server', text: 'Creates a payment and gets a checkout link.', tone: 'bg-[#e8f1fb]' },
    { n: 2, title: 'Your customer', text: 'Opens the link and sends USDC to the payment address.', tone: 'bg-[#fdf1e3]' },
    { n: 3, title: 'Acqui', text: 'Confirms the payment and pays you, minus the fee.', tone: 'bg-[#e6f4ec]' },
    { n: 4, title: 'Your server again', text: 'Receives a signed message: the order is paid.', tone: 'bg-[#f1ebfb]' },
  ]
  return (
    <figure className="my-6" aria-label="How a payment moves from your server to a paid order">
      <ol className="flex flex-col items-stretch gap-2 md:flex-row md:items-stretch md:gap-1">
        {steps.map((s, i) => (
          <li key={s.n} className="flex flex-1 flex-col items-center gap-2 md:flex-row md:gap-1">
            <div className={`w-full flex-1 rounded-2xl border border-[var(--border)] p-4 ${s.tone}`}>
              <span className="mono text-xs text-[var(--muted)]">Step {s.n}</span>
              <p className="display mt-1 text-lg font-bold text-[var(--ink)]">{s.title}</p>
              <p className="mt-1 text-sm text-[var(--ink-2)]">{s.text}</p>
            </div>
            {i < steps.length - 1 && (
              <>
                <ArrowDown className="size-5 shrink-0 text-[var(--muted)] md:hidden" aria-hidden />
                <ArrowRight className="hidden size-5 shrink-0 text-[var(--muted)] md:block" aria-hidden />
              </>
            )}
          </li>
        ))}
      </ol>
      <figcaption className="mt-2 text-xs text-[var(--subtle)]">The money goes straight to your payout wallet. Your server never handles it.</figcaption>
    </figure>
  )
}

/** What the customer sees on the hosted checkout page. Illustration only. */
export function CheckoutMock() {
  return (
    <figure className="my-6 flex flex-col items-center gap-2">
      <svg viewBox="0 0 320 420" role="img" aria-labelledby="mock-title mock-desc" className="w-full max-w-[320px] drop-shadow-[0_14px_30px_rgba(18,45,69,0.16)]">
        <title id="mock-title">Hosted checkout page</title>
        <desc id="mock-desc">A checkout card showing the store name, the amount in USDC, a payment address with a copy button, a QR code of the address and a 30 minute countdown.</desc>
        <rect x="4" y="4" width="312" height="412" rx="24" fill="#fff" stroke="#d5dde6" />
        <text x="24" y="42" fontSize="13" fill="#6b6580" fontFamily="DM Sans, sans-serif">Acme Store · Order 1001</text>
        <text x="24" y="86" fontSize="34" fontWeight="700" fill="#122d45" fontFamily="Space Grotesk, sans-serif">10.00 USDC</text>
        <rect x="24" y="100" width="108" height="22" rx="11" fill="#fdf1e3" />
        <text x="38" y="115" fontSize="11" fill="#8a5a1c" fontFamily="DM Sans, sans-serif">Time left 29:41</text>
        <text x="24" y="152" fontSize="12" fill="#334155" fontFamily="DM Sans, sans-serif">Send exactly this amount of USDC on Arc to:</text>
        <rect x="24" y="162" width="272" height="40" rx="12" fill="#f5f5f8" stroke="#e1e6ec" />
        <text x="36" y="187" fontSize="12" fill="#122d45" fontFamily="JetBrains Mono, monospace">0x79c8…bee8</text>
        <rect x="236" y="170" width="52" height="24" rx="8" fill="#122d45" />
        <text x="249" y="186" fontSize="11" fill="#fff" fontFamily="DM Sans, sans-serif">Copy</text>
        <g transform="translate(110 220)">
          <rect width="100" height="100" rx="10" fill="#fff" stroke="#d5dde6" />
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].flatMap((r) => [0, 1, 2, 3, 4, 5, 6, 7, 8].map((c) => ((r * 7 + c * 3 + r * c) % 3 === 0 ? <rect key={`${r}-${c}`} x={10 + c * 9} y={10 + r * 9} width="8" height="8" fill="#122d45" /> : null)))}
        </g>
        <text x="160" y="342" fontSize="10" textAnchor="middle" fill="#8a849c" fontFamily="DM Sans, sans-serif">QR holds the address only</text>
        <rect x="24" y="356" width="272" height="40" rx="14" fill="#e8f1fb" />
        <circle cx="46" cy="376" r="6" fill="#1061a6" />
        <text x="62" y="380" fontSize="12" fill="#122d45" fontFamily="DM Sans, sans-serif">Waiting for your payment…</text>
      </svg>
      <figcaption className="text-xs text-[var(--subtle)]">The hosted checkout. You never build this page.</figcaption>
    </figure>
  )
}

const TRACK: { status: string; label: string; tone: string }[] = [
  { status: 'awaiting_payment', label: 'Waiting for the customer', tone: 'bg-[#9bb2c9]' },
  { status: 'deposit_detected', label: 'Payment seen', tone: 'bg-[#7aa6d8]' },
  { status: 'settling', label: 'Paying you out', tone: 'bg-[#e0a24a]' },
  { status: 'settled', label: 'Paid. Fulfil the order', tone: 'bg-[#1a8047]' },
]

/** Happy path of a payment, left to right. */
export function StatusTrack() {
  return (
    <figure className="my-6" aria-label="The usual order of payment statuses">
      <ol className="grid gap-3 sm:grid-cols-4">
        {TRACK.map((t, i) => (
          <li key={t.status} className="relative rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
            <span className={`mb-2 inline-block size-3 rounded-full ${t.tone}`} aria-hidden />
            <p className="mono text-xs text-[var(--ink)]">{t.status}</p>
            <p className="mt-1 text-sm text-[var(--ink-2)]">{t.label}</p>
            <span className="absolute right-3 top-3 text-xs text-[var(--subtle)]">{i + 1}</span>
          </li>
        ))}
      </ol>
      <figcaption className="mt-2 text-xs text-[var(--subtle)]">Only the last one means you have been paid.</figcaption>
    </figure>
  )
}

/** Worked example: where 10.00 USDC goes. */
export function FeeSplit() {
  const parts: { label: string; value: string; width: string; tone: string; text?: string }[] = [
    { label: 'You receive', value: '9.88', width: '88%', tone: 'bg-[#1a8047]', text: 'text-white' },
    { label: 'Acqui fee', value: '0.10', width: '6%', tone: 'bg-[#122d45]' },
    { label: 'Network fee', value: '0.02', width: '6%', tone: 'bg-[#e0a24a]' },
  ]
  return (
    <figure className="my-6" aria-label="Example: a 10.00 USDC payment splits into 9.88 for you, 0.10 Acqui fee and 0.02 network fee">
      <div className="flex h-11 w-full overflow-hidden rounded-xl border border-[var(--border)]" role="presentation">
        {parts.map((p) => (
          <div key={p.label} className={`${p.tone} ${p.text ?? ''} flex min-w-3 items-center justify-center text-xs font-semibold`} style={{ width: p.width }}>
            {p.label === 'You receive' ? `${p.value} USDC` : ''}
          </div>
        ))}
      </div>
      <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-3">
        {parts.map((p) => (
          <li key={p.label} className="flex items-center gap-2 text-[var(--ink-2)]">
            <span className={`inline-block size-3 rounded-full ${p.tone}`} aria-hidden />
            <span>{p.label}</span>
            <span className="mono ml-auto text-[var(--ink)]">{p.value}</span>
          </li>
        ))}
      </ul>
      <figcaption className="mt-2 text-xs text-[var(--subtle)]">A customer pays 10.00 USDC. Amounts in USDC.</figcaption>
    </figure>
  )
}

export function Callout({ title, children, tone = 'info' }: { title: string; children: ReactNode; tone?: 'info' | 'warn' }) {
  const styles = tone === 'warn' ? 'border-[#e8c07a] bg-[#fff8ea]' : 'border-[#b8d3ee] bg-[#eef5fc]'
  return (
    <aside className={`my-5 rounded-2xl border p-4 text-sm text-[var(--ink-2)] ${styles}`}>
      <p className="font-semibold text-[var(--ink)]">{title}</p>
      <div className="mt-1 space-y-2">{children}</div>
    </aside>
  )
}
