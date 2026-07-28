# XLNC Platform — Phase 1 + Phase 2

**Vertical slice**: Hostify sync → Postgres persistence → pricing engine (with PriceLabs mock adapter) → one dashboard view.
Deployment target: single self-hosted VPS via Docker Compose.

## What's actually working right now

### Phase 1 (adapters, pricing engine, API, dashboard)
- `@xlnc/shared` — canonical types + adapter interfaces (`PmsAdapter`, `PricingIntelligenceAdapter`).
- `@xlnc/hostify-adapter` — live adapter built against Hostify's public docs (reads only — `updatePrice` deliberately unimplemented until verified against a real sandbox, see below) + a deterministic mock.
- `@xlnc/pricelabs-adapter` — same pattern; no PriceLabs account exists yet, so this runs entirely on the mock today.
- `@xlnc/pricing-engine` — combines availability + market signal into a guardrailed price recommendation (max 15%/day change, configurable floor).
- `apps/web` — Next.js dashboard, one page, server-rendered, with a visible live/mock badge per row.

### Phase 2 (new: persistence)
- `@xlnc/database` — new package:
  - `pool.ts` — Postgres connection pool, configured via `POSTGRES_HOST/PORT/USER/PASSWORD/DB`.
  - `migrate.ts` + `src/migrations/*.sql` — 4 migrations, applied in order, tracked in `schema_migrations`, idempotent on rerun:
    1. `properties` table + `updated_at` trigger
    2. `reservations` table (FK → properties, CASCADE delete, CHECK check_out > check_in, CHECK status enum)
    3. `pricing_recommendations` — **append-only** audit history of every computed recommendation (never overwritten) + `latest_pricing_recommendations` view for "what's the current answer" queries
    4. `sync_runs` — execution log for every sync job (status, timing, records processed, error message)
  - Repositories: `PropertyRepository`, `ReservationRepository`, `PricingHistoryRepository`, `SyncRunRepository` — all real SQL, no ORM.
  - `SyncService` — pulls from a `PmsAdapter` and persists, logging every run to `sync_runs` (success or failure).
- `apps/api` — new routes:
  - `POST /sync/properties` — pulls Hostify (or mock) properties into Postgres
  - `POST /sync/:propertyId/reservations?from&to` — same for reservations
  - `GET /sync/runs` — execution log
  - `GET /pricing/:propertyId/history?from&to[&latestOnly=true]` — read persisted recommendations
  - `GET /pricing/:propertyId/recommendations` — now also persists each computed recommendation as a best-effort side effect (`persisted: true/false` in the response)
  - `GET /health` — now also reports `database: "connected" | "unavailable"`

**Graceful degradation is real, not aspirational**: if Postgres is unreachable at startup, the API still boots and serves live pricing — it just can't persist history or serve DB-backed routes (which return 503) until connectivity returns. This is tested explicitly (see `apps/api/test/app.spec.ts`, "DB unavailable" suite) by pointing the pool at a port nothing listens on and confirming the API doesn't crash.

## What is NOT working yet

- **No live PriceLabs data** — no PriceLabs account/API key exists for this project yet. Every recommendation is generated from the mock signal generator, clearly labeled `source: "mock"`.
- **Hostify price-write path not implemented** — reads are built; writing a new price back to Hostify needs verification against real Hostify sandbox behavior before it's safe to enable (see `HostifyAdapter.updatePrice`).
- **No auth, RBAC, or n8n workflows yet** — later phases per the spec.
- **Docker Compose has not been run** in the sandbox this was built in (no Docker available there) — validate `docker compose up --build` on your actual VPS. Everything else (migrations, build, full test suite, live HTTP smoke test) *has* been run for real against a locally-installed Postgres 16 instance — see the chat transcript for actual command output.

## Running locally (no Docker)

```bash
cp .env.example .env
# for local dev, POSTGRES_HOST=localhost is already the default in .env.example

npm install
npm run build

# apply migrations once (safe to rerun — idempotent)
npm run migrate --workspace=@xlnc/database

npm test

# terminal 1
npm run dev:api
# terminal 2
npm run dev:web
```

Requires a reachable Postgres instance for full functionality (persistence, sync, history). Without one, the API still starts and serves live pricing recommendations — it just logs `[database] UNAVAILABLE at startup` and DB-backed routes return 503.

### Running the database integration tests specifically

The `@xlnc/database` and `@xlnc/api` test suites include real integration tests against Postgres (not mocked). Point them at a **dedicated test database**, never your dev/prod one:

```bash
export POSTGRES_HOST=localhost POSTGRES_USER=postgres POSTGRES_PASSWORD=postgres
export POSTGRES_DB=xlnc_platform POSTGRES_TEST_DB=xlnc_platform_test
npm test
```

## Running on your VPS (Docker Compose)

```bash
cp .env.example .env
# fill in real values you have (Hostify key) and leave the rest blank
docker compose up --build -d
docker compose logs -f api
```

The API automatically runs migrations against the `postgres` service at startup (via `buildDependencies()` → `runMigrations()`) — no separate migrate step needed in Compose.

## Adding your real Hostify key

Put it only in `.env` on the VPS itself — never in chat, git, or docs.

## Phase 3 (new: JWT auth + RBAC)

- `packages/database` migration `005_users_and_auth.sql`: `users` (role CHECK'd to admin/manager/viewer, unique email), `refresh_tokens` (opaque high-entropy tokens, only SHA-256 hash stored, individually or bulk revocable), `audit_log` (append-only, FK to user with `ON DELETE SET NULL` so history survives account deletion).
- New repositories: `UserRepository`, `RefreshTokenRepository`, `AuditLogRepository`.
- `apps/api/src/auth/`: password hashing (bcrypt, 12 rounds), JWT access tokens (15 min TTL, HS256), opaque refresh tokens (30-day TTL, rotated on every use — single-use), `authenticate`/`authorize(...roles)` middleware, and two rate limiters (general API throttle + a stricter one on `/auth/login` specifically).
- **New routes**: `POST /auth/login`, `POST /auth/refresh` (rotates the token), `POST /auth/logout` (revokes it), `GET /auth/me`, `POST /auth/users` (admin-only — no public self-registration by design).
- **RBAC applied to existing routes**: `/properties` and `/pricing/*` require any authenticated role; `/sync/*` requires manager or admin; user creation requires admin.
- **Admin bootstrap**: on startup, if no admin user exists yet and `ADMIN_EMAIL`/`ADMIN_PASSWORD` are set in `.env`, one is created automatically (idempotent, never hardcoded).
- **JWT_SECRET**: if unset, the API generates an ephemeral random secret at boot and logs a loud warning — convenient for local dev, but every session is invalidated on restart, and this must never be relied on in production. Set `JWT_SECRET` explicitly (`openssl rand -hex 32`) before deploying.

**A real bug caught and fixed during this phase**: the two rate limiters were originally module-level singletons, meaning any two `createApp()` calls in the same process would silently share rate-limit counters — harmless in normal single-instance production use, but a genuine correctness issue. Rewritten as factory functions instantiated fresh per `createApp()` call.

**Design tradeoff, stated plainly**: access-token revocation is not instant — a deactivated/role-changed user keeps their existing access token's permissions until it expires (≤15 min), because we don't hit the DB on every request to keep authenticated requests fast. Refresh-token revocation (logout, compromise response) *is* instant, since that's checked against the DB on every use. If you need instant access-token revocation too, that's a deliberate future tradeoff to revisit, not an oversight.

## Phase 4 (new: n8n scheduling workflow)

- `workflows/n8n/xlnc-daily-pricing-sync.json` — scheduled (daily 02:00) workflow: logs in as a dedicated `manager`-role service account, syncs Hostify properties into Postgres, then computes pricing recommendations (which the API already persists as a side effect) for every property over the next 7 days.
- `workflows/n8n/xlnc-pricing-sync-error-handler.json` — companion error workflow, wired via n8n's "Error Workflow" setting.
- `workflows/n8n/README.md` — full setup: creating the service account, required n8n environment variables, import steps, wiring the error workflow, and what's still a placeholder (no real alerting channel configured yet — deliberately marked, not hidden).

**Honest limitation**: n8n itself could not be installed in this build sandbox to do a live import test — one of its dependencies pulls from a domain (`cdn.sheetjs.com`) outside this sandbox's allowed network, the same category of limitation as Docker not being available here. What *was* verified: both files are valid JSON, every node connection resolves to a real node (no dangling references), every node is reachable from the trigger, and node types match n8n's real core catalog. **Do a real `Import from File` in your n8n instance and review both workflows in the editor before activating** — same validation step you're already doing for Docker Compose.

## Next phase candidates (not started)

- Wire real PriceLabs credentials once available
- Verify and implement Hostify's price-write endpoint
- Microsoft Graph adapter (Excel/Outlook/SharePoint) — blocked on Azure App Registration
- Reservation sync + additional workflows (dashboard refresh, monitoring, backup) beyond the pricing job
- Dashboard: surface persisted history and require login (currently unauthenticated — Phase 3 added API auth but the Next.js dashboard itself doesn't yet have a login screen)

## Phase 5 (new: dashboard login, fixing a real Phase 3 regression)

**Context**: Phase 3 added `authenticate`/`authorize` middleware to `/properties` and `/pricing/*` on the API, but the Next.js dashboard was still calling those endpoints with no auth headers — meaning the dashboard silently broke (started getting 401s) the moment Phase 3 shipped. This phase fixes that.

- `apps/web/lib/session.ts` — httpOnly-cookie session handling: `setSessionCookies`/`clearSessionCookies`/`readSessionCookies`, a display-only (not authorization-relevant) JWT payload decoder, and `fetchWithAuth()` — calls the API with the access-token cookie, and on a 401 transparently exchanges the refresh-token cookie for a new pair via `/auth/refresh`, updates the cookies, and retries once before giving up.
- `apps/web/pages/api/session/login.ts` / `logout.ts` — Next.js API routes that proxy to the backend `/auth/login` / `/auth/logout` and set/clear httpOnly cookies server-side. The browser never sees the raw tokens in JS-accessible storage — deliberately not using `localStorage`, which is straightforwardly readable by any script on the page (XSS-exposed) and is the wrong place for auth tokens in a real deployment.
- `apps/web/pages/login.tsx` — login form.
- `apps/web/pages/index.tsx` — now redirects to `/login` if there's no session cookie or if the session turns out to be unrecoverable (refresh also failed), and shows the logged-in user's email/role with a logout button.

**A real dependency bug caught during this phase**: the `cookie` npm package's latest major version (2.0.1) turned out to be a ground-up rewrite that renamed every export (`parse`/`serialize` → `parseCookie`/`stringifySetCookie`), which broke the build immediately (`Module has no exported member 'serialize'`). Rather than pin to an older major and inherit that same fragility later, cookie serialization for our fixed, small set of attributes was written directly (~30 lines, no dependency) — removed from `package.json` entirely.

**Tests**: `apps/web` now has its own test suite (11 tests) covering cookie read/write, the display-only JWT decoder, and — most importantly — the refresh-on-401 retry logic with mocked `fetch` (verifies: no refresh attempted on success, refresh-and-retry on 401, cookies updated after refresh, and the three distinct failure modes: no access token, no refresh token, refresh call itself fails).

**Real end-to-end verification** (not just unit tests): ran the actual API + web servers together and drove the full flow over HTTP — unauthenticated dashboard visit correctly 307-redirects to `/login`; wrong password gets a generic 401; correct login sets real httpOnly cookies with a real JWT and real refresh token; the authenticated dashboard visit renders real data and shows the correct logged-in identity; logout clears the session and the next dashboard visit redirects to `/login` again.

## Phase 6 (new: real dashboard — property list + detail + audit history)

The dashboard previously only ever showed one hardcoded property (`DEFAULT_PROPERTY_ID`). Now:

- `/` — lists every synced property (name, address, beds/baths, base price), each linking to its detail page.
- `/properties/[id]` — live 7-day pricing recommendations (existing table) **plus** the full persisted audit history for that property (every recommendation ever computed for each date, not just the latest) via `GET /pricing/:id/history`.
- `components/Layout.tsx` — shared header (viewer identity + logout) extracted so it's consistent across pages instead of duplicated.

**Verified for real**: synced 2 mock properties, loaded the list page (confirmed both linked correctly), loaded the detail page twice in succession, and confirmed the history table showed exactly 2 rows for the same date after 2 loads — proving the append-only audit trail actually accumulates across real page visits, not just in unit tests.

## Phase 7 (new: reservation sync in the scheduled job + CI)

- `workflows/n8n/xlnc-daily-pricing-sync.json` — now also syncs each property's reservations (next 30 days) before computing pricing, via a new `Sync Reservations` node. Set to `neverError` so one property's reservation-sync failure doesn't abort the run for the rest — check `sync_runs` / `GET /sync/runs` for per-property failures.
- `.github/workflows/ci.yml` — real CI: installs, audits dependencies (fails the build on high/critical vulnerabilities), builds every workspace, spins up a genuine Postgres 16 service container, applies migrations via the actual migration CLI, runs the complete test suite (unit + real-Postgres integration tests, same as this whole project has been validated against throughout), and separately re-runs the migration CLI to assert it applies nothing new the second time (idempotency, enforced in CI, not just asserted in a README).

**Honest limitation**: this CI YAML has valid syntax (verified with a real YAML parser) and was hand-checked against GitHub Actions' actual schema, but I could not run `actionlint` against it — GitHub's API was rate-limited from this sandbox's shared egress IP when I tried to fetch it. Push this and watch the first real run before trusting it fully, same caution as the n8n import.

## What's genuinely still blocked (not a gap in effort — needs your input)

- **PriceLabs**: no account/API key exists. The live adapter is written against their public docs but unverified. Nothing further can be done here without you setting up a PriceLabs account.
- **Microsoft Graph** (Excel/Outlook/SharePoint): needs an Azure AD App Registration on your tenant, which you said you're handling separately.
- **Hostify price-write endpoint**: deliberately left unimplemented — writing a wrong price to a live Hostify listing is a real-money mistake, and the payload shape needs verification against an actual Hostify sandbox response, not a guess from docs alone.

## Remaining candidates (lower priority / not blocked, just not yet done)

- Pagination/filtering on the property list once there are more than a couple dozen properties (currently loads all 25 in one call — fine at this scale, will need adjusting before it doesn't)
- Kubernetes manifests (deliberately deferred per the corrected spec — VPS/Compose is the real target; K8s is a documented future path only)
- Prometheus/Grafana monitoring, backup workflow, additional AI agents from the original spec's full scope
