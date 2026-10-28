import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Field } from '@/components/ui'
import { SecretReveal } from '@/components/merchant/SecretReveal'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/hooks'
import { refreshMerchant } from '@/lib/merchant'
import type { MerchantSettings } from '@/lib/types'

export function WebhookSettings({ merchant }: { merchant: MerchantSettings }) {
  const qc = useQueryClient()
  const [url, setUrl] = useState(merchant.webhook_url ?? '')
  const [secret, setSecret] = useState<string | null>(null)
  const save = useMutation({
    mutationFn: () => api('/v1/merchant', { method: 'PATCH', body: { webhook_url: url.trim() || null } }),
    onSuccess: () => refreshMerchant(qc),
  })
  const makeSecret = useMutation({
    mutationFn: () => api<{ secret: string }>('/v1/merchant/webhook-secret', { method: 'POST' }),
    onSuccess: async (r) => { setSecret(r.secret); await refreshMerchant(qc) },
  })
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate() }

  return (
    <div className="space-y-4">
      <form onSubmit={submit} className="space-y-3">
        <Field id="webhook-url" label="Webhook endpoint (optional)" placeholder="https://api.example.com/acqui/webhook" inputMode="url"
          value={url} onChange={(e) => setUrl(e.target.value)}
          hint="Public HTTPS only. We send a signed payment.settled message here once a payment has settled onchain." />
        {save.isError && <Alert tone="danger">{errorMessage(save.error)}</Alert>}
        {save.isSuccess && <Alert tone="success">Saved.</Alert>}
        <Button type="submit" variant="secondary" busy={save.isPending}>Save endpoint</Button>
      </form>

      <div className="space-y-3 border-t border-[var(--border)] pt-4">
        <p className="text-sm">
          Signing secret: <strong>{merchant.webhook_secret_configured ? 'configured' : 'not created'}</strong>.
          Webhooks are only sent once a secret exists, and your server must verify the signature before acting on one.
        </p>
        {secret ? (
          <SecretReveal title="Your webhook signing secret" secret={secret} onDone={() => setSecret(null)} />
        ) : (
          <Button variant="secondary" busy={makeSecret.isPending}
            onClick={() => { if (!merchant.webhook_secret_configured || window.confirm('Rotating invalidates the current secret. Update your server right after.')) makeSecret.mutate() }}>
            {merchant.webhook_secret_configured ? 'Rotate signing secret' : 'Create signing secret'}
          </Button>
        )}
        {makeSecret.isError && <Alert tone="danger">{errorMessage(makeSecret.error)}</Alert>}
      </div>
    </div>
  )
}
