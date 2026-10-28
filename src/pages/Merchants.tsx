import { CreateMerchant } from '@/components/merchant/CreateMerchant'
import { Dashboard } from '@/components/merchant/Dashboard'
import { LoginPanel } from '@/components/merchant/LoginPanel'
import { PayoutConfirm } from '@/components/merchant/PayoutConfirm'
import { Card } from '@/components/Shell'
import { Alert, Button, Skeleton } from '@/components/ui'
import { errorMessage, useSession } from '@/lib/hooks'
import { useMerchant } from '@/lib/merchant'
import { usePath } from '@/lib/route'

/** Merchant area: login, onboarding and dashboard. Everything is cookie-session based. */
export function Merchants() {
  const path = usePath()
  const session = useSession()
  const merchant = useMerchant(Boolean(session.data?.merchant))
  const loginFailed = new URLSearchParams(window.location.search).get('error') === 'login_failed'

  if (session.isPending) return <div className="mx-auto max-w-md pt-8"><Skeleton className="h-48" /></div>
  if (session.isError) {
    return (
      <div className="mx-auto max-w-md pt-8">
        <Card>
          <Alert tone="danger" title="Could not reach the server">{errorMessage(session.error)}</Alert>
          <Button className="mt-4" onClick={() => void session.refetch()}>Try again</Button>
        </Card>
      </div>
    )
  }
  const confirming = path.replace(/\/+$/, '') === '/dashboard/payout/confirm'
  if (!session.data) return <LoginPanel failed={loginFailed} confirming={confirming} />
  if (confirming) return <PayoutConfirm />
  if (!session.data.merchant) return <CreateMerchant />
  if (merchant.isPending) return <div className="mx-auto max-w-3xl pt-8"><Skeleton className="h-64" /></div>
  if (merchant.isError) {
    return <div className="mx-auto max-w-md pt-8"><Alert tone="danger" title="Could not load your merchant">{errorMessage(merchant.error)}</Alert></div>
  }
  return <Dashboard session={session.data} merchant={merchant.data} />
}
