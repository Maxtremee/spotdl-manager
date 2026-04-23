# Architecture

**Analysis Date:** 2026-04-23

## Pattern Overview

**Overall:** SSR (Server-Side Rendered) single-page application built on TanStack Start with a layered, feature-module architecture. Nitro provides the server runtime; SolidJS renders on both server and client.

**Key Characteristics:**
- Strict client/server boundary via directory convention (`src/modules/client/` vs `src/modules/server/`)
- Route-driven data fetching: every route declares a `loader` that calls typed server functions
- Feature modules encapsulate schema, service, repository, functions, and components
- Repository pattern for all database access (Drizzle ORM + SQLite)
- Server functions (`createServerFn`) as the only mutation/query surface between client and server
- Event-driven cross-cutting concerns via an in-process EventBus singleton (pub/sub)
- Scheduler runs as a Nitro startup plugin managing cron-based playlist syncs
- Zod schemas are the source of truth for types at every layer

## Layers

**Presentation (Routes):**
- Purpose: Define UI routes, bind loaders, parse search params
- Location: `src/routes/`
- Contains: File-based TanStack Router route modules exporting `Route = createFileRoute(...)`
- Depends on: Server functions (`src/modules/server/*/functions.ts`), client components (`src/modules/client/**`), UI kit (`src/components/ui/`)
- Used by: `src/routeTree.gen.ts` (auto-generated)

**Client Feature Modules:**
- Purpose: Browser-safe UI components, form schemas, client-side services (formatters, helpers, row mappers)
- Location: `src/modules/client/{feature}/`
- Contains: `components/`, `schema/`, `service/`, `utils/`
- Depends on: UI kit, PandaCSS (`styled-system/`), server functions (imported but invoked over the wire)
- Used by: Routes under `src/routes/`

**Server Functions Layer:**
- Purpose: Typed RPC entry points with Zod input validation; orchestrate repository calls and emit events
- Location: `src/modules/server/{feature}/functions.ts`
- Contains: `createServerFn({ method }).inputValidator(zodSchema).handler(...)` exports
- Depends on: Repositories, schedulers, event bus, Zod schemas from the corresponding client module
- Used by: Route `loader` callbacks and client action services (`src/modules/client/*/service/*.ts`)
- Examples: `src/modules/server/playlist/functions.ts`, `src/modules/server/invocation/functions.ts`, `src/modules/server/webhooks/functions.ts`

**Repository Layer:**
- Purpose: Data access via Drizzle ORM; owns pagination/filter SQL and row transformations
- Location: `src/modules/server/{feature}/repository.ts`
- Contains: Exported `XRepository` (object literal or class) with CRUD, list, and aggregate methods
- Depends on: `src/modules/server/db` (drizzle client + schema)
- Used by: Server functions, scheduler, event handlers
- Examples: `src/modules/server/playlist/repository.ts`, `src/modules/server/invocation/repository.ts`, `src/modules/server/webhooks/repository.ts`, `src/modules/server/spotdl/repository.ts`

**Database Layer:**
- Purpose: Drizzle connection, table definitions, and seeding
- Location: `src/modules/server/db/`
- Contains: `index.ts` (getDb singleton), `schema.ts` (tables), `seed.ts`
- Depends on: `better-sqlite3`, `drizzle-orm/better-sqlite3`
- Used by: All repositories via `getDb()` and `schema`

**Orchestration (Scheduler + Invocator):**
- Purpose: Schedule playlist syncs (cron/interval), spawn the `spotdl` binary, write logs, update invocation rows, emit lifecycle events
- Location: `src/modules/server/scheduler/PlaylistScheduler.ts`, `src/modules/server/spotdl/SpotdlInvocator.ts`
- Depends on: `croner`, Node `child_process`, `InvocationRepository`, `SpotdlRepository`, EventBus
- Used by: Nitro plugin `server/plugins/scheduler.ts`, server function `triggerPlaylistSyncServerFn`

**Event Bus (Cross-Cutting):**
- Purpose: Typed pub/sub for sync lifecycle, playlist CRUD, and scheduler reload
- Location: `src/modules/server/events/`
- Contains: `EventBus.ts` (singleton), `schema.ts` (discriminated Zod union), `handlers.ts` (metrics, logging, scheduler reload, duration warnings, log cleanup), `index.ts`
- Depends on: Node `crypto` (randomUUID)
- Used by: Scheduler emits; webhook handler subscribes (`src/modules/server/webhooks/handler.ts`); Nitro plugin `server/plugins/events.ts` wires handlers

**Server Bootstrap (Nitro Plugins):**
- Purpose: Register event handlers and initialize the scheduler on server startup; cleanup on shutdown
- Location: `server/plugins/events.ts`, `server/plugins/scheduler.ts`
- Registered via: `vite.config.ts` → `nitro({ plugins: [...] })`

## Data Flow

**SSR Read Flow (e.g., list playlists):**

1. Browser requests `/library?page=1&search=foo`
2. TanStack Router matches `src/routes/library.tsx`; `validateSearch` + `loaderDeps` parse search params via Zod
3. `loader` calls `listPlaylistsServerFn({ data: {...} })` (runs on server during SSR)
4. Server function validates input with `inputValidator(zodSchema)` then calls `PlaylistRepository.listPlaylists(...)`
5. Repository builds Drizzle query (WHERE clause from `conditions: SQL[]`), executes `count` + paginated `select`, maps rows via `rowToPlaylist`
6. Response JSON is serialized into the SSR payload; client hydrates via `hydrateStart()` in `src/client.tsx`
7. Component reads data via `Route.useLoaderData()`

**Mutation Flow (e.g., delete playlist):**

1. Component invokes client action in `src/modules/client/playlist/service/playlist-actions.ts`
2. Action calls `deletePlaylistServerFn({ data: { id } })` over the wire
3. Server function validates input, calls `PlaylistRepository.deletePlaylist(id)`, then `getScheduler().reload()`
4. Toast notification fires on client via `toaster` from `src/components/ui/toast`
5. Component calls `router.invalidate()` or navigates to refetch loaders

**Scheduled Sync Flow:**

1. `server/plugins/scheduler.ts` runs on Nitro startup → `getScheduler().initialize()`
2. Scheduler loads playlists where `scheduleEnabled = true AND status = 'active'`
3. For each, it registers a `Cron` task (interval converted to cron via `intervalToCron`)
4. When the task fires, `executePlaylistSync(playlist)` runs:
   - Emits `playlist.sync.started` event
   - Creates invocation row (`InvocationRepository.create`)
   - Calls `SpotdlInvocator.run(...)` which spawns the `spotdl` CLI and streams stdout/stderr to `data/logs/<playlistId>-<ts>.txt`
   - Updates invocation row with finishedAt/exitCode/status/summary
   - Emits `playlist.sync.completed` / `playlist.sync.failed` / `playlist.sync.canceled` accordingly
5. EventBus fans out to registered handlers: logging, metrics, scheduler reload, duration warning, Discord webhook

**State Management:**
- Server state: SSR loaders via TanStack Router + `Route.useLoaderData()`; mutations via server functions; `router.invalidate()` to refresh
- Local UI state: Solid `createSignal` / `createMemo` inside components
- Forms: `@tanstack/solid-form` with Zod `onSubmit` validators (e.g., `src/routes/library_.add.tsx`)

## Key Abstractions

**Server Function (`createServerFn`):**
- Purpose: Type-safe RPC with method (GET/POST) and Zod-validated input
- Examples: `src/modules/server/playlist/functions.ts`, `src/modules/server/invocation/functions.ts`, `src/modules/server/webhooks/functions.ts`
- Pattern: `createServerFn({ method: "POST" }).inputValidator(zodSchema).handler(async ({ data }) => {...})`

**Repository:**
- Purpose: Encapsulate all Drizzle queries for a feature; translate rows to domain types
- Examples: `src/modules/server/playlist/repository.ts` (object-literal), `src/modules/server/invocation/repository.ts` (class), `src/modules/server/webhooks/repository.ts` (object-literal), `src/modules/server/spotdl/repository.ts` (class)
- Pattern: Two styles coexist — object-literal singletons and class instances. Both obtain the DB via `getDb()`.

**Row ↔ Domain Mapper:**
- Purpose: Bridge flat Drizzle row shape and nested Zod domain shape (e.g., split/merge `flags*`, `schedule*` columns)
- Examples: `src/modules/client/playlist/utils/mapper.ts` (`rowToPlaylist`, `playlistToRow`)
- Pattern: Always parse through `PlaylistSchema.parse(...)` to enforce invariants at the boundary

**Zod Schema as Contract:**
- Purpose: Shared type source across client input validation, server function validators, and DB mappers
- Examples: `src/modules/client/playlist/schema/playlist.ts`, `src/modules/client/webhooks/schema/webhook.ts`, `src/modules/server/events/schema.ts`, `src/modules/server/spotdl/schema.ts`

**EventBus (singleton pub/sub):**
- Purpose: Decouple sync lifecycle producers (scheduler) from cross-cutting consumers (metrics, webhooks, scheduler-reload)
- Location: `src/modules/server/events/EventBus.ts`
- Pattern: `EventBus.getInstance()` → `bus.on(type, handler)` / `bus.emit({ type, payload })`; handler registration returns an unsubscribe function; events are enriched with `id` (uuid) and `timestamp` on emit

**Scheduler Singleton:**
- Purpose: Own all cron tasks and running-playlist state
- Location: `src/modules/server/scheduler/PlaylistScheduler.ts`
- Pattern: Module-level `schedulerInstance` + `getScheduler(logger?)` accessor

**Logger Singleton:**
- Purpose: Pino logger with module-scoped child loggers
- Location: `src/logger.ts`
- Pattern: `Logger.get("ModuleName")` returns a child logger bound to `{ module }`; pretty stream in dev, JSON in prod; level via `LOG_LEVEL`

**SpotdlInvocator:**
- Purpose: Encapsulate spotdl CLI invocation — build args, spawn process, stream logs, handle sync files, honor cookies setting
- Location: `src/modules/server/spotdl/SpotdlInvocator.ts`
- Pattern: Class instance with constructor options (`binaryPath`, `logsDir`, `syncDir`, `useCookies`, `env`); `run(req)` returns a `RunResult`

## Entry Points

**SSR Entry (auto-generated by TanStack Start):**
- Location: TanStack Start plugin in `vite.config.ts` generates the SSR entry from the router
- Triggers: HTTP request to the Nitro-served app
- Responsibilities: Match route, run loaders, render SolidJS tree to HTML

**Client Hydration:**
- Location: `src/client.tsx`
- Triggers: Browser load of hydration script
- Responsibilities: `hydrateStart()` → subscribe to router `onBeforeLoad`/`onLoad` for nprogress → `hydrate(StartClient)` into `document`

**Router Factory:**
- Location: `src/router.tsx`
- Triggers: Called by TanStack Start on both server and client
- Responsibilities: `createRouter({ routeTree, defaultErrorComponent: GenericError, defaultNotFoundComponent: NotFound, defaultViewTransition: true, scrollRestoration: true })`

**Root Route / Shell:**
- Location: `src/routes/__root.tsx`
- Triggers: Wraps every route
- Responsibilities: `<html>` / `<head>` (HeadContent, HydrationScript), global nav (`src/components/nav.tsx`), Toaster, layout grid, Scripts

**Nitro Server Plugins (startup hooks):**
- `server/plugins/events.ts`: Registers logging/metrics/scheduler-reload/duration-warning/Discord-webhook handlers; cleans up on `close`
- `server/plugins/scheduler.ts`: Calls `scheduler.initialize()`; shuts down on `close`
- Wired in `vite.config.ts`: `nitro({ plugins: ["server/plugins/events.ts", "server/plugins/scheduler.ts"] })`

**Database Entry:**
- Location: `src/modules/server/db/index.ts`
- Triggers: First call to `getDb()` from any repository
- Responsibilities: Lazy-initialize `drizzle("data/db.sqlite", { schema })`

## Error Handling

**Strategy:** Defensive at the server-function boundary; repositories throw; server functions translate to `{ success, data | error }` discriminated results for mutations, and rethrow for loaders (so route error boundaries render).

**Patterns:**
- Mutation server functions wrap the repository call in try/catch and return `{ success: false, error: string }` (e.g., `createPlaylistServerFn`, `updatePlaylistServerFn`, `deletePlaylistServerFn`, `updateWebhookSettingsServerFn`)
- Query server functions throw on not-found (e.g., `getPlaylistByIdServerFn`) — surfaced via `Route.defaultErrorComponent = GenericError` in `src/router.tsx`
- 404 fallback: `src/components/not-found.tsx` wired as `defaultNotFoundComponent`
- Scheduler wraps each sync in try/catch/finally to always update the invocation row and clear `runningPlaylists`
- EventBus handlers are invoked via `safeInvoke` (try/catch + `console.error`); all handlers are awaited with `Promise.allSettled`
- Webhook service retries on 5xx/429 with backoff, bails on 4xx (`src/modules/server/webhooks/service.ts`)
- File reads in `getInvocationLogServerFn` tolerate `ENOENT` and return empty content

## Cross-Cutting Concerns

**Logging:**
- Pino singleton in `src/logger.ts` — always use `Logger.get("ScopeName")` in server code
- Event handlers receive injected `AppLogger` via the register functions (e.g., `registerDiscordWebhookHandler(logger)`)
- Nitro plugins create dedicated scoped loggers: `EventBusPlugin`, `EventHandlers`, `PlaylistScheduler`, `SchedulerPlugin`, `DiscordWebhook`

**Validation:**
- All user input passes through Zod: route `validateSearch` (`zodValidator`), server function `inputValidator`, form `onSubmit` validator
- Environment variables validated in `src/env.ts` via `@t3-oss/env-core` + Zod
- DB row ↔ domain conversions re-validate via `PlaylistSchema.parse(...)` in mappers

**Authentication:**
- None (app is intended for single-user local/self-hosted deployment)

**Event-Driven Integrations:**
- Playlist CRUD → `scheduler.reload` handler re-reads schedules
- Sync lifecycle → Discord webhook handler formats messages (`WebhookMessageFormatter`) and POSTs via `sendDiscordWebhook` (retries + rate-limit handling)
- Metrics + long-run warnings + log cleanup available as pre-built handlers in `src/modules/server/events/handlers.ts`

**Configuration:**
- Env vars: `SERVER_URL`, `VITE_APP_TITLE`, `SPOTDL_COOKIES_FILE`, `LOG_LEVEL`, `NODE_ENV`
- Persistent app settings: `global_settings` key/value table (keys: `spotdl`, webhook key) accessed via `SpotdlRepository` and `WebhookRepository`
- Database file: `data/db.sqlite`; logs: `data/logs/`; sync state: `data/sync/`

---

*Architecture analysis: 2026-04-23*
