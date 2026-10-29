import { useState } from 'react'
import { Field } from '@/components/ui'
import { toOrigin } from '@/lib/format'

/**
 * Return origins are compared exactly (scheme + host + port, nothing else). If a page URL is pasted, it is cut down
 * to its origin so the merchant is not sent back and forth with validation errors.
 */
export function ReturnOriginField({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) {
  const [note, setNote] = useState<string | null>(null)
  const here = window.location.origin
  const normalize = () => {
    const origin = toOrigin(value)
    if (origin && origin !== value.trim()) {
      onChange(origin)
      setNote(`Kept only the origin: ${origin} (the path is not part of it).`)
    } else setNote(null)
  }
  return (
    <div>
      <Field
        id={id}
        label="Return origin"
        placeholder={here}
        inputMode="url"
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => { setNote(null); onChange(e.target.value) }}
        onBlur={normalize}
        hint="Only scheme, host and port, for example https://shop.example.com. Checkout may send customers back only to URLs on exactly this origin."
      />
      {note && <p role="status" className="mt-1 text-xs text-[var(--success)]">{note}</p>}
      <button
        type="button"
        onClick={() => { onChange(here); setNote(null) }}
        className="mt-2 min-h-11 rounded-full border border-[var(--border)] bg-white/80 px-4 text-xs font-semibold text-[var(--ink)] hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]"
      >
        Use this site: <span className="mono">{here}</span>
      </button>
      <p className="mt-1 text-xs text-[var(--muted)]">The demo store needs this exact value for its merchant.</p>
    </div>
  )
}
