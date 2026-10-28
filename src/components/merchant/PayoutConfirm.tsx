import { useEffect, useRef, useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/Shell'
import { Alert, LinkButton, Spinner } from '@/components/ui'
import { api } from '@/lib/api'
import { errorMessage } from '@/lib/hooks'
import { refreshMerchant } from '@/lib/merchant'
import type { MerchantSettings } from '@/lib/types'

/** Opened from the emailed link. The one-time token lives in the URL fragment, which browsers never send to servers. */
export function PayoutConfirm() {
  const qc = useQueryClient()
  const [token] = useState(() => new URLSearchParams(window.location.hash.replace(/^#/, '')).get('token'))
  const sent = useRef(false)
  const confirm = useMutation({
    mutationFn: (t: string) => api<MerchantSettings>('/v1/merchant/payout-address/confirm', { method: 'POST', body: { token: t } }),
    onSuccess: () => refreshMerchant(qc),
  })
  useEffect(() => {
    if (!token || sent.current) return
    sent.current = true
    // Remove the token from the address bar and history before doing anything else.
    window.history.replaceState({}, '', window.location.pathname)
    confirm.mutate(token)
  }, [token, confirm])

  return (
    <div className="mx-auto max-w-md pt-8">
      <Card>
        <h1 className="display text-2xl font-bold">Confirm payout address</h1>
        <div className="mt-4 space-y-4" aria-live="polite">
          {!token && !confirm.isSuccess && <Alert tone="warning" title="Link not valid">This confirmation link is missing its token. Request a new change from Settings.</Alert>}
          {confirm.isPending && <Spinner label="Confirming…" />}
          {confirm.isSuccess && <Alert tone="success" title="Payout address updated">New payments will be paid to {confirm.data.payout_address}.</Alert>}
          {confirm.isError && <Alert tone="danger" title="Could not confirm">{errorMessage(confirm.error)} Sign in with the same Google account that requested the change, or request a new link.</Alert>}
          <LinkButton href="/merchants" variant="secondary">Go to dashboard</LinkButton>
        </div>
      </Card>
    </div>
  )
}
