# Acqui

> Built with Arc Studio

Project memory. Acqui is a USDC payment gateway on Arc (target: mainnet, user-deployed). Build is staged in 6 steps from uploaded docs; see `docs/BUILD_LOG.md`.

## Rules (every step)

- Keep existing code; modify incrementally. Integer token accounting only (bigint, 6-decimal ERC-20 view; 18-decimal native only via `@/onchain-money`).
- No fabricated chain constants; no fake payment-success states. `settled` only after verified onchain settlement.
- Mainnet is locked: user must acknowledge the mainnet warning first. Arc Studio never deploys to mainnet.
- Out of scope: FX, multichain, Privy, Redis, Goldsky, Gelato, full indexer, product catalog.

## Tech Stack

- Web: React 18, Vite, TypeScript, Tailwind (Arc Light tokens in `src/index.css`)
- Shared: `packages/shared` (alias `@acqui/shared`): policy, types, zod schemas, chains, env config
- Services: `apps/api`, `apps/worker` (Bun, TypeScript)
- Contracts: Foundry root is `contracts/`; Acqui contracts are `AcquiTerms`, `PaymentReceiver`, `PaymentFactory`, `PaymentDistributor`. Tests in `contracts/test/Acqui.*.t.sol` (`bun run contracts:test`). Do not put lookup/imported sources under `contracts/` (breaks `forge build`).
- Chain: Arc Testnet (5042002); USDC ERC-20 `0x3600000000000000000000000000000000000000` (6 decimals)

## Deployed contracts

None yet.

## Status

Steps 01-05 done (scaffold, contracts, database and API, worker/keeper/webhooks, frontend and demo). Next: Step 06 mainnet testing and submission. Frontend rules: never put a merchant API key in browser code; checkout status comes only from the public API; links from merchant data go through `safeHttpUrl`; text through `sanitizeText`. Worker rules: one replica; deposits only from the system emitter (never count the ERC-20 log too); expiry decisions only behind the scanner watermark; `settled` only via `markSettled` after a decoded receipt; run the worker tests with PostgreSQL up (`bun test apps/worker`). API tests need PostgreSQL: `docker run -d --name postgres -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:18-alpine` and a database `acqui_test` (override with TEST_DATABASE_URL). Receiver addresses are derived offline in `packages/shared/src/receiver.ts`; after any PaymentReceiver change run `bun run contracts:build && bun run contracts:codegen`. Open decisions: `docs/OPEN_QUESTIONS.md` (blocklisted refund address, refund address at checkout, Safe, attester). Recovery design: refund address is part of the receiver identity; never use tx.from.

## Deployed (Arc Testnet)
Distributor 0xCEe00AB9e0F960F4bEb161ccF6f9B7CCc1FC7AEe, factory 0xe56e733240Af69ba950eFaf9750bEA3f7384eBd0, deploy block 69477093, chain 5042002. Fee Safe 0x78b96a800a3a6cd349cb2b0016148F20621cd00F. Details and live results: docs/DEPLOYMENTS.md. Testnet attester and keeper keys live in the sandbox .env only (ATTESTER_PRIVATE_KEY, KEEPER_PRIVATE_KEY, INTEGRATION_*). Mainnet is deployed by the user, see docs/MAINNET_DEPLOY.md.

Deployment: API and worker on Northflank (Dockerfile.api, Dockerfile.worker), website on Cloudflare Pages (functions/api/[[path]].ts forwards /api/* to the API via edge/proxy.ts), details in docs/DEPLOY_NORTHFLANK_CLOUDFLARE.md and deploy/*.env.example. Worker serves /health on PORT immediately (phase starting, waiting_for_leader, running). Keep the Docker file set (apps/api, apps/worker, packages, src/onchain-facts.ts, src/onchain-money.ts) in sync if imports change.
