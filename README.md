# Acqui

A USDC payment gateway for Arc. Merchants create a payment from their server, redirect the customer to a hosted checkout, and receive a signed webhook after the payment settles. The settlement contracts are deployed on Arc mainnet (see `docs/DEPLOYMENTS.md`); the contracts are tested but have not had an independent third-party audit, so start with small payments. Developer docs live at `/docs` on the site.

Built with [Arc Studio](https://studio.arc.io)

## Tech stack

- Web: React 18, Vite, TypeScript, Tailwind CSS
- API: TypeScript on Bun with Hono, Zod and PostgreSQL; Google sign-in through openid-client
- Worker: TypeScript on Bun with viem: chain scanner, settlement keeper, reconciliation and signed webhooks
- Shared: zod schemas, viem
- Contracts: Solidity 0.8.28 with Foundry and OpenZeppelin
- Network: Arc mainnet (chain ID 5042) in production; Arc Testnet for rehearsals

## Pages

The site serves `/` (landing), `/docs` (developer docs, pre-rendered at build time for search engines), `/demo`, `/merchants` and `/pay/{id}` (hosted checkout).

## Development

Prerequisites: Bun.

```bash
bun install
bun run dev            # web app
bun run test           # shared and API tests (API tests need PostgreSQL, see below)
bun run check          # lint and typecheck
bun run verify:chain   # read-only live Arc Testnet checks
bun run contracts:build && bun run contracts:test   # compile and test the contracts
bun run integration:settle -- --local   # end-to-end settlement on a local anvil (start `anvil` first)
bun run api:dev        # needs the API variables below
bun run worker:dev     # needs the worker variables below and a deployed distributor
bun run verify:scanner # read-only check of the deposit decoder against real Arc Testnet logs
```

The API applies its SQL migrations on startup. For tests, run PostgreSQL and create a database named `acqui_test` (or set `TEST_DATABASE_URL`). `docs/SUBMISSION.md` lists what the Arc Microgrants submission needs. `docs/DEPLOY_NORTHFLANK_CLOUDFLARE.md` covers deploying the API and worker to Northflank and the website to Cloudflare Pages. `docs/DEMO.md` covers the demo store and hosted checkout. `docs/API.md` has the endpoint list and a curl walkthrough, `docs/WEBHOOKS.md` how merchants verify webhooks, and `docs/RUNBOOK.md` how to operate the worker.

See `docs/ARCHITECTURE.md` for the layout, `docs/THREAT_MODEL.md` for contract risks, and `docs/OPEN_QUESTIONS.md` for open decisions.

## Environment variables

Copy `.env.example` to `.env`. Never commit it.

- `ACQUI_NETWORK`: network id, `arc-testnet` only for now.
- `DATABASE_URL`: PostgreSQL connection string (API, worker).
- `ARC_RPC_URL`: managed Arc RPC, required in production.
- `RPC_PROXY_BASE_URL`, `RPC_PROXY_TOKEN`, `RPC_PROXY_CHAINS`: optional outside Arc Studio, used by `verify:chain` when set.
- `CHECKOUT_BASE_URL`: public checkout origin.
- `FEE_RECIPIENT_SAFE`: immutable fee recipient address.
- `KEEPER_REIMBURSEMENT_CAP_USDC`: cap for keeper reimbursement.
- `PORT`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `DASHBOARD_BASE_URL`, `SESSION_SECRET`, `API_KEY_PEPPER`, `WEBHOOK_SECRET_ENCRYPTION_KEY`: API settings.
- `DISTRIBUTOR_ADDRESS`: deployed distributor; without it payment intents are refused.
- `KEEPER_REIMBURSEMENT_USDC`: fixed keeper reimbursement per payment.
- `TRUST_PROXY`: `true` only behind a trusted proxy.
- `TEST_DATABASE_URL`: optional, PostgreSQL URL for API tests.
- `OQUMAIL_API_KEY`: optional. The only setting Oqumail needs for payout address change confirmation emails; the sender is configured in Oqumail.
- `EMAIL_PROVIDER` (`oqumail` or `smtp`), `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `EMAIL_FROM`: optional SMTP alternative (all required together).
- `KEEPER_PRIVATE_KEY`, `ATTESTER_PRIVATE_KEY`, `ARC_RPC_FALLBACK_URLS`, `SCANNER_START_BLOCK`, `SCAN_INTERVAL_MS`, `KEEPER_INTERVAL_MS`, `RECONCILE_INTERVAL_MS`, `SCAN_MAX_BLOCKS`, `REPLAY_OVERLAP_BLOCKS`, `CONFIRMATIONS`, `MAX_FEE_PER_GAS_GWEI`, `MIN_KEEPER_BALANCE_USDC`, `CURSOR_LAG_ALERT_SECONDS`, `STUCK_SETTLEMENT_ALERT_SECONDS`, `ALERT_WEBHOOK_URL`, `RECOVERY_AUTOEXECUTE`, `HEALTH_PORT`: worker settings (see `.env.example`).
- `DEMO_MERCHANT_API_KEY`, `DEMO_WEBHOOK_SECRET`, `DEMO_API_BASE_URL`: demo store settings, server side only.
- `VITE_API_BASE`, `ACQUI_API_PROXY_TARGET`: optional frontend API prefix and dev proxy target.
- `VITE_PUBLIC_API_URL`, `VITE_SITE_URL`: optional build-time overrides for the API and site addresses shown in the docs and dashboard examples (they default to the live addresses).
- `API_ORIGIN` and `PROXY_SHARED_SECRET` (Cloudflare Pages settings, not read by the repo's own services): where the website's `/api` function forwards, and its shared secret with the API. `PROXY_SHARED_SECRET`, `CORS_ALLOWED_ORIGINS` and `COOKIE_SAME_SITE` are also read by the API. See `deploy/*.env.example`.
- `INTEGRATION_DEPLOYER_KEY`, `INTEGRATION_ATTESTER_KEY`, `INTEGRATION_CUSTOMER_KEY`, `INTEGRATION_KEEPER_KEY`, `INTEGRATION_MERCHANT_ADDRESS`, `INTEGRATION_FEE_SAFE_ADDRESS`, `DISTRIBUTOR_ADDRESS`, `RPC_URL`: only for `integration:settle` against a live testnet.
