import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Field } from '@/components/ui'
import { ReturnOriginField } from '@/components/merchant/ReturnOriginField'
import { toOrigin } from '@/lib/format'
import { api } from '@/lib/api'
import { addressUrl, looksLikeAddress } from '@/lib/format'
import { errorMessage, usePublicConfig } from '@/lib/hooks'
import { refreshMerchant } from '@/lib/merchant'
import type { MerchantSettings } from '@/lib/types'

export function SettingsTab({ merchant }: { merchant: MerchantSettings }) {
  const qc = useQueryClient()
  const config = usePublicConfig()
  const [name, setName] = useState(merchant.display_name)
  const [origin, setOrigin] = useState(merchant.allowed_return_origin ?? '')
  const [next, setNext] = useState('')
  const save = useMutation({
    mutationFn: () => api('/v1/merchant', { method: 'PATCH', body: { display_name: name.trim(), allowed_return_origin: toOrigin(origin) ?? (origin.trim() || null) } }),
    onSuccess: () => refreshMerchant(qc),
  })
  const change = useMutation({ mutationFn: () => api<{ expires_at: string }>('/v1/merchant/payout-address/change', { method: 'POST', body: { new_address: next.trim() } }) })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }
  const explorer = merchant.payout_address && config.data ? addressUrl(config.data.chain_id, merchant.payout_address) : null

  return (
    <div className="space-y-8">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="display text-xl font-semibold">Business</h2>
        <Field id="s-name" label="Business name" value={name} minLength={2} maxLength={80} onChange={(e) => setName(e.target.value)} hint="Shown to customers on checkout." />
        <ReturnOriginField id="s-origin" value={origin} onChange={setOrigin} />
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="success">Saved.</Alert>}
        <Button type="submit" busy={save.isPending}>Save</Button>
      </form>

      <section className="space-y-3">
        <h2 className="display text-xl font-semibold">Payout address</h2>
        <p className="mono break-all rounded-2xl bg-[var(--surface-muted)] p-3 text-sm">{merchant.payout_address ?? 'Not set'}</p>
        {explorer && <a href={explorer} target="_blank" rel="noopener noreferrer" className="text-sm font-medium text-[var(--accent-hover)] hover:underline">View on explorer</a>}
        <p className="text-sm text-[var(--ink-2)]">
          Each payment keeps the address that was active when it was created. A change applies to new payments only, and only after you confirm it from a link we email to your Google account address. The current address stays in use until then.
        </p>
        {!merchant.payout_changes_enabled ? (
          <Alert tone="warning" title="Address changes are turned off">
            Email confirmation is not configured on this server, so the payout address cannot be changed. This is deliberate: it is never changed without email verification.
          </Alert>
        ) : change.isSuccess ? (
          <Alert tone="success" title="Check your email">We sent a one-time link that works for 15 minutes. The address changes only when you open it.</Alert>
        ) : (
          <form onSubmit={(e) => { e.preventDefault(); if (looksLikeAddress(next)) change.mutate() }} className="space-y-3">
            <Field id="s-new" label="New payout address" placeholder="0x…" spellCheck={false} autoComplete="off" className="mono" value={next} onChange={(e) => setNext(e.target.value)}
              error={next.length > 0 && !looksLikeAddress(next) ? 'Enter a 42 character address starting with 0x' : null} />
            {change.isError && <Alert tone="danger">{errorMessage(change.error)}</Alert>}
            <Button type="submit" variant="secondary" busy={change.isPending} disabled={!looksLikeAddress(next)}>Email me a confirmation link</Button>
          </form>
        )}
      </section>
    </div>
  )
}
