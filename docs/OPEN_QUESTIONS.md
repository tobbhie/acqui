# Open technical questions and TODOs

## Needs your decision

1. **Mainnet unlock.** Confirm you understand the mainnet warning before any mainnet chain config, RPC, read check, or deploy step is added. Until then no mainnet RPC is called.
2. **Blocklisted refund address (review finding, left open on purpose).** If the customer's refund address is, or later becomes, blocklisted by the USDC issuer, `recover` reverts and that money stays in the receiver. Options: (a) accept and mitigate: checkout rejects a blocklisted refund address up front using the token's `isBlacklisted` view (recommended, current design); (b) add a redirect signed by the refund address owner, which also lets someone route funds around an issuer freeze, so it needs a compliance decision; (c) default the refund address to the merchant and let the merchant refund off-chain.
3. **Refund address at checkout.** Safe recovery needs the refund address inside the receiver identity, so checkout must ask for it before showing the receiver. Confirm this UX change (Step 05/06), or choose option (c) above.
4. **Keeper reimbursement and recovery delay values.** Both are constructor arguments. Reimbursement is at most 0.10 USDC and is taken from the merchant side. Recovery delay is 1 hour to 30 days. Pick values after the Arc Testnet gas measurement. Suggested starting point: 0.02 USDC and 24 hours.
5. **Attester.** Who holds the signing key (single key, multisig via ERC-1271, or a hardware-backed service)? It is immutable per distributor.
6. **Fee recipient Safe.** Provide the Safe address. It will be checked on the explorer before any deployment. Nothing can be deployed without it.
7. **Next.js vs Vite.** Arc Studio's sandbox runs Vite + React. Keep the SPA or port to Next.js later.
8. **Folder mapping.** `contracts/` stays the Foundry root instead of `packages/contracts`.

## Resolved by the testnet deployment

- **Fee Safe**: 0x78b96a800a3a6cd349cb2b0016148F20621cd00F (testnet). Confirm the mainnet Safe separately before you deploy.
- **Reimbursement**: 0.02 USDC covers the measured settlement gas on testnet (about 0.011 to 0.013 USDC at the time). Gas prices can move, so re-measure before mainnet.
- **Native deposits** are confirmed live: one system log, no ERC-20 log. ERC-20 transfers produce both.
- **Still open**: attester key custody for mainnet, blocklisted refund address policy, refund address at checkout, Google credentials.

## Decided in Step 05 (tell me if you disagree)

- **Vite instead of Next.js.** Arc Studio runs Vite, so the app is one static single page app. Checkout is routed by host (`checkout.` serves only `/pay/{id}`). Everything the spec needs from Next.js (routes, host routing) works the same; there is no server rendering. Say so if you need a Next.js port for submission.
- **Same-origin API.** The browser calls `/api/*`, which Vercel rewrites to the API host. This keeps the session cookie first-party. If you would rather call `api.acqui.xyz` directly, cookies need a shared parent domain and CORS changes.
- **Demo prices** are 1.00 and 2.00 USDC so a real walkthrough costs little. Change them in `apps/api/src/routes/demo.ts`.
- **Checkout shows no refund address** (it can equal the merchant payout address). The page only explains that refunds go to the address committed at creation.
- **No visual review done.** I could not open the pages in a browser here. Layout was built mobile-first and checked by typecheck, lint and render tests, so please look at the pages on a phone and a desktop.

## Decided in Step 04 (tell me if you disagree)

- **Two keys.** The attester key signs, the keeper key pays gas. The worker refuses to start if they match or if the attester is not the contract's attester. Who holds the attester key in production (a Safe cannot sign here; an EOA or a 1271 contract can) is still your decision.
- **Recovery is automatic by default** (`RECOVERY_AUTOEXECUTE=true`). The keeper pays gas for refunds and is not reimbursed. Set it to `false` to review refunds first.
- **Scanner reads every system-emitter log** and filters in the worker. Fine at testnet volume; on mainnet, measure the rate first. A narrower RPC filter by receiver address is the next optimization.
- **Settlement gives up after 5 failed attempts** and the money goes through recovery. Tell me if you prefer more retries or a manual review state.
- **`payment.expired` webhook** is sent as an informational event. Only `payment.settled` means fulfil.
- **Not exercised live:** the worker has never run against a deployed distributor, and `verifyDeposit` (re-reading the system log in the deposit receipt) is covered by scripted tests only, because anvil does not emit Arc's system logs.

## Decided in Step 03 (tell me if you disagree)

- **Refund address.** The create call must return a receiver immediately, so the refund address defaults to the merchant payout address (merchant refunds off-chain). The merchant may pass `refund_address` to commit a customer address. A customer-chosen refund at checkout would need a new attempt and is not built.
- **One attempt per intent.** A retry is a new intent with a new Idempotency-Key, a new public id and a new receiver.
- **Max payment** is 100,000 USDC at the API (operational limit, not a contract rule).
- **Keeper reimbursement** is `KEEPER_REIMBURSEMENT_USDC` from configuration, checked against the contract's immutable cap at startup. Set it before creating intents.
- **Rate limits** are in memory (single instance). Move to a shared store if you run several API replicas.
- **Webhook URL safety** is validated on save; the worker must resolve DNS and re-check the IP at delivery time (Step 04).
- **Session and cookies** assume the dashboard and API share a site (use a proxy path such as `/api`). Cross-site cookies are not supported.

## Decided in Step 02

- Fee rounding: round up, same in Solidity and TypeScript.
- Keeper reimbursement is a fixed amount in the terms, paid to the settlement caller, capped by an immutable limit, deducted from the merchant side.

## Email for payout changes

Oqumail (oqumail.com, correct spelling) publishes a transactional HTTPS API in its own guides: `POST https://api.oqumail.com/api/v1/emails`, `Authorization: Bearer <per-mailbox API key>`, JSON `{ to, subject, text }`, `202` means queued. It also offers IMAP/SMTP for mailboxes, but no SMTP relay for sending from apps is documented, so the integration uses the HTTPS API. Set only `OQUMAIL_API_KEY`: the sender address is configured in Oqumail, so none is sent from here and `EMAIL_FROM` is ignored. Not yet exercised against a live Oqumail account. Without a complete email configuration, payout changes stay disabled.

## Not yet verified live

- Real Google sign-in (needs your OAuth client id, secret and registered redirect URI).
- `verifyDeployment` against a real distributor (needs a deployment).

- Native send to a counterfactual receiver, then settlement, on Arc Testnet (script ready: `bun run integration:settle`, needs funded throwaway keys and a deployed or deployable distributor).
- Finality depth in practice and the 20 gwei fee floor behavior.
- All mainnet values (see `docs/VERIFIED_CONSTANTS.md`).
- ERC-1271 attester path (only the EOA path is tested).

## Known limits (documented, not fixed)

- Native dust below 1e-6 USDC and non-USDC tokens sent to a receiver cannot be recovered.
- Receiver `receive()` would lock native value on a chain where native is not USDC. Arc only.
- Error messages carry no context values (diagnostic nicety from the review).

## TODOs by step

- Step 03: deployment (testnet first, mainnet by you), record addresses and chain id.
- Step 04 worker: monitor on the system emitter with a persisted cursor and counting once (`recordDeposit`), attester signing service, keeper, `expireOverdue` sweeper, `markSettled` from the decoded `PaymentSettled` log, webhook delivery with HMAC signing.
- Step 05: checkout page wired to `/public/payments/*`, merchant dashboard UI, webhook delivery details, customer refund address capture.
- Step 06: mainnet demo with public transaction hashes.
