# Acqui webhooks

`payment.settled` is the only event that means "fulfil the order". The browser redirect to your `success_url` is not payment proof. `payment.expired` is informational.

## Request

`POST` to your HTTPS webhook URL with a JSON body and these headers:

| Header | Meaning |
|---|---|
| `Acqui-Signature` | `v1=` + hex HMAC-SHA256 of `"<timestamp>.<raw body>"` with your signing secret |
| `Acqui-Timestamp` | Unix seconds when this attempt was signed (changes on every retry) |
| `Acqui-Delivery-Id` | Stable id for this event (the same on every retry). Use it to deduplicate |
| `Acqui-Event` | `payment.settled` or `payment.expired` |

```json
{
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
    "chain_id": 5042002,
    "receiver_address": "0x...",
    "settlement_tx_hash": "0x...",
    "settled_at": "2026-10-28T12:03:40.000Z"
  }
}
```

`chain_id` 5042002 is Arc Testnet. The same field identifies mainnet when you run there.

## Verify (Node)

Use the raw bytes you received, before any JSON parsing.

```js
import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyAcqui(rawBody, headers, secret, toleranceSeconds = 300) {
  const ts = Number(headers['acqui-timestamp']);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(`${ts}.${rawBody}`).digest('hex');
  const given = String(headers['acqui-signature'] ?? '').replace(/^v1=/, '');
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}
```

Then deduplicate on `Acqui-Delivery-Id`, return any 2xx quickly, and do slow work afterwards.

## Delivery rules

- Any non-2xx response, timeout (10 s) or network error is retried: after 30 s, 1 m, 2 m, 5 m, 10 m, 30 m, 1 h, 2 h, 4 h, 8 h, 12 h (12 attempts, about a day). Then the delivery is marked failed.
- Redirects are never followed. Respond directly from the registered URL.
- Only public HTTPS destinations are contacted. Hosts that resolve to private, loopback or link-local addresses are refused, and the connection is pinned to the address that was checked.
- Rotate the signing secret in the dashboard API (`POST /v1/merchant/webhook-secret`). Deliveries use the newest active secret.
