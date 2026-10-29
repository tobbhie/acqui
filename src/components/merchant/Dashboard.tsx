import { useState } from 'react'
import clsx from 'clsx'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Card } from '@/components/Shell'
import { LIVE_PAYMENT_CAPABILITY } from '@/payment-capabilities'
import { Button, Pill } from '@/components/ui'
import { ApiKeyCreate } from '@/components/merchant/ApiKeyCreate'
import { IntegrationTab } from '@/components/merchant/IntegrationTab'
import { PaymentsTab } from '@/components/merchant/PaymentsTab'
import { PayoutSetup } from '@/components/merchant/PayoutSetup'
import { SettingsTab } from '@/components/merchant/SettingsTab'
import { api, setCsrfToken } from '@/lib/api'
import { sanitizeText } from '@/lib/format'
import { usePublicConfig } from '@/lib/hooks'
import { useApiKeys } from '@/lib/merchant'
import type { MerchantSettings, SessionInfo } from '@/lib/types'

const TABS = ['Payments', 'Integration', 'Settings'] as const
type Tab = (typeof TABS)[number]

export function Dashboard({ session, merchant }: { session: SessionInfo; merchant: MerchantSettings }) {
  const qc = useQueryClient()
  const config = usePublicConfig()
  const keys = useApiKeys()
  const [tab, setTab] = useState<Tab>('Payments')
  const logout = useMutation({
    mutationFn: () => api('/auth/logout', { method: 'POST' }),
    onSettled: async () => { setCsrfToken(null); qc.clear(); await qc.invalidateQueries({ queryKey: ['session'] }) },
  })
  const hasKey = (keys.data ?? []).some((k) => !k.revoked_at)
  const setupDone = Boolean(merchant.payout_address) && (hasKey || !keys.isSuccess)

  return (
    <div className="space-y-6 pt-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="display text-3xl font-bold">{sanitizeText(merchant.display_name, 80)}</h1>
          <p className="text-sm text-[var(--muted)]">{sanitizeText(session.user.email, 120)}</p>
        </div>
        <div className="flex items-center gap-2">
          {config.data && <Pill tone={config.data.livemode ? 'success' : 'info'}>{config.data.livemode ? 'Arc mainnet' : 'Arc Testnet'}</Pill>}
          <Button variant="ghost" busy={logout.isPending} onClick={() => logout.mutate()}>Sign out</Button>
        </div>
      </header>

      {!setupDone && (
        <Card>
          <h2 className="display text-xl font-semibold">Finish setup</h2>
          <ol className="mt-4 space-y-6">
            <li>
              <p className="font-semibold">1. Payout address {merchant.payout_address && <Pill tone="success">Done</Pill>}</p>
              {!merchant.payout_address && <div className="mt-3"><PayoutSetup /></div>}
            </li>
            <li>
              <p className="font-semibold">2. API key {hasKey && <Pill tone="success">Done</Pill>}</p>
              {!hasKey && merchant.payout_address && <div className="mt-3"><ApiKeyCreate /></div>}
              {!hasKey && !merchant.payout_address && <p className="mt-1 text-sm text-[var(--muted)]">Add a payout address first.</p>}
            </li>
          </ol>
        </Card>
      )}

      <Card className="!p-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Accepted today</p><p className="mt-1 font-semibold">{LIVE_PAYMENT_CAPABILITY.asset} on {LIVE_PAYMENT_CAPABILITY.network}</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Settlement</p><p className="mt-1 font-semibold">{LIVE_PAYMENT_CAPABILITY.settlementAsset} on Arc</p></div>
          <div><p className="text-xs font-semibold uppercase tracking-[0.08em] text-[var(--subtle)]">Planned</p><p className="mt-1 text-sm text-[var(--ink-2)]">More networks and currencies, with Acqui handling conversion and routing.</p></div>
        </div>
        <p className="mt-3 text-xs text-[var(--muted)]">Future routing, FX, off-ramp and escrow features are not available yet.</p>
      </Card>

      <div role="tablist" aria-label="Dashboard sections" className="flex gap-1 overflow-x-auto">
        {TABS.map((t) => (
          <button key={t} role="tab" id={`tab-${t}`} aria-selected={tab === t} aria-controls={`panel-${t}`} onClick={() => setTab(t)}
            className={clsx('min-h-11 shrink-0 rounded-full px-5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--focus)]',
              tab === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--ink-2)] hover:bg-white/70')}>
            {t}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === 'Payments' && <PaymentsTab />}
        {tab === 'Integration' && <IntegrationTab merchant={merchant} />}
        {tab === 'Settings' && <SettingsTab merchant={merchant} />}
      </div>
    </div>
  )
}
