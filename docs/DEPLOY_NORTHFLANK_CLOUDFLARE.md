# Deploying Acqui: Northflank (API, worker, PostgreSQL) and Cloudflare Pages (website)

```
Browser ──► Cloudflare Pages (acqui.pages.dev)
              ├─ static React app (SPA fallback for /demo, /merchants, /pay/{id}, /dashboard/...)
              └─ /api/*  ──► Pages Function (functions/api/[[path]].ts) ──► Northflank "api" (public HTTPS)
                                                                              │
Merchant servers ───────────────────────────────────────────────────────────►│  (api host, direct)
                                                                              ▼
                                              Northflank "worker" (no public port) ──► PostgreSQL addon (private)
                                                                  └──► Arc RPC, distributor contract
```

Why the website forwards `/api` instead of the browser calling the API host directly: the session cookie stays first-party (SameSite=Lax, HttpOnly), so sign-in works in Safari and Firefox without third-party-cookie exceptions, and the browser needs no CORS. The API still has CORS and a `SameSite=None` option (section 8) if you prefer direct calls.

Everything below was checked against the repository. Items that could not be tested in the Arc Studio sandbox are listed in section 11.

## 1. What runs where (verified from the repository)

| Piece | Entry point | Start command | Port | Notes |
|---|---|---|---|---|
| API (Bun + Hono) | `apps/api/src/index.ts` | `bun run apps/api/src/index.ts` | `PORT` (default 8080) on `0.0.0.0` | Applies SQL migrations at start. `/health` (liveness, no dependencies), `/ready` (checks the database). |
| Worker (Bun + viem) | `apps/worker/src/index.ts` | `bun run apps/worker/src/index.ts` | `HEALTH_PORT` (default 8081) on `0.0.0.0`, internal only | Scanner, attester and keeper loops, reconciliation, webhook delivery. One active instance by database lock. |
| Website | `src/main.tsx` (Vite) | `bun run build` -> `dist/` | n/a | Static. |
| Pages Function | `functions/api/[[path]].ts` -> `edge/proxy.ts` | n/a | n/a | Forwards `/api/*`. |
| Migrations | `apps/api/migrations/*.sql` | automatic; manual: `bun run db:migrate` | n/a | Forward-only, additive, serialized by an advisory lock. |

The repository is a single package (there is no Bun workspace), so `bun.lock` and `package.json` at the root are the only lock and manifest. The Dockerfiles install production dependencies from them with `--frozen-lockfile` and copy only the code each service imports (`packages/`, `apps/api`, `apps/worker`, and `src/onchain-facts.ts` plus `src/onchain-money.ts`, which the shared config imports by path).

## 2. Prerequisites and secrets
- Northflank and Cloudflare accounts, the GitHub repository connected to both (`tobbhie/acqui`).
- A managed Arc RPC URL (required in production) and the deployed distributor (`docs/DEPLOYMENTS.md`).
- Google OAuth web client (section 7). Optional: Oqumail API key.
- Two funded, **different** keys: the attester (must be the distributor's immutable attester) and the keeper (pays gas, small balance).
- Generate the app secrets locally and paste them into the platforms; never commit them:

      openssl rand -hex 32    # SESSION_SECRET
      openssl rand -hex 32    # API_KEY_PEPPER
      openssl rand -hex 32    # WEBHOOK_SECRET_ENCRYPTION_KEY (same on api and worker)
      openssl rand -hex 32    # PROXY_SHARED_SECRET (same on api and Cloudflare Pages)

## 3. Deployment order
1. Northflank project and PostgreSQL addon (section 4).
2. Secret group with the database URL.
3. `api` service. It creates the schema on its first start (migrations 0001 to 0003).
4. Check `https://<api host>/ready` and `/public/config`.
5. `worker` service.
6. Cloudflare Pages project with `API_ORIGIN` set to the API host (section 6).
7. Google redirect URI, then a full sign-in check (section 9).

## 4. Northflank: project and PostgreSQL
1. Create a project in your region of choice.
2. Add a **PostgreSQL addon**. Keep it private (not publicly accessible). Northflank documents TLS as on by default and the addon as reachable only inside the project.
3. Create a **secret group** (runtime variables) named `acqui-shared`. Under linked addons, link the addon and include `POSTGRES_URI`, with the alias `DATABASE_URL`. Apply it to the `api` and `worker` services (inherit it).
4. If the first start fails with a TLS or `no pg_hba` error, append `?sslmode=require` to the value (the driver reads it; if the URI already has a query string use `&sslmode=require`). Not tested here, because the sandbox database has no TLS.
5. Add the secrets that both services share to the same group: `WEBHOOK_SECRET_ENCRYPTION_KEY`, `DISTRIBUTOR_ADDRESS`, `ACQUI_NETWORK`, `ARC_RPC_URL`.

## 5. Northflank: services
Create each as a **combined service** from the GitHub repo, branch `main`. In Build options choose **Dockerfile**.

### 5.1 `api`
| Setting | Value |
|---|---|
| Dockerfile location | `/Dockerfile.api` |
| Build context | `/` (repository root) |
| Port | name `api`, `8080`, protocol HTTP, **public** (Northflank gives it a `code.run` HTTPS address with TLS; add your own domain later if you want) |
| Instances | 1 (rate limits are kept in memory per instance) |
| Runtime variables | everything in `deploy/api.env.example` |
| Health checks | Readiness: HTTP GET `/ready`, port 8080. Liveness: HTTP GET `/health`, port 8080 |
| Termination grace period | 30 seconds |

The container listens on `0.0.0.0:$PORT` and stops cleanly on SIGTERM. Copy the public address into the Pages variable `API_ORIGIN` (origin only, for example `https://p01--api--abc123.code.run`).

### 5.2 `worker`
| Setting | Value |
|---|---|
| Dockerfile location | `/Dockerfile.worker` |
| Build context | `/` |
| Ports | none public. Optionally add a private (not public) port `health` `8081` for health checks |
| Instances | **exactly 1** |
| Runtime variables | everything in `deploy/worker.env.example` |
| Health checks | Liveness: **TCP** on 8081 (process is alive). Do not use `/health` as a liveness probe: it returns 503 while three or more loop ticks in a row fail, for example during an RPC outage, and a restart would not fix that. Use `/health` for monitoring only |
| Termination grace period | 30 seconds |

Behavior you can rely on (each was run in the sandbox and is covered by tests):
- **SIGTERM:** stops starting new work, finishes the tick in progress, releases the leader lock, closes the database pool and exits 0 (about 0.1 s when idle). A second signal or a stuck tick forces the exit after 25 s, before the platform's SIGKILL.
- **Overlapping deployments:** the new worker answers its health endpoint at once but stays in `waiting_for_leader` until the old one releases a PostgreSQL advisory lock, so two workers never run the loops together.
- **Crash or restart mid-settlement:** the signed settlement transaction is stored before it is broadcast; on restart the keeper asks the contract whether the payment already settled before sending anything, so a payment is never settled twice.
- **Scanner:** the cursor is saved in the same transaction as the deposits it found, a few blocks are re-read on every pass, and deposits are unique by (chain, transaction, log). The first start on a database that already has payments needs `SCANNER_START_BLOCK`.
- **Key separation:** the worker refuses to start if the attester key is not the contract's attester, or if it equals the keeper key.

## 6. Cloudflare Pages
Create the project from the GitHub repo (Workers & Pages -> Create -> Pages -> Connect to Git). The free `*.pages.dev` address works; a custom domain is optional.

| Setting | Value |
|---|---|
| Production branch | `main` |
| Framework preset | None (or React/Vite; the settings below win) |
| Root directory | `/` (repository root, so `/functions` is found) |
| Build command | `bun install --frozen-lockfile && bun run build` |
| Build output directory | `dist` |

Environment variables (Settings -> Environment variables; set them for **Production and Preview**; no wallet key belongs here):

| Name | Type | Value |
|---|---|---|
| `BUN_VERSION` | plain text | `1.3.14` (the version of `bun.lock`; Cloudflare's build image supports Bun through this variable) |
| `SITE_URL` | plain text | `https://<your pages domain>` with no trailing slash. The build uses it for the docs page's canonical link, share tags, `sitemap.xml` and `robots.txt`. Without it the site still works but search engines get no sitemap. |
| `NODE_VERSION` | plain text | `22` |
| `API_ORIGIN` | plain text | the API's public HTTPS origin from section 5.1, no path |
| `PROXY_SHARED_SECRET` | **secret** | same value as `PROXY_SHARED_SECRET` on the API |

How it behaves (all of it was run locally with Cloudflare's own runtime, `wrangler pages dev`, against the real API):
- **Client-side routing:** the repository has no `404.html` and no `_redirects`, so Pages serves `index.html` for every path that is not a file. `/demo`, `/merchants`, `/pay/{id}`, `/dashboard/payout/confirm` and unknown paths all return the app. (`_redirects` rules are not applied to Functions routes anyway, so none is used.)
- **API requests:** the app calls relative `/api/...`. The Function `functions/api/[[path]].ts` forwards them to `API_ORIGIN` with the prefix removed, keeps cookies and the CSRF header, passes sign-in redirects and `Set-Cookie` headers through untouched, strips any `X-Acqui-*` or `CF-*` header a caller sends, and adds the visitor address (`CF-Connecting-IP`) together with the shared secret. If `API_ORIGIN` is missing or not an HTTPS origin it answers 500 and forwards nothing; if the API is down it answers a JSON 502.
- **Headers:** `public/_headers` sets `X-Frame-Options: DENY` and `frame-ancestors 'none'` (a hidden frame cannot trick a customer on checkout) and long-lived caching for hashed files in `/assets`.
- **Nothing secret in the browser:** the only values in the built site are public. `API_ORIGIN` and `PROXY_SHARED_SECRET` are read by the Function at runtime, not bundled into the site.
- **Limits:** Pages Functions have a daily request allowance on the free plan; check Cloudflare's current limits for your expected traffic.

### Custom domains (optional)
Pages project -> Custom domains -> add `acqui.example.com` and, as a second domain on the same project, `checkout.example.com`. The app shows only the hosted checkout on hosts that start with `checkout.`. If you use them, set `DASHBOARD_BASE_URL=https://acqui.example.com`, `CHECKOUT_BASE_URL=https://checkout.example.com`, and update the Google redirect URI to the dashboard domain. The checkout domain needs no sign-in, so it needs nothing else. A domain whose DNS is on Cloudflare is the simplest; otherwise add the CNAME Cloudflare shows.

### Preview deployments
Branch previews get their own `*.pages.dev` address. They use the same Function and, if you set the variables for Preview, the same API. Sign-in does not work on a preview unless that origin is also in the API's `CORS_ALLOWED_ORIGINS` and registered with Google, so test sign-in on production.

## 7. Google OAuth
Google Cloud console -> Credentials -> OAuth client (Web application) -> Authorized redirect URI: `https://<pages domain>/api/auth/google/callback` (the same value as `GOOGLE_REDIRECT_URI` on the API). The browser goes to the website, the Function forwards to the API, and Google redirects back through the same path.

## 8. Direct cross-site mode (not recommended)
Only if you do not want the Function: build the site with `VITE_API_BASE=https://<api host>` and set on the API `CORS_ALLOWED_ORIGINS` (if the website origin is not already `DASHBOARD_BASE_URL`) and `COOKIE_SAME_SITE=none` (requires `NODE_ENV=production`; cookies become `SameSite=None; Secure`). The API's CORS already allows only `DASHBOARD_BASE_URL`, `CHECKOUT_BASE_URL` and `CORS_ALLOWED_ORIGINS` with credentials, and the CSRF check uses the same list. Browsers that block third-party cookies (Safari by default) will not keep a session in this mode.

## 9. Verification checklist
Replace the hosts. Items marked (manual) need your browser or accounts.

    curl -s https://<api host>/health                          # {"ok":true,...,"contracts":{"configured":true}}
    curl -s https://<api host>/ready                           # {"ok":true}
    curl -s https://<api host>/public/config                   # payments_ready: true
    curl -s https://<pages domain>/api/public/config           # same answer through the website
    curl -sI https://<pages domain>/demo                       # 200 and X-Frame-Options: DENY
    curl -s -D - -o /dev/null https://<pages domain>/api/auth/google/start | head   # 302 to accounts.google.com with a Set-Cookie

- Worker: the logs show `acqui_worker_started` then `scanner_cursor_initialized`; no `leader_lock_lost`.
- (manual) Sign in with Google on the Pages domain, create a merchant, payout address and API key.
- (manual) Create a payment from a server with the API key, pay it, and watch it reach `settled` (`docs/RUNBOOK.md` has the alert table).
- (manual) After the first deploy, confirm rate limits use real visitor addresses: the API trusts the address the Function forwards (with the shared secret), and otherwise the **last** `X-Forwarded-For` entry. I could not confirm how Northflank's load balancer writes that header.

## 10. Migrations and database operations
- The API and the worker apply pending migrations at start, under a PostgreSQL advisory lock, so concurrent starts are safe. All current migrations only add tables and columns.
- Manual run (for example before a first deploy): from a shell with `DATABASE_URL` set, `bun run db:migrate`. In Northflank you can run it as a one-off job from the same image: command `bun run apps/api/src/migrate.ts`.
- Rollback: redeploy the previous image. Migrations are forward-only and are not undone; because they are additive, the previous version keeps working.
- Back up the addon (schedule backups on the addon) before upgrading versions. A restore also needs the same `WEBHOOK_SECRET_ENCRYPTION_KEY`.

## 11. Tested here, and not
Tested in the sandbox:
- Typecheck, lint, and the test suite (API, worker against real PostgreSQL and real contracts on a local chain, shared code, the edge proxy, the pages).
- API on a fresh database: all migrations applied from empty, binds `0.0.0.0:$PORT`, `/health`, `/ready`, CORS allow and deny, exits 0 on SIGTERM in about 0.1 s.
- Worker against Arc Testnet: starts, verifies the distributor, scans, exits 0 on SIGTERM, a second instance waits for the lock and also stops cleanly.
- Vite production build; Pages Function compiled with Wrangler and exercised in Cloudflare's local runtime together with the static site (SPA fallback for every route, headers, caching, proxying, redirect and cookie pass-through).

Not tested (needs your accounts or infrastructure):
- The Docker images were not built: the sandbox cannot pull base images. I verified the same file set by installing production dependencies in a clean folder and booting both services from it. Northflank's first build is the real test.
- Real Northflank behavior: the PostgreSQL TLS handshake from `POSTGRES_URI`, the load balancer's `X-Forwarded-For` format, and the public `code.run` address.
- Real Cloudflare deployment, custom domains, and Google sign-in end to end.
- Mainnet: `ACQUI_NETWORK` accepts only `arc-testnet` in this code. Mainnet stays locked until you confirm the mainnet warning, and you deploy the contracts yourself (`docs/MAINNET_DEPLOY.md`).

## 12. Manual actions for you
1. Give Northflank and Cloudflare access to the GitHub repo.
2. Create the Postgres addon and the services above; paste the secrets (nothing is created or paid for by the repository).
3. Create the Pages project, set the four variables, copy the API host into `API_ORIGIN`.
4. Register the Google redirect URI.
5. Fund the keeper wallet; confirm the attester key matches the contract.
6. Check Northflank's plan limits and pricing for two services, one addon and the Pages Function volume before you rely on a free tier.
