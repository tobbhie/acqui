import { Shell, Card } from '@/components/Shell'
import { usePath } from '@/lib/route'
import { Landing } from '@/pages/Landing'
import { Demo } from '@/pages/Demo'
import { Docs } from '@/pages/Docs'
import { DemoOrder } from '@/pages/DemoOrder'
import { Merchants } from '@/pages/Merchants'
import { Pay } from '@/pages/Pay'

/** checkout.acqui.xyz serves only hosted checkout: same app, routed by host. */
const isCheckoutHost = (): boolean => window.location.hostname.startsWith('checkout.')

function NotFound() {
  return (
    <div className="mx-auto max-w-md pt-10">
      <Card><h1 className="display text-2xl font-bold">Page not found</h1></Card>
    </div>
  )
}

export default function App() {
  const path = usePath().replace(/\/+$/, '') || '/'
  const pay = /^\/pay\/([A-Za-z0-9_-]{16,64})$/.exec(path)
  const demoOrder = /^\/demo\/order\/([0-9a-f-]{36})$/.exec(path)

  if (isCheckoutHost()) {
    return <Shell minimal>{pay?.[1] ? <Pay publicId={pay[1]} /> : <NotFound />}</Shell>
  }

  let page
  if (path === '/') page = <Landing />
  else if (path === '/demo') page = <Demo />
  else if (path === '/docs') page = <Docs />
  else if (demoOrder?.[1]) page = <DemoOrder orderId={demoOrder[1]} />
  else if (path === '/merchants' || path === '/dashboard' || path === '/dashboard/payout/confirm') page = <Merchants />
  else if (pay?.[1]) return <Shell minimal><Pay publicId={pay[1]} /></Shell>
  else page = <NotFound />

  return <Shell>{page}</Shell>
}
