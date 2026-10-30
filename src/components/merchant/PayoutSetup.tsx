import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Field } from '@/components/ui'
import { api } from '@/lib/api'
import { looksLikeAddress } from '@/lib/format'
import { errorMessage } from '@/lib/hooks'
import { refreshMerchant } from '@/lib/merchant'
import { usePublicConfig } from '@/lib/hooks'

/** First payout address: typed twice and explicitly acknowledged. Later changes need email confirmation. */
export function PayoutSetup() {
  const qc = useQueryClient()
  const config = usePublicConfig()
  const [address, setAddress] = useState('')
  const [again, setAgain] = useState('')
  const [ack, setAck] = useState(false)
  const set = useMutation({
    mutationFn: () => api('/v1/merchant/payout-address', {
      method: 'POST',
      body: { payout_address: address.trim(), confirm_address: again.trim(), acknowledge: true },
    }),
    onSuccess: () => refreshMerchant(qc),
  })
  const mismatch = again.length > 0 && address.trim().toLowerCase() !== again.trim().toLowerCase()
  const invalid = address.length > 0 && !looksLikeAddress(address)
  const ready = looksLikeAddress(address) && !mismatch && ack
  const submit = (e: FormEvent) => { e.preventDefault(); if (ready) set.mutate() }
  const network = config.data?.livemode ? 'Arc mainnet' : 'Arc Testnet'

  return (
    <form onSubmit={submit} className="space-y-4">
      <Field id="payout" label={`Payout wallet on ${network}`} placeholder="0x…" spellCheck={false} autoComplete="off" className="mono"
        value={address} onChange={(e) => setAddress(e.target.value)} error={invalid ? 'Enter a 42 character address starting with 0x' : null}
        hint="A wallet you control. Settled payments are sent here in USDC." />
      <Field id="payout2" label="Type the address again" placeholder="0x…" spellCheck={false} autoComplete="off"
        value={again} onChange={(e) => setAgain(e.target.value)} error={mismatch ? 'The two addresses do not match' : null} />
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5 size-5" />
        <span>I checked this address and it is on {network}. {config.data?.livemode ? 'Real USDC is sent here. ' : 'Payments are sent here. '}Changing it later needs confirmation by email, and funds sent to a wrong address cannot be recovered.</span>
      </label>
      {set.isError && <Alert tone="danger">{errorMessage(set.error)}</Alert>}
      <Button type="submit" busy={set.isPending} disabled={!ready}>Save payout address</Button>
    </form>
  )
}
