# External Integrations

**Analysis Date:** 2026-04-23

## APIs & External Services

**Music / Download CLI:**
- `spotdl` (Python CLI) - Core integration; downloads and syncs Spotify playlists/albums/tracks
  - Invocation: `node:child_process.spawn` in `src/modules/server/spotdl/SpotdlInvocator.ts` (binary defaults to `"spotdl"` on PATH, overridable via `SpotdlInvocatorOptions.binaryPath`)
  - Commands used: `spotdl sync <url> --save-file <path>` (initial), `spotdl sync <sync-file>` (subsequent runs)
  - CLI flags mapped: `--output`, `--cookie-file`, `--output-format`/`--format`, `--overwrite`, `--sync-without-deleting`, plus pass-through `extraArgs[]`
  - Sync files persisted to `data/sync/<playlistId>.spotdl` (see `getSyncFilePath` in `SpotdlInvocator.ts`)
  - Run logs streamed to `data/logs/<playlistId>-<timestamp>.txt` (see `getLogPath`)
  - Cookie support: enabled via global setting `spotdl.useCookies` (see `src/modules/server/spotdl/schema.ts`); cookies file path supplied by `SPOTDL_COOKIES_FILE` env var; uploaded via `uploadCookiesFileServerFn` in `src/modules/server/spotdl/functions.ts` (written to `data/cookies/cookies.txt`)
  - System dependency: `ffmpeg` (installed in both `Dockerfile` and `Dockerfile.dev`)

**Discord (outgoing webhook):**
- Discord incoming webhook endpoint - Notifies on sync lifecycle events
  - Implementation: `src/modules/server/webhooks/service.ts` (`sendDiscordWebhook`) and `src/modules/server/webhooks/discord-webhook-service.ts` (class-based alternative)
  - Handler registration: `src/modules/server/webhooks/handler.ts` (`registerDiscordWebhookHandler`) wired in `server/plugins/events.ts`
  - Transport: `fetch` POST with `Content-Type: application/json`, body `{ content: string }`
  - Retry policy: up to 2 retries; honors HTTP 429 `Retry-After`; retries on 5xx; no retry on 4xx (other than 429)
  - URL + enabled events stored in DB (`global_settings` key `discord_webhook`) via `WebhookRepository` (`src/modules/server/webhooks/repository.ts`); schema in `src/modules/server/webhooks/schema.ts`
  - Supported events: `playlist.sync.started`, `playlist.sync.completed`, `playlist.sync.failed` (see `WebhookEventTypes`)
  - Server functions: `getWebhookSettingsServerFn`, `updateWebhookSettingsServerFn`, `testWebhookServerFn` (exported from `src/modules/server/webhooks/index.ts`)

## Data Storage

**Databases:**
- SQLite (via `better-sqlite3` 12.6.0)
  - ORM: Drizzle (`drizzle-orm` 0.45.1), initialized in `src/modules/server/db/index.ts` with singleton `getDb()`
  - File path: `data/db.sqlite` (hard-coded in `getDb` and `drizzle.config.ts`)
  - Schema: `src/modules/server/db/schema.ts` — tables `playlists`, `invocations`, `global_settings`
  - Migrations: `drizzle/0000_lonely_justin_hammer.sql`, `drizzle/0001_charming_the_hood.sql`, `drizzle/0002_fine_zombie.sql`; applied via `pnpm db:push`
  - Seed: `src/modules/server/db/seed.ts` (runs with `tsx --env-file=.env`)

**File Storage:**
- Local filesystem under `./data/` (mounted as Docker volume in `docker-compose.yml` / `docker-compose.prod.yml`)
  - `data/db.sqlite` - SQLite database file
  - `data/logs/` - Per-invocation spotdl run logs (see `SpotdlInvocator.getLogPath`)
  - `data/sync/` - Spotdl sync files (`<playlistId>.spotdl`)
  - `data/cookies/cookies.txt` - Uploaded cookies file (when cookies feature used; see `uploadCookiesFileServerFn`)
  - Music output directories configured per playlist via `playlists.output_dir`

**Caching:**
- None detected (no Redis/Memcached/etc.); in-process state only:
  - Scheduler task registry (`tasks: Map<string, Cron>`) and running set in `src/modules/server/scheduler/PlaylistScheduler.ts`
  - Metrics counters inside `registerMetricsHandler` (`src/modules/server/events/handlers.ts`)

## Authentication & Identity

**Auth Provider:**
- None - The application does not implement user authentication. It is a single-tenant local/self-hosted tool.
- No login, session, JWT, OAuth, or password handling code found in `src/`
- Only external auth artifact: `spotdl` cookies file (for quality tier), stored as a file at `data/cookies/cookies.txt` referenced by env `SPOTDL_COOKIES_FILE`

## Monitoring & Observability

**Error Tracking:**
- None (no Sentry/Bugsnag/Rollbar integrations). Errors flow through the Pino logger.

**Logs:**
- Pino logger singleton in `src/logger.ts` (`Logger.get("ModuleName")`)
  - Dev: pretty-printed via `pino-pretty` with colors and `SYS:yyyy-mm-dd HH:MM:ss.l` timestamps (level defaults to `debug`)
  - Prod: JSON output (no stream configured; `level` defaults to `info`)
  - Level override: `LOG_LEVEL` env var
- Per-invocation spotdl logs streamed to files in `data/logs/` with header/footer metadata (`SpotdlInvocator.run`)
- Event bus logging handler registered only when `NODE_ENV !== "production"` (`server/plugins/events.ts`)
- Health check in Docker: `node -e "require('http').get('http://localhost:3000', ...)"` every 30s

**Metrics:**
- In-process counters via `registerMetricsHandler` in `src/modules/server/events/handlers.ts` (totalSyncs, successfulSyncs, failedSyncs, avg duration). Logged through Pino - no external metrics sink.

## Event System (Internal Pub/Sub)

**Event Bus:**
- Singleton in `src/modules/server/events/EventBus.ts` (`getEventBus()` / `EventBus.getInstance()`)
- Type-safe pub/sub with handlers scoped by `EventType` plus global `onAny` handlers
- Enriches events with `id` (UUID) and `timestamp` on emit; awaits `Promise.allSettled` on all handlers
- Handler errors swallowed and logged via `console.error` inside `safeInvoke`

**Event Schema (`src/modules/server/events/schema.ts`):**
- Zod discriminated union on `type`; event types:
  - `playlist.sync.started` / `playlist.sync.completed` / `playlist.sync.failed` / `playlist.sync.canceled`
  - `playlist.created` / `playlist.updated` / `playlist.deleted`
  - `scheduler.reload`

**Handlers registered on server startup** (`server/plugins/events.ts`):
- `registerLoggingHandler` - only when `NODE_ENV !== "production"`
- `registerMetricsHandler` - always
- `registerSchedulerReloadHandler` - triggers `PlaylistScheduler.reload()` on playlist CRUD and explicit reload events
- `registerSyncDurationWarningHandler(300000)` - warns on syncs > 5 min
- `registerDiscordWebhookHandler` - Discord webhook integration

**Additional exported handlers** (`src/modules/server/events/handlers.ts`) not registered by default:
- `registerFailureNotificationHandler(notifyFn)` - generic failure notifier (example commented out in plugin)
- `registerLogCleanupHandler(cleanupFn, retentionCount=5)` - rotates old log files per playlist

**Scheduler integration** (`src/modules/server/scheduler/PlaylistScheduler.ts`):
- Uses `croner` to run jobs (`new Cron(expr, async () => ...)`)
- Emits events (`playlist.sync.started/completed/failed/canceled`) around each invocation
- Initialized by Nitro plugin `server/plugins/scheduler.ts` on startup

## CI/CD & Deployment

**Hosting:**
- Self-hosted Docker container (no managed cloud platform detected)
- `Dockerfile` - production multi-stage build (builder + node:22-slim runtime, installs spotdl via pip, runs as `node` user, exposes 3000)
- `Dockerfile.dev` - development image (uses `pipx` for spotdl, mounts source for HMR)
- `docker-compose.yml` - dev compose with volume mounts for hot reload
- `docker-compose.prod.yml` - prod compose with resource limits (2 CPU / 2G memory), health check, `NITRO_PORT=3000`
- `.github/` directory present (contents not inspected here)

**CI Pipeline:**
- `.github/` directory exists; specific workflows not evaluated during this audit

## Environment Configuration

**Validated in `src/env.ts`:**
- `SERVER_URL` - optional URL (server-side base URL)
- `SPOTDL_COOKIES_FILE` - optional path to cookies file (used by `SpotdlInvocator.getCookiesFile` when `useCookies` is enabled in DB settings)
- `VITE_APP_TITLE` - optional client-side app title (client prefix `VITE_`)
- `emptyStringAsUndefined: true`

**Consumed elsewhere (not in env.ts):**
- `NODE_ENV` - gates dev-only logging handler and logger format
- `LOG_LEVEL` - overrides Pino level (`src/logger.ts`)
- `NITRO_PORT` - Nitro server port (set in `docker-compose.prod.yml`)

**Secrets location:**
- `.env` file (gitignored) - exists locally, never read by this audit
- `.env.example` - documents `SPOTDL_COOKIES_FILE` template
- No cloud secret manager (AWS Secrets Manager / Vault / etc.) integration
- Discord webhook URL is stored in DB (`global_settings.discord_webhook` JSON), not env vars

## Webhooks & Callbacks

**Incoming:**
- None. All HTTP endpoints are server functions (`createServerFn`) invoked by the SSR client; there are no public webhook receivers.

**Outgoing:**
- Discord webhook: configured URL is POSTed to on `playlist.sync.started|completed|failed` events (see `src/modules/server/webhooks/service.ts` and `src/modules/server/webhooks/handler.ts`)
- Commented-out generic failure webhook stub in `server/plugins/events.ts` (via `FAILURE_WEBHOOK_URL` env) — not active

---

*Integration audit: 2026-04-23*
