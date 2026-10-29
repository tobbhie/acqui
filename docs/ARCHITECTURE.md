# Acqui architecture (Step 01 foundation)

Status: foundation plus contracts (Step 02). Nothing is deployed. No payment is processed.

## Product

A merchant integrates a server-side API and redirects the customer to hosted checkout. The customer sends USDC on Arc to a unique deterministic receiver. The receiver and distributor settle to the merchant, deduct the gateway fee and a bounded keeper reimbursement.

## Repository layout

| Planned path | Where it lives now | Notes |
| --- | --- | --- |
| web | `src/` (Vite + React), `functions/`, `edge/` | Static site on Cloudflare Pages plus a Pages Function that forwards `/api/*` to the API. Moving to Next.js is an open question. |
| apps/api | `apps/api/` | Hono service: Google sign-in, merchant settings, API keys, payment intents, public checkout read model. PostgreSQL via `postgres`, SQL migrations in `apps/api/migrations`. See `docs/API.md`. |
| apps/worker | `apps/worker/` | Boots and validates config. Monitor, keeper and webhook loops are TODOs. |
| packages/contracts | `contracts/` (Foundry root) | Arc Studio's contract tooling expects `contracts/`. See `packages/contracts/README.md`. |
| packages/shared | `packages/shared/` | Policy math, types, zod schemas, chain config, env validation. Aliased as `@acqui/shared`. |
| docs | `docs/` | This folder. |

## Policies (implemented in `packages/shared/src/policy.ts`)

- Checkout window 30 minutes. Every new attempt gets a new receiver. Expired receivers are never reused.
- Minimum payment 1 USDC.
- Gateway fee: max(0.10 USDC, 0.1% of gross), integer math in 6-decimal base units.
- Keeper reimbursement bounded by a cap that has no default yet.
- Fee recipient is an immutable Safe. Merchant payout address is snapshotted per payment intent.
- API key is a revocable credential, separate from the merchant id.
- Payout address changes need email confirmation. No usable email provider is confirmed, so the address freezes after initial setup.

## Arc USDC facts used (from official Arc docs, not yet all live-verified)

- Two views of one USDC pool: ERC-20 at `0x3600...0000` (6 decimals) and native gas (18 decimals).
- A system emitter `0xffff...fffE` logs an 18-decimal `Transfer` for every USDC movement, including plain native sends.
- One ERC-20 `transfer()` emits two logs (6 and 18 decimals). The monitor must count a movement once.
- Mempool enforces a 20 gwei `maxFeePerGas` floor, relevant to keeper gas budgeting.

`bun run verify:chain` checks chain ID, USDC code and decimals, and sampled log behavior against live RPC and writes `docs/chain-verification-arc-testnet.json`.

## Mainnet

Locked. `ACQUI_NETWORK` accepts only `arc-testnet`, and `packages/shared/src/chains.ts` has no mainnet entry. It is added after you acknowledge the mainnet warning and complete the verification checklist.

## Contracts (Step 02)

Sources in `contracts/`: `AcquiTerms`, `PaymentReceiver`, `PaymentFactory`, `PaymentDistributor`. Spec: `docs/CONTRACT_SPEC.md`. Risks: `docs/THREAT_MODEL.md`. Constants: `docs/VERIFIED_CONSTANTS.md`.

Payment lifecycle:

1. Backend builds `Terms` (intent, attempt, merchant, refund address, amount, expiry, fee policy, keeper reimbursement) and asks the distributor for `predictReceiver(terms)`. The customer pays that address with a plain ERC-20 or native USDC send. Nothing is deployed yet.
2. The monitor sees the deposit and the attester signs a `Settlement` over the terms hash and the deposit evidence.
3. Any keeper calls `settle`. The receiver is deployed if needed, then pays merchant net, the keeper reimbursement and the protocol fee. Excess stays in the receiver.
4. `recover(terms)` sends leftover money to the refund address: immediately after settlement, or after `expiry + RECOVERY_DELAY` if never settled.
5. `collectFees()` sends the whole distributor balance to the immutable Safe.

TypeScript mirrors live in `packages/shared/src/contracts.ts`. `bun run integration:settle` exercises the whole path.

## Worker (Step 04)

Deposits: one global scanner reads the native-USDC system emitter's `Transfer` logs (it covers native sends and ERC-20 transfers, one log per movement) and keeps those to registered receivers. Eligibility uses the block's inclusion timestamp against the 30-minute expiry. Expiry decisions are only taken once the scanner watermark is past the expiry, so an unread on-time deposit can never be missed.

Settlement: on-time deposits covering the invoice -> `verifying`. The keeper re-checks each deposit and the receiver balance on chain, signs the EIP-712 attestation with the attester key, persists the signed transaction, broadcasts, and only marks `settled` after decoding the `PaymentSettled` log and the merchant's USDC payout leg from a successful receipt. Late, partial and excess funds get a `recovery_cases` row and are returned by the contract's `recover` after its grace period.

Webhooks: `payment.settled` is written to an outbox in the same transaction as `settled`, then delivered with an HMAC signature over the stored raw body, backoff retries and SSRF-hardened HTTPS (`docs/WEBHOOKS.md`).
