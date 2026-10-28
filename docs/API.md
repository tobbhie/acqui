# Acqui merchant API (Step 03)

Base URL in development: `http://localhost:8080` (port is `PORT`). All bodies are JSON. Errors are `{ "error": { "code", "message" } }`. Amounts are decimal strings at the API boundary (`"10.00"`) and integer 6-decimal units in the database.

Network note: `network: "arc"` means the network the server is configured for (`GET /health` shows it). While the server runs against Arc Testnet, responses carry `chain_id: 5042002` and `livemode: false`.

## Authentication

| Surface | Credential | Used for |
| --- | --- | --- |
| Dashboard | HttpOnly session cookie from Google sign-in, plus `X-CSRF-Token` and an allowed `Origin` on every POST/PATCH/DELETE | merchant, payout address, API keys, webhook settings |
| Server to server | `Authorization: Bearer aq_live_<id>_<secret>` | payment intents and payments |
| Checkout | none | `/public/*` |

API keys can never manage keys, payout addresses, webhooks or settings. Only the dashboard session can.

## Flow

```bash
BASE=http://localhost:8080

# 1. Sign in with Google in a browser: GET $BASE/auth/google/start
#    then read the CSRF token:      GET $BASE/auth/session   (cookie sent by the browser)

# 2. Create the merchant, review the payout address, set the return origin and webhook
curl -s $BASE/v1/merchant -X POST -H "Cookie: $SESSION" -H "X-CSRF-Token: $CSRF" -H "Origin: $DASHBOARD" \
  -H 'Content-Type: application/json' -d '{"display_name":"Acme Store"}'

curl -s $BASE/v1/merchant/payout-address -X POST -H "Cookie: $SESSION" -H "X-CSRF-Token: $CSRF" -H "Origin: $DASHBOARD" \
  -H 'Content-Type: application/json' \
  -d '{"payout_address":"0xYourArcAddress","confirm_address":"0xYourArcAddress","acknowledge":true}'

curl -s $BASE/v1/merchant -X PATCH -H "Cookie: $SESSION" -H "X-CSRF-Token: $CSRF" -H "Origin: $DASHBOARD" \
  -H 'Content-Type: application/json' \
  -d '{"allowed_return_origin":"https://shop.example.com","webhook_url":"https://shop.example.com/acqui/webhook"}'

# 3. Create an API key (secret appears once) and a webhook signing secret (appears once)
curl -s $BASE/v1/merchant/api-keys -X POST -H "Cookie: $SESSION" -H "X-CSRF-Token: $CSRF" -H "Origin: $DASHBOARD" \
  -H 'Content-Type: application/json' -d '{"label":"production"}'

# 4. From your server: create a payment (30 minute window, fresh receiver address)
curl -s $BASE/v1/payment-intents -X POST \
  -H "Authorization: Bearer $ACQUI_API_KEY" \
  -H 'Idempotency-Key: order-1001-attempt-1' \
  -H 'Content-Type: application/json' \
  -d '{"amount":"10.00","currency":"USDC","network":"arc","order_id":"1001","success_url":"https://shop.example.com/thanks"}'

# 5. Redirect the customer to checkout_url, then read the payment or list payments
curl -s $BASE/v1/payment-intents/$PAYMENT_ID -H "Authorization: Bearer $ACQUI_API_KEY"
curl -s "$BASE/v1/payments?limit=25&status=settled" -H "Authorization: Bearer $ACQUI_API_KEY"

# 6. Checkout page (no credentials, database only)
curl -s $BASE/public/payments/$PUBLIC_ID
curl -s $BASE/public/payments/$PUBLIC_ID/status
```

Example response of step 4 (produced by the test harness with a placeholder distributor address, so the receiver is not a real deployment):

```json
{
  "payment_id": "pi_62a82c6ad5e247d0a66818e9ee1d8fa3",
  "public_id": "2ggMEd-POpOb4rGyiLDicw",
  "status": "awaiting_payment",
  "amount": "10.00",
  "currency": "USDC",
  "network": "arc",
  "chain_id": 5042002,
  "livemode": false,
  "order_id": "1001",
  "checkout_url": "http://localhost:5173/pay/2ggMEd-POpOb4rGyiLDicw",
  "receiver_address": "0x79c8af998c81f6dad0e2015ae154aadb635cbee8",
  "usdc_address": "0x3600000000000000000000000000000000000000",
  "expires_at": "2026-10-28T12:30:00.000Z",
  "fees": { "protocol_fee": "0.10", "keeper_reimbursement": "0.02", "merchant_net": "9.88" },
  "settlement": null
}
```

With no verified `DISTRIBUTOR_ADDRESS` the same call returns `503 contracts_not_configured`. The API never invents a receiver.

## Endpoints

| Method and path | Auth | Notes |
| --- | --- | --- |
| `GET /auth/google/start`, `GET /auth/google/callback` | none | OpenID Connect code flow with PKCE, state cookie, nonce |
| `GET /auth/session`, `POST /auth/logout` | session | session returns the CSRF token |
| `POST /v1/merchant`, `GET /v1/merchant`, `PATCH /v1/merchant` | session | name, allowed return origin, webhook URL |
| `POST /v1/merchant/payout-address` | session | first address only: typed twice plus `acknowledge: true` |
| `POST /v1/merchant/payout-address/change` | session | emails a one-time 15 minute token; current address stays active |
| `POST /v1/merchant/payout-address/confirm` | session | `{ token }`, single use, same account only; notifies by email |
| `GET/POST /v1/merchant/api-keys`, `POST .../:id/rotate`, `DELETE .../:id` | session | revoke is immediate; rotate takes `grace_seconds` |
| `POST /v1/merchant/webhook-secret` | session | creates or rotates the signing secret, shown once |
| `POST /v1/payment-intents` | key or session | requires `Idempotency-Key` |
| `GET /v1/payment-intents/:id`, `GET /v1/payments` | key or session | keyset pagination: `limit` (max 100), `cursor`, `status` |
| `GET /public/payments/:publicId`, `.../status` | none | safe fields only, no-store |
| `GET /health` | none | network and whether contracts are verified |

## Payment statuses

`created` then `awaiting_payment` on creation. The worker (Step 04) moves a payment through `deposit_detected`, `verifying`, `settling` and `settled`. Side paths: `expired`, `underpaid`, `recovery_required`, `retryable_failure`. `settled` can only be written by `markSettled`, from `settling`, with the decoded payout receipt, and only if gross, fee, reimbursement, net and merchant equal the snapshot. The database also refuses `settled` without a settlement transaction hash. Every move is a compare-and-set in a transaction with an audit row.

## Safety properties (all covered by tests)

- Keys: `aq_live_<16 hex id>_<43 char secret>`; only an HMAC-SHA256 digest (with a server pepper) is stored; revoked or expired keys fail immediately.
- Tenant isolation: every query includes the merchant id taken from the credential; other merchants' payments return 404.
- Idempotency: unique on merchant and key; same body replays the stored intent, a different body is 422, concurrent requests create one row. An expired intent is replayed as expired: retry with a new key to get a new receiver.
- Snapshot: payout address, refund address, fees and expiry are frozen at creation by a database trigger.
- Return URLs must sit on the merchant's allowed origin. Webhook URLs must be public https on port 443 or 8443.
- Rate limits: per IP, per key, and stricter on sign-in. In memory, so per instance.
- Public checkout polling never touches the chain.
