import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Pill, Skeleton } from '@/components/ui'
import { ApiKeyCreate } from '@/components/merchant/ApiKeyCreate'
import { SecretReveal } from '@/components/merchant/SecretReveal'
import { api } from '@/lib/api'
import { formatWhen } from '@/lib/format'
import { errorMessage } from '@/lib/hooks'
import { useApiKeys } from '@/lib/merchant'
import type { ApiKeyInfo } from '@/lib/types'

export function ApiKeysList() {
  const qc = useQueryClient()
  const keys = useApiKeys()
  const [rotated, setRotated] = useState<string | null>(null)
  const refresh = () => qc.invalidateQueries({ queryKey: ['api-keys'] })
  const revoke = useMutation({ mutationFn: (id: string) => api(`/v1/merchant/api-keys/${id}`, { method: 'DELETE' }), onSuccess: refresh })
  const rotate = useMutation({
    mutationFn: (id: string) => api<ApiKeyInfo & { secret: string }>(`/v1/merchant/api-keys/${id}/rotate`, { method: 'POST', body: { grace_seconds: 0 } }),
    onSuccess: async (k) => { setRotated(k.secret); await refresh() },
  })

  return (
    <div className="space-y-4">
      {rotated && <SecretReveal title="Your new API key" secret={rotated} onDone={() => setRotated(null)} />}
      {keys.isPending && <Skeleton className="h-20" />}
      {keys.isError && <Alert tone="danger">{errorMessage(keys.error)}</Alert>}
      {keys.data && keys.data.length === 0 && <p className="text-sm text-[var(--muted)]">No keys yet.</p>}
      <ul className="space-y-2">
        {keys.data?.map((k) => {
          const dead = Boolean(k.revoked_at)
          return (
            <li key={k.id} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface-strong)] p-4">
              <div className="min-w-0">
                <p className="font-medium">{k.label} {dead ? <Pill tone="neutral">Revoked</Pill> : <Pill tone="success">Active</Pill>}</p>
                <p className="mono mt-1 break-all text-xs text-[var(--muted)]">{k.prefix}…</p>
                <p className="text-xs text-[var(--muted)]">Created {formatWhen(k.created_at)} · Last used {formatWhen(k.last_used_at)}</p>
              </div>
              {!dead && (
                <div className="flex gap-2">
                  <Button variant="secondary" busy={rotate.isPending && rotate.variables === k.id} onClick={() => rotate.mutate(k.id)}>Rotate</Button>
                  <Button variant="danger" busy={revoke.isPending && revoke.variables === k.id}
                    onClick={() => { if (window.confirm('Revoke this key? Requests that use it stop working immediately.')) revoke.mutate(k.id) }}>
                    Revoke
                  </Button>
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {(revoke.isError || rotate.isError) && <Alert tone="danger">{errorMessage(revoke.error ?? rotate.error)}</Alert>}
      <details className="rounded-2xl border border-[var(--border)] p-4">
        <summary className="min-h-8 cursor-pointer text-sm font-semibold">Create another key</summary>
        <div className="mt-3"><ApiKeyCreate initialLabel="Another server" /></div>
      </details>
    </div>
  )
}
