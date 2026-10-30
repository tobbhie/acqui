import { PUBLIC_API_URL, SITE_BASE_URL } from '@/site'

/** Code samples shown in the docs. Plain strings so they are easy to review and copy exactly. */

export const ENV_SETUP = `# The Acqui API and the key from Merchants > Integration
export ACQUI_API_URL="${PUBLIC_API_URL}"
export ACQUI_API_KEY="aq_live_..."`

export const CREATE_CURL = `curl -s "$ACQUI_API_URL/v1/payment-intents" \\
  -H "Authorization: Bearer $ACQUI_API_KEY" \\
  -H "Idempotency-Key: order-1001-try-1" \\
  -H "Content-Type: application/json" \\
  -d '{
    "amount": "10.00",
    "currency": "USDC",
    "network": "arc",
    "order_id": "1001",
    "description": "Order #1001",
    "success_url": "https://shop.example.com/thanks",
    "cancel_url": "https://shop.example.com/cart"
  }'`

export const CREATE_NODE = `// Run this on your server, never in the browser.
const response = await fetch(process.env.ACQUI_API_URL + '/v1/payment-intents', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ' + process.env.ACQUI_API_KEY,
    // Same key + same body = same payment, so retrying a failed request is safe.
    'Idempotency-Key': 'order-' + order.id + '-try-1',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    amount: '10.00',
    currency: 'USDC',
    network: 'arc',
    order_id: String(order.id),
    description: 'Order #' + order.id,
    success_url: 'https://shop.example.com/thanks',
    cancel_url: 'https://shop.example.com/cart',
  }),
})

if (!response.ok) throw new Error((await response.json()).error.message)
const payment = await response.json()`

export const CREATE_RESPONSE = `{
  "payment_id": "pi_62a82c6ad5e247d0a66818e9ee1d8fa3",
  "status": "awaiting_payment",
  "amount": "10.00",
  "currency": "USDC",
  "order_id": "1001",
  "checkout_url": "${SITE_BASE_URL}/pay/2ggMEd-POpOb4rGyiLDicw",
  "receiver_address": "0x79c8af998c81f6dad0e2015ae154aadb635cbee8",
  "expires_at": "2026-10-28T12:30:00.000Z",
  "fees": {
    "protocol_fee": "0.10",
    "keeper_reimbursement": "0.02",
    "merchant_net": "9.88"
  },
  "chain_id": 5042,
  "livemode": true,
  "settlement": null
}`

export const REDIRECT_NODE = `// Express example: send the customer to Acqui's checkout page.
app.post('/checkout', async (req, res) => {
  const payment = await createAcquiPayment(req.session.order) // the code above
  await db.orders.update(req.session.order.id, { acquiPaymentId: payment.payment_id })
  res.redirect(303, payment.checkout_url)
})`

export const CONFIRM_RETURN = `// On your thank-you page: ask Acqui. Do not trust the redirect.
app.get('/thanks', async (req, res) => {
  const order = await db.orders.get(req.session.orderId)
  const reply = await fetch(
    process.env.ACQUI_API_URL + '/v1/payment-intents/' + order.acquiPaymentId,
    { headers: { Authorization: 'Bearer ' + process.env.ACQUI_API_KEY } },
  )
  const payment = await reply.json()
  res.render(payment.status === 'settled' ? 'paid' : 'still-pending', { order })
})`

export const WEBHOOK_EVENT = `{
  "id": "6f1f6c1e-0f7c-4a8e-9a39-1c2f0c9f2f10",
  "type": "payment.settled",
  "created_at": "2026-10-28T12:03:41.000Z",
  "data": {
    "payment_id": "pi_62a82c6ad5e247d0a66818e9ee1d8fa3",
    "order_id": "1001",
    "status": "settled",
    "currency": "USDC",
    "gross": "10.00",
    "fee": "0.10",
    "keeper_reimbursement": "0.02",
    "net": "9.88",
    "network": "arc",
    "chain_id": 5042,
    "settlement_tx_hash": "0x…",
    "settled_at": "2026-10-28T12:03:40.000Z"
  }
}`

export const WEBHOOK_NODE = `import express from 'express'
import { createHmac, timingSafeEqual } from 'node:crypto'

const app = express()

function isFromAcqui(rawBody, headers, secret, toleranceSeconds = 300) {
  const timestamp = Number(headers['acqui-timestamp'])
  if (!Number.isFinite(timestamp)) return false
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false // too old

  const expected = createHmac('sha256', secret).update(timestamp + '.' + rawBody).digest('hex')
  const given = String(headers['acqui-signature'] ?? '').replace('v1=', '')
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

// Read the body as plain text. Do not parse it as JSON before checking the signature.
app.post('/acqui/webhook', express.text({ type: 'application/json' }), async (req, res) => {
  if (!isFromAcqui(req.body, req.headers, process.env.ACQUI_WEBHOOK_SECRET)) return res.sendStatus(401)

  const event = JSON.parse(req.body)
  const deliveryId = req.headers['acqui-delivery-id'] // the same on every retry
  if (await alreadyHandled(deliveryId)) return res.sendStatus(200)

  if (event.type === 'payment.settled') {
    await markOrderPaid(event.data.order_id, event.data.payment_id)
  }
  await rememberDelivery(deliveryId)
  res.sendStatus(200) // any 2xx tells Acqui you got it
})`

export const WEBHOOK_PYTHON = `import hashlib, hmac, time

def is_from_acqui(raw_body: bytes, headers: dict, secret: str, tolerance: int = 300) -> bool:
    timestamp = headers.get("Acqui-Timestamp", "")
    if not timestamp.isdigit() or abs(time.time() - int(timestamp)) > tolerance:
        return False
    expected = hmac.new(secret.encode(), timestamp.encode() + b"." + raw_body, hashlib.sha256).hexdigest()
    given = headers.get("Acqui-Signature", "").replace("v1=", "")
    return hmac.compare_digest(given, expected)`

export const GET_ONE = `curl -s "$ACQUI_API_URL/v1/payment-intents/pi_62a82c6ad5e247d0a66818e9ee1d8fa3" \\
  -H "Authorization: Bearer $ACQUI_API_KEY"`

export const LIST_CURL = `# The 25 most recent paid orders
curl -s "$ACQUI_API_URL/v1/payments?status=settled&limit=25" \\
  -H "Authorization: Bearer $ACQUI_API_KEY"

# The next page: pass back the cursor from the last reply
curl -s "$ACQUI_API_URL/v1/payments?status=settled&limit=25&cursor=NEXT_CURSOR" \\
  -H "Authorization: Bearer $ACQUI_API_KEY"`

export const LIST_RESPONSE = `{
  "data": [ { "payment_id": "pi_…", "status": "settled", "amount": "10.00", "order_id": "1001" } ],
  "next_cursor": "eyJ0IjoiMjAyNi0xMC0yOFQxMjowMzo0MCJ9"
}`

export const ERROR_SHAPE = `{
  "error": {
    "code": "invalid_request",
    "message": "amount: Minimum payment is 1 USDC"
  }
}`

export const REFUND_ADDRESS = `{
  "amount": "10.00",
  "currency": "USDC",
  "network": "arc",
  "order_id": "1001",
  "refund_address": "0xCustomerWalletAddress"
}`
