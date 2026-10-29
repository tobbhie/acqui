# Demo store and hosted checkout

## What it is
`/demo` is a two-product sample store. The browser only talks to the demo SERVER (`/demo/*` on the API). That server holds the demo merchant's API key, creates the payment over the public merchant API (exactly like an outside merchant backend), and returns the hosted checkout link. After checkout the customer lands on `/demo/order/{id}`. That page asks the server for the order status on every poll. The server asks the payments API, and an order is shown as paid only when the API reports the payment as settled (or a correctly signed `payment.settled` webhook arrives). Coming back from checkout proves nothing. Nothing ships: the store is there to show the payment.

## One-time setup (operator)
1. Sign in at `/merchants` with Google and create a merchant, for example "Acqui Demo Store".
2. Set its payout wallet (a wallet you control; this is where the demo money goes).
3. Set its **return origin** to the web app's origin (the value of `DASHBOARD_BASE_URL`). The demo's success and cancel URLs are on that origin and are refused otherwise.
4. Create an API key (Integration tab) and put it in the server environment as `DEMO_MERCHANT_API_KEY`. It is never sent to a browser.
5. Optional but recommended: set the merchant's webhook endpoint to `https://<api host>/demo/webhook`, create the signing secret, and put it in `DEMO_WEBHOOK_SECRET`. The order then flips to paid from the signed message as well as from the API.
6. Restart the API. `GET /public/config` now reports `demo_enabled: true`.

The demo needs the contracts to be deployed and verified (`DISTRIBUTOR_ADDRESS`) and the worker running. Without them `POST /demo/orders` returns `payments_unavailable` and the page says so; no payment is simulated.

## Customer checkout (`/pay/{publicId}`)
Reads only the database-backed public API: `GET /public/payments/{id}` once and `GET /public/payments/{id}/status` every 4 seconds (15 seconds while only a refund remains), stopping at settled or expired. The countdown uses the server's clock. Statuses shown: waiting, payment seen, settling, settled (with the explorer link for the verified settlement transaction), expired, underpaid and refund in progress. The receiver address is shown only while the payment is waiting and the window is open. The QR encodes the plain address only, not a payment URI.

## Hosting
- Website: the Railway `web` service serves the app and forwards `/api/*` to the API (see `docs/RAILWAY.md`).
- `checkout.<domain>` can point at the same deployment: when the host starts with `checkout.` the app serves only `/pay/{id}`.
- The browser only talks to the website origin, so the HttpOnly session cookie stays first-party. Google's redirect URI is `https://<website origin>/api/auth/google/callback`.
- API and worker: Railway, one worker replica.

## Walkthrough for a real payment
1. `/demo` -> Pay with USDC -> hosted checkout opens with a unique address and a 30-minute timer.
2. Send the exact amount of USDC on Arc to the address from your own wallet.
3. The page moves to payment seen, settling, then settled with a link to the settlement transaction on the Arc explorer.
4. `/demo/order/{id}` shows Order paid with the same transaction.
Mainnet: this step has not been run on mainnet. Mainnet config stays locked until you confirm the mainnet warning.
