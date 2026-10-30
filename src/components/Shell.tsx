import { useEffect, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Menu, X } from 'lucide-react'
import { Link, usePath } from '@/lib/route'
import { usePublicConfig } from '@/lib/hooks'

interface NavItem { to: string; label: string; match: (path: string) => boolean }
const NAV: readonly NavItem[] = [
  { to: '/', label: 'Overview', match: (p) => p === '/' },
  { to: '/#how-it-works', label: 'How it works', match: () => false },
  { to: '/demo', label: 'Demo', match: (p) => p.startsWith('/demo') },
  { to: '/docs', label: 'Docs', match: (p) => p.startsWith('/docs') },
  { to: '/merchants', label: 'Merchants', match: (p) => p === '/merchants' || p.startsWith('/dashboard') },
]

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]'

/** `minimal` is the hosted checkout: no marketing navigation, just the brand. */
export function Shell({ children, minimal = false }: { children: ReactNode; minimal?: boolean }) {
  const path = usePath()
  const config = usePublicConfig()
  const marketing = path === '/'
  const frame = marketing ? 'max-w-[1340px]' : path.startsWith('/docs') ? 'max-w-6xl' : 'max-w-5xl'
  // Mobile menu: open only for the path it was opened on, so any page change closes it without an effect.
  const [openAt, setOpenAt] = useState<string | null>(null)
  const open = openAt === path
  const close = () => setOpenAt(null)
  const header = useRef<HTMLElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpenAt(null) }
    const onPointer = (e: PointerEvent) => { if (header.current && !header.current.contains(e.target as Node)) setOpenAt(null) }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('pointerdown', onPointer) }
  }, [open])

  return (
    <div className="min-h-dvh flex flex-col">
      <header ref={header} className={clsx('relative mx-auto flex w-full items-center justify-between px-4 pb-3 pt-5', frame)}>
        <Link to="/" className={clsx('inline-flex items-center rounded-lg', focusRing)} onClick={close} aria-label="Acqui home">
          <img src="/acqui-wordmark.svg" alt="Acqui" width={445} height={150} className="h-11 w-auto sm:h-12" />
        </Link>
        {!minimal && (
          <>
            <div className="hidden items-center gap-3 md:flex">
              <nav className="flex gap-0.5" aria-label="Primary">
                {NAV.map((item) => {
                  const active = item.match(path)
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      aria-current={active ? 'page' : undefined}
                      className={clsx(
                        'relative inline-flex min-h-11 items-center px-4 text-sm font-medium transition-colors',
                        focusRing,
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
              {marketing && (
                <Link to="/merchants" className={clsx('inline-flex min-h-11 items-center rounded-full bg-[var(--accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--accent-hover)]', focusRing)}>
                  Get started
                </Link>
              )}
            </div>

            <button
              type="button"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              aria-controls="mobile-menu"
              onClick={() => setOpenAt(open ? null : path)}
              className={clsx('inline-flex size-11 items-center justify-center rounded-full border border-[var(--border)] bg-white/80 text-[var(--ink)] hover:bg-white md:hidden', focusRing)}
            >
              {open ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
            </button>

            {open && (
              <nav
                id="mobile-menu"
                aria-label="Primary"
                className="absolute inset-x-4 top-full z-30 mt-1 rounded-3xl border border-[var(--border)] bg-white p-2 shadow-[0_16px_40px_rgba(18,45,69,0.14)] md:hidden"
              >
                <ul>
                  {NAV.map((item) => (
                    <li key={item.to}>
                      <Link
                        to={item.to}
                        onClick={close}
                        aria-current={item.match(path) ? 'page' : undefined}
                        className={clsx('flex min-h-12 items-center rounded-2xl px-4 text-base font-medium', focusRing, item.match(path) ? 'bg-[var(--surface-muted)] text-[var(--ink)]' : 'text-[var(--ink-2)] hover:bg-[var(--surface-muted)]')}
                      >
                        {item.label}
                      </Link>
                    </li>
                  ))}
                </ul>
                <Link to="/merchants" onClick={close} className={clsx('mt-1 flex min-h-12 items-center justify-center rounded-2xl bg-[var(--accent)] text-base font-semibold text-white', focusRing)}>
                  Get started
                </Link>
              </nav>
            )}
          </>
        )}
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
