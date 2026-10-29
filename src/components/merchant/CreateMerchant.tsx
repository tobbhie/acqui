import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/Shell'
import { Alert, Button, Field } from '@/components/ui'
import { ReturnOriginField } from '@/components/merchant/ReturnOriginField'
import { toOrigin } from '@/lib/format'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/hooks'
import { refreshMerchant } from '@/lib/merchant'

export function CreateMerchant() {
  const qc = useQueryClient()
  const [name, setName] = useState('')
  const [origin, setOrigin] = useState('')
  const create = useMutation({
    mutationFn: async () => {
      await api('/v1/merchant', { method: 'POST', body: { display_name: name.trim() } })
      if (origin.trim()) await api('/v1/merchant', { method: 'PATCH', body: { allowed_return_origin: toOrigin(origin) ?? origin.trim() } })
    },
    onSettled: () => refreshMerchant(qc),
  })
  const submit = (e: FormEvent) => { e.preventDefault(); create.mutate() }

  return (
    <div className="mx-auto max-w-lg pt-8">
      <Card>
        <p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Step 1</p>
        <h1 className="display mt-1 text-3xl font-bold">Create your merchant</h1>
        <p className="mt-2 text-sm text-[var(--ink-2)]">Customers see this name on checkout. Next you will add a payout address and an API key.</p>
        <form onSubmit={submit} className="mt-5 space-y-4">
          <Field id="name" label="Business name" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" />
          <ReturnOriginField id="origin" value={origin} onChange={setOrigin} />
          {create.isError && <Alert tone="danger">{errorMessage(create.error)}</Alert>}
          <Button type="submit" busy={create.isPending} className="w-full">Create merchant</Button>
        </form>
      </Card>
    </div>
  )
}
