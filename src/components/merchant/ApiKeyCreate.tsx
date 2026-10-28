import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Field } from '@/components/ui'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/hooks'
import { SecretReveal } from '@/components/merchant/SecretReveal'
import type { ApiKeyInfo } from '@/lib/types'

export function ApiKeyCreate({ initialLabel = 'Production server', onCreated }: { initialLabel?: string; onCreated?: () => void }) {
  const qc = useQueryClient()
  const [label, setLabel] = useState(initialLabel)
  const [secret, setSecret] = useState<string | null>(null)
  const create = useMutation({
    mutationFn: () => api<ApiKeyInfo & { secret: string }>('/v1/merchant/api-keys', { method: 'POST', body: { label: label.trim() } }),
    onSuccess: async (key) => {
      setSecret(key.secret)
      await qc.invalidateQueries({ queryKey: ['api-keys'] })
    },
  })

  if (secret) {
    return <SecretReveal title="Your API key" secret={secret} onDone={() => { setSecret(null); onCreated?.() }} />
  }
  return (
    <div className="space-y-3">
      <Field id="key-label" label="Key label" value={label} maxLength={60} onChange={(e) => setLabel(e.target.value)} hint="Helps you tell keys apart. Not secret." />
      {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
      <Button busy={create.isPending} disabled={!label.trim()} onClick={() => create.mutate()}>Create API key</Button>
    </div>
  )
}
