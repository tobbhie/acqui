import type { ReactNode } from 'react'

/** Small typographic building blocks for the docs. Every heading gets a stable anchor. */
export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="display group mt-14 scroll-mt-24 border-t border-[var(--border)] pt-8 text-2xl font-bold text-[var(--ink)] sm:text-3xl">
      {children}
      <a href={`#${id}`} className="ml-2 text-[var(--subtle)] opacity-0 transition group-hover:opacity-100 focus-visible:opacity-100" aria-label={`Link to ${typeof children === 'string' ? children : 'this section'}`}>#</a>
    </h2>
  )
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return <h3 id={id} className="display mt-8 scroll-mt-24 text-xl font-semibold text-[var(--ink)]">{children}</h3>
}

export function P({ children }: { children: ReactNode }) {
  return <p className="mt-3 max-w-[68ch] text-[15px] leading-7 text-[var(--ink-2)]">{children}</p>
}

export function Ic({ children }: { children: ReactNode }) {
  return <code className="mono rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5 text-[0.85em] text-[var(--ink)]">{children}</code>
}

export function Steps({ children }: { children: ReactNode }) {
  return <ol className="mt-4 space-y-3 [counter-reset:step]">{children}</ol>
}

export function Step({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <li className="flex gap-3 [counter-increment:step]">
      <span className="mono mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-xs font-semibold text-white before:content-[counter(step)]" aria-hidden />
      <div>
        <p className="font-semibold text-[var(--ink)]">{title}</p>
        {children && <div className="mt-1 text-[15px] leading-7 text-[var(--ink-2)]">{children}</div>}
      </div>
    </li>
  )
}

export function Table({ head, rows, caption }: { head: string[]; rows: ReactNode[][]; caption: string }) {
  return (
    <div className="my-5 overflow-x-auto rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)]">
      <table className="w-full min-w-[520px] text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-[var(--surface-muted)] text-xs uppercase tracking-wide text-[var(--muted)]">
          <tr>{head.map((h) => <th key={h} scope="col" className="px-4 py-3 font-semibold">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-[var(--border)]">
          {rows.map((row, i) => (
            <tr key={i} className="align-top">
              {row.map((cell, j) => <td key={j} className="px-4 py-3 text-[var(--ink-2)]">{cell}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
