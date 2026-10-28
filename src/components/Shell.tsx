import type { ReactNode } from 'react'
import clsx from 'clsx'
import { Link, usePath } from '@/lib/route'
import { usePublicConfig } from '@/lib/hooks'

const NAV = [
  { to: '/', label: 'Overview' },
  { to: '/demo', label: 'Demo' },
  { to: '/merchants', label: 'Merchants' },
]

/** `minimal` is the hosted checkout: no marketing navigation, just the brand. */
export function Shell({ children, minimal = false }: { children: ReactNode; minimal?: boolean }) {
  const path = usePath()
  const config = usePublicConfig()
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="mx-auto w-full max-w-5xl px-4 pt-5 pb-3 flex items-center justify-between">
        <Link to="/" className="display text-2xl font-bold text-[var(--ink)]">
          Acqui
        </Link>
        {!minimal && (<nav className="flex gap-1" aria-label="Primary">
          {NAV.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              className={clsx(
                'min-h-11 inline-flex items-center rounded-full px-4 text-sm font-medium transition-colors',
                path === item.to || (item.to === '/merchants' && path.startsWith('/dashboard'))
                  ? 'bg-[var(--accent)] text-white'
                  : 'text-[var(--ink-2)] hover:bg-white/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>)}
      </header>
      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-16">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 py-6 text-xs text-[var(--subtle)]">
        {config.data ? (config.data.livemode ? 'Arc mainnet' : 'Arc Testnet: test funds only') : 'Acqui'} · USDC payment gateway on Arc
      </footer>
    </div>
  )
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <section
      className={clsx(
        'rounded-3xl border border-[var(--border)] bg-[var(--surface)] p-6 shadow-[0_8px_30px_rgba(18,45,69,0.06)] backdrop-blur',
        className,
      )}
    >
      {children}
    </section>
  )
}
