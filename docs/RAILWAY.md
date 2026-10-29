# Deploying Acqui to Railway

Three Railway services in one project:

| Service | What | Config file | Replicas |
|---|---|---|---|
| `Postgres` | Railway PostgreSQL plugin | n/a | n/a |
| `api` | Merchant API, sign-in, public checkout API, demo server | `railway.api.json` (`Dockerfile.api`) | 1 (can be raised later) |
| `worker` | Chain scanner, settlement keeper, reconciliation, webhooks | `railway.worker.json` (`Dockerfile.worker`) | **exactly 1** |

The worker is safe against a second copy (a database lock keeps only one active), but keep it at one replica anyway. During a rolling deploy the new worker reports `waiting_for_leader` (healthy) until the old one stops.

The Dockerfiles were not built inside Arc Studio (no registry access there). I checked the same file set by installing production dependencies in a clean folder and booting both services from it in `NODE_ENV=production`, including a second worker waiting on the lock. Railway's first build is the real test of the Docker layer.

## 1. Create the project
1. Railway: **New Project** -> **Deploy from GitHub repo** -> `tobbhie/acqui`. Cancel the auto-created service if it tries to guess a builder.
2. Add **PostgreSQL** (New -> Database). Keep its default name `Postgres`.
3. Create service **api**: New -> GitHub Repo -> same repo. In Settings -> **Config as Code**, set the config file path to `/railway.api.json`.
4. Create service **worker**: same repo, config file path `/railway.worker.json`.
5. Do not set a root directory. The build context is the repository root.

## 2. Variables
Generate each secret once (run locally, paste into Railway; mark them **sealed** if Railway offers it):

    openssl rand -hex 32     # SESSION_SECRET, API_KEY_PEPPER, WEBHOOK_SECRET_ENCRYPTION_KEY

`WEBHOOK_SECRET_ENCRYPTION_KEY` must be **identical** on `api` and `worker`. Changing it later makes stored webhook secrets unreadable, so merchants would have to create new ones.

### `api`
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (private network, no SSL needed) |
| `ACQUI_NETWORK` | `arc-testnet` (the only value accepted until mainnet is unlocked) |
| `ARC_RPC_URL` | your managed Arc RPC URL (required in production) |
| `ARC_RPC_FALLBACK_URLS` | optional, comma separated |
| `DISTRIBUTOR_ADDRESS` | the deployed distributor (see `docs/DEPLOYMENTS.md`) |
| `KEEPER_REIMBURSEMENT_USDC` | `0.02` (must not exceed the contract's immutable cap) |
| `CHECKOUT_BASE_URL` | public web origin, e.g. `https://acqui.xyz` (or `https://checkout.acqui.xyz` if checkout lives there) |
| `DASHBOARD_BASE_URL` | public web origin of the dashboard, e.g. `https://acqui.xyz` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | from Google Cloud |
| `GOOGLE_REDIRECT_URI` | `https://<web origin>/api/auth/google/callback` (also add it in Google Cloud) |
| `SESSION_SECRET`, `API_KEY_PEPPER`, `WEBHOOK_SECRET_ENCRYPTION_KEY` | generated above |
| `TRUST_PROXY` | `true` (Railway sits behind a proxy) |
| `OQUMAIL_API_KEY` | optional; turns on emailed payout-address changes |
| `DEMO_MERCHANT_API_KEY`, `DEMO_WEBHOOK_SECRET` | optional; see `docs/DEMO.md` (set after the demo merchant exists) |

### `worker`
| Variable | Value |
|---|---|
| `NODE_ENV` | `production` |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |
| `ACQUI_NETWORK`, `ARC_RPC_URL`, `ARC_RPC_FALLBACK_URLS` | same as the API |
| `DISTRIBUTOR_ADDRESS` | same as the API |
| `DISTRIBUTOR_DEPLOY_BLOCK` | block of the deployment transaction |
| `KEEPER_PRIVATE_KEY` | funded hot wallet that pays gas. Small balance only |
| `ATTESTER_PRIVATE_KEY` | must be the distributor's immutable attester. A different key from the keeper |
| `WEBHOOK_SECRET_ENCRYPTION_KEY` | same as the API |
| `SCANNER_START_BLOCK` | only needed on the very first start if payments already exist |
| `MIN_KEEPER_BALANCE_USDC`, `CURSOR_LAG_ALERT_SECONDS`, `ALERT_WEBHOOK_URL` | optional tuning and alerts |

Do not set `PORT` or `HEALTH_PORT` on either service: Railway injects `PORT` and both services use it.

The worker refuses to start if the chain ID, USDC address, attester or factory do not match the contract at `DISTRIBUTOR_ADDRESS`, or if `ATTESTER_PRIVATE_KEY` is not that contract's attester. A crash-looping worker with one of those messages in its log is the expected, safe result of a wrong value.

## 3. Domains
- Give `api` a public domain (Railway generated, or a custom one).
- `GOOGLE_REDIRECT_URI`, `DASHBOARD_BASE_URL` and `CHECKOUT_BASE_URL` must match the public addresses where the web app and the API's `/api` path are reachable from the browser. The API's `/auth/google/callback` is the path Google redirects to.

## 4. Deploy order and checks
1. Deploy `api` first. It applies database migrations at start. The worker also applies them, under a lock, so order is not critical.
2. Deploy `worker`.
3. Check, replacing the host:

        curl https://<api domain>/health            # contracts.configured must be true
        curl https://<api domain>/public/config     # payments_ready must be true
        curl https://<worker domain>/health         # phase "running"; only if you gave the worker a domain

   The worker needs no public domain. Use Railway's deploy logs, where `acqui_worker_started` and `scanner_cursor_initialized` mark a healthy start.
4. Fund the keeper (testnet: the faucet; mainnet: real USDC) and confirm the low-balance alert threshold.
5. Run one small payment end to end (`docs/RUNBOOK.md` has the alert table and recovery procedures).

## 5. Operating notes
- **Logs:** both services write JSON lines to stdout. Search for `"level":"error"` and `alert`.
- **Rollback:** redeploy the previous deployment in Railway. Migrations are forward-only, so a rollback does not undo schema changes. Migrations here only add tables and columns.
- **Rotating secrets:** `SESSION_SECRET` signs out all users. `API_KEY_PEPPER` invalidates **all** API keys (merchants must create new ones). `WEBHOOK_SECRET_ENCRYPTION_KEY` invalidates webhook secrets. Rotate the keeper key by funding a new wallet and updating the variable; rotating the attester needs a new distributor deployment.
- **Cost control:** keep the worker at one replica and the keeper balance small.

## 6. Mainnet
`ACQUI_NETWORK` accepts only `arc-testnet` today. Mainnet support in this code is locked until you confirm the mainnet warning in the README, and the contracts are deployed by you outside Arc Studio (`docs/MAINNET_DEPLOY.md`). When you are ready, tell me and I will enable the mainnet network entry with values taken from Circle's official Arc documentation, and these same Railway services switch over by changing variables.
