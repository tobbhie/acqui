# apps/web

The web app is the Vite + React single page app in the repository root `src/`. `apps/web/src` is the small server that runs it in production: it serves the built files, falls back to the app for client routes (`/demo`, `/merchants`, `/pay/{id}`) and forwards `/api/*` to the API with the prefix removed, so the browser talks to one origin and session cookies stay first-party. Hosts starting with `checkout.` are served by the same app, which then shows only the hosted checkout.

    bun run build        # builds dist/
    API_INTERNAL_URL=http://localhost:8080 bun run start:web

See `docs/RAILWAY.md`.
