import { CodeBlock } from '@/components/ui'
import { ApiKeysList } from '@/components/merchant/ApiKeysList'
import { WebhookSettings } from '@/components/merchant/WebhookSettings'
import { PUBLIC_API_URL } from '@/site'
import { sanitizeText } from '@/lib/format'
import type { MerchantSettings } from '@/lib/types'

const section = 'space-y-3'
const h2 = 'display text-xl font-semibold'

export function IntegrationTab({ merchant }: { merchant: MerchantSettings }) {
  const origin = merchant.allowed_return_origin ?? 'https://your-site.example'
  // The key is read from an environment variable on YOUR server. It is never pasted into a page or a URL.
  const curl = `curl -X POST ${PUBLIC_API_URL}/v1/payment-intents \\
  -H "Authorization: Bearer $ACQUI_API_KEY" \\
  -H "Idempotency-Key: order-1001-attempt-1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "10.00",
    "currency": "USDC",
    "network": "arc",
    "order_id": "order-1001",
    "description": "Order 1001",
    "success_url": "${sanitizeText(origin, 200)}/thanks",
    "cancel_url": "${sanitizeText(origin, 200)}/cart"
  }'`
  return (
    <div className="space-y-8">
      <section className={section}>
        <h2 className={h2}>API keys</h2>
        <p className="text-sm text-[var(--ink-2)]">Keys are for your server only. They create payments and read their status. Anyone holding a key can create payments for you, so revoke one at the first sign of exposure.</p>
        <ApiKeysList />
      </section>
      <section className={section}>
        <h2 className={h2}>Create a payment from your server</h2>
        <p className="text-sm text-[var(--ink-2)]">
          Reply with the returned <code className="mono">checkout_url</code> and redirect the customer to it.
          Use a new <code className="mono">Idempotency-Key</code> for every new attempt: a retry after expiry gets a new payment and a new address.
        </p>
        <CodeBlock label="curl" code={curl} />
        <p className="text-xs text-[var(--muted)]">Store the key in an environment variable named ACQUI_API_KEY on your server. Do not call this from a browser.</p>
      </section>
      <section className={section}>
        <h2 className={h2}>Webhooks</h2>
        <p className="text-sm text-[var(--ink-2)]">
          Fulfil an order only after you verify a signed <code className="mono">payment.settled</code> message, or after reading the payment from the API yourself.
          A customer arriving back on your success page is not proof of payment.
        </p>
        <WebhookSettings merchant={merchant} />
      </section>
    </div>
  )
}
