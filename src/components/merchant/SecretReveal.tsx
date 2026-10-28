import { useState } from 'react'
import { Alert, Button, CopyButton } from '@/components/ui'

/** A secret is shown here exactly once. It is held only in this component's state, never persisted or logged. */
export function SecretReveal({ title, secret, onDone }: { title: string; secret: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false)
  return (
    <div className="space-y-3 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface-strong)] p-4">
      <Alert tone="warning" title={title}>
        Copy it now and store it in your server's secret manager. It cannot be shown again. Never put it in a web page, a mobile app or a checkout URL.
      </Alert>
      <p className="mono break-all rounded-xl bg-[var(--surface-muted)] p-3 text-xs leading-relaxed" data-secret>{secret}</p>
      <div className="flex flex-wrap items-center gap-3">
        <CopyButton value={secret} label="Copy secret" />
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="size-5" />
          I have stored it safely
        </label>
        <Button variant="secondary" disabled={!saved} onClick={onDone}>Done</Button>
      </div>
    </div>
  )
}
