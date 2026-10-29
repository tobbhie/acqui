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
  const marketing = path === '/'
  const frame = marketing ? 'max-w-[1340px]' : 'max-w-5xl'
  return (
    <div className="min-h-dvh flex flex-col">
      <header className={clsx('mx-auto flex w-full items-center justify-between px-4 pb-3 pt-5', frame)}>
        <Link to="/" className="display text-2xl font-bold text-[var(--ink)]">
          Acqui
        </Link>
        {!minimal && (<div className="flex items-center gap-3">
          <nav className="flex gap-0.5" aria-label="Primary">
            {NAV.map((item) => {
              const active = path === item.to || (item.to === '/merchants' && path.startsWith('/dashboard'))
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={clsx(
                    'relative inline-flex min-h-11 items-center px-3 text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)] sm:px-4',
                    marketing
                      ? active ? 'text-[var(--ink)] after:absolute after:inset-x-4 after:bottom-0 after:h-0.5 after:bg-blue-600' : 'text-[var(--ink-2)] hover:text-[var(--ink)]'
                      : active ? 'rounded-full bg-[var(--accent)] text-white' : 'rounded-full text-[var(--ink-2)] hover:bg-white/70',
                  )}
                >
                  {item.label}
                </Link>
              )
            })}
          </nav>
          {marketing && <Link to="/merchants" className="hidden min-h-11 items-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)] sm:inline-flex">Get started</Link>}
        </div>)}
      </header>
      <main className={clsx('mx-auto w-full flex-1 px-4 pb-16', frame)}>{children}</main>
      <footer className={clsx('mx-auto w-full px-4 py-6 text-xs text-[var(--subtle)]', frame)}>
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
