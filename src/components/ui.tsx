import { useEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Check, CheckCircle2, Copy, Info, Loader2, XCircle } from 'lucide-react'
import type { Tone } from '@/lib/status'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--focus)]'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
const VARIANT: Record<Variant, string> = {
  primary: 'bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]',
  secondary: 'border border-[var(--border)] bg-white/80 text-[var(--ink)] hover:bg-white',
  ghost: 'text-[var(--ink-2)] hover:bg-white/70',
  danger: 'border border-[var(--danger)]/30 bg-white/80 text-[var(--danger)] hover:bg-white',
}

export function Button({
  variant = 'primary',
  busy = false,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; busy?: boolean }) {
  return (
    <button
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={clsx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-55',
        VARIANT[variant],
        focusRing,
        className,
      )}
    >
      {busy && <Loader2 size={16} className="animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

export function LinkButton({ href, variant = 'primary', children, external = false, className }: {
  href: string; variant?: Variant; children: ReactNode; external?: boolean; className?: string
}) {
  return (
    <a
      href={href}
      {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      className={clsx('inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-5 text-sm font-semibold transition-colors', VARIANT[variant], focusRing, className)}
    >
      {children}
    </a>
  )
}

export function Field({ label, hint, error, id, className, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string | null; id: string }) {
  const describedBy = [hint ? `${id}-hint` : '', error ? `${id}-error` : ''].filter(Boolean).join(' ') || undefined
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-sm font-medium text-[var(--ink-2)]">{label}</label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        {...rest}
        className={clsx(
          'mt-1 min-h-11 w-full rounded-2xl border bg-[var(--surface-strong)] px-4 text-base outline-none placeholder:text-[var(--subtle)] focus:border-[var(--focus)] focus:ring-2 focus:ring-[var(--focus)]',
          error ? 'border-[var(--danger)]' : 'border-[var(--border)]',
        )}
      />
      {hint && <p id={`${id}-hint`} className="mt-1 text-xs text-[var(--muted)]">{hint}</p>}
      {error && <p id={`${id}-error`} role="alert" className="mt-1 text-xs text-[var(--danger)]">{error}</p>}
    </div>
  )
}

const TONE_CLASS: Record<Tone, string> = {
  neutral: 'bg-[var(--surface-muted)] text-[var(--ink-2)]',
  info: 'bg-[#e8f0fb] text-[#1061a6]',
  success: 'bg-[#e6f4ec] text-[var(--success)]',
  warning: 'bg-[#fdf1e0] text-[#8a5a0b]',
  danger: 'bg-[#fbe9ed] text-[var(--danger)]',
}

export function Pill({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={clsx('inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold', TONE_CLASS[tone])}>{children}</span>
}

const ALERT_ICON = { info: Info, success: CheckCircle2, warning: AlertTriangle, danger: XCircle, neutral: Info } as const
export function Alert({ tone = 'info', title, children }: { tone?: Tone; title?: string; children?: ReactNode }) {
  const Icon = ALERT_ICON[tone]
  return (
    <div role={tone === 'danger' ? 'alert' : 'status'} className={clsx('flex gap-3 rounded-2xl p-4 text-sm', TONE_CLASS[tone])}>
      <Icon size={18} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        {title && <p className="font-semibold">{title}</p>}
        {children && <div className={clsx(title && 'mt-1', 'text-pretty')}>{children}</div>}
      </div>
    </div>
  )
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-[var(--muted)]">
      <Loader2 size={18} className="animate-spin" aria-hidden /> {label}
    </div>
  )
}

export function CopyButton({ value, label = 'Copy', className }: { value: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
    } catch {
      // Clipboard can be blocked (insecure context): fall back to a temporary textarea.
      const area = document.createElement('textarea')
      area.value = value
      area.style.position = 'fixed'
      area.style.opacity = '0'
      document.body.appendChild(area)
      area.select()
      document.execCommand('copy')
      area.remove()
    }
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 1800)
  }
  return (
    <button
      type="button"
      onClick={() => void copy()}
      className={clsx('inline-flex min-h-11 items-center gap-2 rounded-full border border-[var(--border)] bg-white/80 px-4 text-sm font-semibold text-[var(--ink)] hover:bg-white', focusRing, className)}
    >
      {copied ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </button>
  )
}

export function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[#0f2236] text-[#e6eef8]">
      <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-[#9db3c9]">{label}</span>
        <CopyButton value={code} className="!min-h-9 !border-white/20 !bg-white/10 !text-white hover:!bg-white/20" />
      </div>
      <pre className="mono overflow-x-auto p-4 text-xs leading-relaxed" tabIndex={0}>{code}</pre>
    </div>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={clsx('animate-pulse rounded-2xl bg-[var(--surface-muted)]', className)} />
}
