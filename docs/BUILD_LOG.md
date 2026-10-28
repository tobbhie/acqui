# Build log

## Step 01 of 06: project foundation

Scope: structure, shared typed interfaces, config validation, chain config with verification checklist, README, `.env.example`, minimal web scaffold.

Done: shared policy math and schemas with tests, API and worker boot with fail-fast config, web scaffold with live testnet read and fee preview, live RPC verification script.

## Step 02 of 06: contracts and risk

Scope: core contracts, safety invariants, tests, threat model, verified constants, integration script.

Done:
- `AcquiTerms`, `PaymentReceiver`, `PaymentFactory`, `PaymentDistributor` (no owner, no upgrade path).
- Attested settlement (EIP-712) so the 30-minute deadline rests on deposit evidence, not on balance.
- Keyless recovery to a refund address committed in the receiver identity, with non-overlapping settlement and recovery windows.
- Built-in security review (one low issue fixed, one finding left open for your decision), Slither (no high findings), 93 Foundry tests including invariants.
- TypeScript bindings (`packages/shared/src/contracts.ts`) proven equal to the onchain terms hash and signature scheme.
- `bun run integration:settle -- --local` passes 13 of 13 checks on a local chain with a mock USDC.

Not done: nothing deployed, no Arc Testnet transactions yet, mainnet untouched, no third-party audit.
Next: Step 03.

## Step 03 of 06: database and merchant API

Scope: Google sign-in, PostgreSQL schema and migrations, merchant settings, payout address review and emailed change, API keys, webhook secrets, payment-intent API, public checkout read model.

Done:
- `apps/api` rebuilt on Hono with Zod validation. Migration `0001_init.sql` covers all required tables plus sessions, OAuth flows and a status audit table.
- Receiver addresses are derived offline from the Step 02 contracts (`packages/shared/src/receiver.ts`, proven equal to the on-chain prediction by `integration:settle`) and re-verified against the chain at API startup.
- Payment status changes only through compare-and-set transitions. `settled` needs a decoded payout receipt that matches the snapshot.
- 85 tests (shared plus API against real PostgreSQL) pass, including key revocation, tenant isolation, idempotency, duplicate events, payout snapshot, expiry, URL validation and webhook configuration.

Not done: worker (monitor, attester signing, keeper, webhook delivery), checkout page wiring, real Google sign-in against live credentials, a verified live distributor.
Next: Step 04 worker and keeper.

## Step 04 of 06: worker, settlement and webhooks

Done:
- Oqumail email through its documented HTTPS API (spelling corrected); payout change emails use it when `EMAIL_PROVIDER=oqumail`.
- `apps/worker`: scanner, evaluator, keeper, recovery executor, reconciler, webhook outbox and SSRF-safe delivery, alerts, health endpoint, single-leader lock.
- Migration `0002_worker.sql`: scanner watermark, attempt evidence and raw transactions, outbox bodies, recovery scheduling, one live attempt per payment.
- Decoder proven on real Arc Testnet logs (`bun run verify:scanner`): 1347 of 1347 ERC-20 transfers carry an identical system log, and native-only sends exist.
- 160+ tests including the keeper against the real contracts on a local anvil (settlement, replay refusal, gas shortage, overpayment recovery).

Not done: no worker run against a deployed distributor (none exists yet), no live Arc transactions, mainnet untouched.
Next: Step 05 frontend and demo.

## Step 05 of 06: frontend and demo

Done:
- Landing, merchant area (Google sign-in, onboarding, payments with explorer links, API keys shown once, webhook endpoint and secret, curl snippet, payout settings with email-confirmed change), demo storefront and order page, hosted checkout.
- Hosted checkout reads only the database-backed public API, counts down on the server clock, and moves through waiting, payment seen, settling, settled, expired, underpaid and refund states from the server status alone.
- Demo server: creates payments with the demo merchant key server-side, verifies order status through the payments API on every poll, and accepts signed webhooks. Migration `0003_demo.sql`.
- Public API additions: `/public/config`, order reference, description, received amount and verified settlement hash on the public payment view.
- OAuth state cookie moved to path `/` so it works behind the `/api` prefix.

Not done: the app is a Vite single page app (not Next.js). Nothing was run against a deployed distributor, no real payment was made through the UI, and mainnet remains locked.
Next: Step 06 mainnet testing and submission.
