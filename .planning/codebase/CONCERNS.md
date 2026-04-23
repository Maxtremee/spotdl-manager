# Codebase Concerns

**Analysis Date:** 2026-04-23

## Tech Debt

**Duplicate Discord webhook implementations:**
- Issue: Two complete, parallel implementations of the Discord webhook integration exist with overlapping responsibilities.
- Files:
  - `src/modules/server/webhooks/service.ts` (`sendDiscordWebhook`, `WebhookMessageFormatter`) — functional style
  - `src/modules/server/webhooks/handler.ts` (`registerDiscordWebhookHandler`) — wired in via `server/plugins/events.ts:55`
  - `src/modules/server/webhooks/discord-webhook-service.ts` (`DiscordWebhookService` class, `getDiscordWebhookService`) — never imported anywhere
- Impact: Confusing dual API, bugs fixed in one may not propagate; bloats bundle; new contributors can't tell which is canonical.
- Fix approach: Delete `discord-webhook-service.ts` and its singleton OR replace `service.ts` + `handler.ts` with the class. `src/modules/server/webhooks/index.ts:16` should stop exporting both.

**Duplicate event handler registration surface:**
- Issue: Two parallel registration APIs exist for the same event handlers.
- Files:
  - `src/modules/server/events/handlers.ts` — standalone `registerLoggingHandler`, `registerMetricsHandler`, etc. (used by `server/plugins/events.ts`)
  - `src/modules/server/events/event-handler-registry.ts` — `EventHandlerRegistry` class with the exact same handlers as methods (never instantiated in application code)
- Impact: Dead code drift; duplicate maintenance burden; newcomers can't tell which to use.
- Fix approach: Pick one API. Since `server/plugins/events.ts:30-56` uses the standalone functions, delete `event-handler-registry.ts`.

**`examples.ts` is dead code that uses `console.*`:**
- Issue: `src/modules/server/events/examples.ts` contains documentation-style example handlers (`setupWebhookNotifications`, `setupMetricsExport`, `setupAuditLog`, `setupWebSocketBroadcast`, `setupAutoRetry`) that are never called anywhere.
- Files: `src/modules/server/events/examples.ts` (entire file, 250 lines)
- Impact: Bundles dead code into the server; uses `console.log`/`console.error` instead of `Logger`; contradicts the "Logger.get" convention in CLAUDE.md.
- Fix approach: Move to `src/modules/server/events/README.md` as code fences, or delete. If kept, migrate to `Logger.get("Examples")`.

**`TODO.md` is stale roadmap:**
- Issue: `TODO.md` still lists tasks like "Design playlist schema", "Build playlist list route", "Implement delete flow with confirmation" that are already implemented.
- Files: `TODO.md`
- Impact: Misleads contributors about project state.
- Fix approach: Delete or replace with current roadmap (the README roadmap also appears stale — it lists scheduler/webhooks as future work, but they're implemented).

**Commented-out boilerplate in `server/plugins/events.ts`:**
- Issue: Example `FAILURE_WEBHOOK_URL` handler block is commented out but not removed; also contains a `console.log` inside comments.
- Files: `server/plugins/events.ts:58-69`
- Impact: Noise.
- Fix approach: Delete the comment block; Discord webhook already covers this use case.

**Unused server functions after cookies feature simplification:**
- Issue: Commit `83960c2` converted cookies to a toggle backed by `SPOTDL_COOKIES_FILE` env var, but the server still exposes `uploadCookiesFileServerFn` and `deleteCookiesFileServerFn` which persist a `cookiesFile` path to the global settings row.
- Files: `src/modules/server/spotdl/functions.ts:63-133`
- Impact: These endpoints write a `cookiesFile` field that the schema (`src/modules/server/spotdl/schema.ts:6-8`) does not recognize — any saved value will be silently dropped by `SpotdlSettingsSchema.parse()` (see the stripping note in Bugs). They're callable by any authenticated user and write arbitrary content to `data/cookies/cookies.txt`.
- Fix approach: Delete both server functions and the `cookiesDir` logic since the UI switched to env-var-based configuration. Also remove the stale `cookiesFile:` references in `SpotdlRepository.saveSettings` callers.

**Stale migration reference `0001_charming_the_hood.sql` / `0002_fine_zombie.sql` appears to have been superseded by `pnpm db:push`:**
- Issue: `package.json` uses `db:push` in `dev` and `seed` scripts (which bypasses the migration files), yet `drizzle/` contains SQL migrations. `db:migrate` is defined but never part of a build/start path.
- Files: `package.json:5,11`, `drizzle/*.sql`, `Dockerfile:62-63` (copies `drizzle/` into prod image but never applies it)
- Impact: Production image ships migrations that are never run; schema ends up being applied via `db:push` — but `db:push` is not invoked in production `pnpm start`. First production boot with a fresh volume will fail because tables don't exist.
- Fix approach: Either add `drizzle-kit migrate` to the container entrypoint (before `pnpm start`) or drop the migration files and explicitly document the `db:push` workflow.

## Known Bugs

**Production Dockerfile references a non-existent build stage:**
- Symptoms: `docker build -f Dockerfile` or `pnpm docker:prod:build` fails with `invalid from flag: stage "builder" could not be found`.
- Files: `Dockerfile:5` (declares `FROM node:22-slim` with no `AS builder`), `Dockerfile:57-59` (`COPY --from=builder ...`)
- Trigger: Any production container build.
- Workaround: None until the stage is named. Add `AS builder` to line 5: `FROM node:22-slim AS builder`.

**`docker-compose.yml` dev mount will collide with `db:push`:**
- Symptoms: On first dev-compose run, the bind mount `./data.db:/app/data.db` creates a directory (because the host file doesn't exist) and `drizzle("data/db.sqlite")` initializes the actual DB at `./data/db.sqlite` which is a different location than the stale `data.db` path in the volume spec.
- Files: `docker-compose.yml:27`, `src/modules/server/db/index.ts:12`
- Workaround: Remove the `./data.db:/app/data.db` mount line; the database lives inside `./data/db.sqlite` which is already mounted via `./data:/app/data`.

**`docker-compose.prod.yml` sets `DATABASE_URL` env var that is never read:**
- Symptoms: `DATABASE_URL=file:./local.db` in `docker-compose.prod.yml:18` has no effect. The DB path is hard-coded as `"data/db.sqlite"`.
- Files: `docker-compose.prod.yml:14-18`, `src/modules/server/db/index.ts:12`
- Trigger: Users following the README `docker run` example assume they can configure the DB path via env.
- Workaround: Document that the DB lives in `/app/data/db.sqlite`; remove the misleading env var from compose and README.

**Cookies settings repository silently strips the `cookiesFile` field:**
- Symptoms: Calling `uploadCookiesFileServerFn` persists `{ useCookies: ?, cookiesFile: "..." }`, but `SpotdlSettingsSchema.parse()` will drop `cookiesFile` (not in schema). Reading settings back always returns `{ useCookies }` only.
- Files: `src/modules/server/spotdl/repository.ts:45`, `src/modules/server/spotdl/schema.ts:6-8`, `src/modules/server/spotdl/functions.ts:76,102,119`
- Trigger: Any call to `uploadCookiesFileServerFn` or `deleteCookiesFileServerFn`.
- Workaround: These endpoints are no longer wired into the UI; the issue is latent. Fix by deleting the endpoints (see Tech Debt above).

**`scheduleMinutes` field is nullable in DB but mapper produces default 1440:**
- Symptoms: If `scheduleType === "cron"`, `scheduleMinutes` is inserted as `null`, but `rowToPlaylist` defaults it to `1440` anyway when reading cron rows, which is inert (cron branch wins). Inconsistency, not a visible bug.
- Files: `src/modules/server/db/schema.ts:41`, `src/modules/client/playlist/utils/mapper.ts:33`

**`buildArgs` produces invalid flag in sync mode:**
- Symptoms: When re-syncing an existing playlist, `SpotdlInvocator.buildArgs` still appends `--output req.outputDir` and optional `--output-format`. But `spotdl sync <sync-file>` is meant to read output from the sync file. Passing `--output` here can cause spotdl to ignore sync metadata or relocate files unexpectedly.
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:108,118` (both paths push `--output`)
- Trigger: Any scheduled/manual sync after the initial download.
- Fix approach: Only pass `--output` when the sync file doesn't yet exist (i.e., initial creation path). Verify against spotdl docs.

**Format flag mismatch between initial create and subsequent sync:**
- Symptoms: `createSyncFile` uses `--format` (`SpotdlInvocator.ts:188`) while `buildArgs` uses `--output-format` (`SpotdlInvocator.ts:118`). spotdl's actual flag is `--output-format`; `--format` is not a valid spotdl option.
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:188`
- Trigger: Initial sync-file creation for a new playlist with a non-default format.
- Fix approach: Use `--output-format` consistently.

**`createSyncFile` swallows spawn errors:**
- Symptoms: If spotdl fails or the binary is missing while creating the sync file, `createSyncFile` returns the would-be path anyway because it only awaits `once(child, "close")` with no exit-code check, no stderr capture, no error propagation.
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:194-200`
- Trigger: First sync of any playlist when spotdl misconfigured.
- Impact: The subsequent `run()` then tries to use a non-existent sync file.
- Fix approach: Check `child.exitCode`, capture stderr, throw on non-zero exit or when the sync file is not created.

**Manual trigger returns success before work has started:**
- Symptoms: `triggerManualSync` calls `executePlaylistSync(playlist)` without awaiting and returns `"triggered"`. If `executePlaylistSync` throws synchronously (e.g., early config issue), the promise is unhandled and the UI shows "Sync started successfully" regardless.
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:386-391`
- Trigger: Any manual sync while the spotdl binary is missing or settings invalid.
- Fix approach: Wrap `this.executePlaylistSync(playlist)` in `.catch(...)` at minimum, or create the invocation row synchronously before returning so the UI can navigate to a real invocation id.

**`triggerManualSync` returns string `"triggered"` but its type is `Promise<string | null>`:**
- Symptoms: `functions.ts:355` checks `if (!result)` to detect failure, but the only non-null return is the string `"triggered"` — the actual invocation ID is never returned despite the comment.
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:376-392`, `src/modules/server/playlist/functions.ts:355-362`
- Impact: UI can't deep-link to the newly started invocation.
- Fix approach: Create the invocation row inside `triggerManualSync` (before returning) and return the real invocation id.

**Playlist lifecycle events declared but never emitted:**
- Symptoms: `playlist.created`, `playlist.updated`, `playlist.deleted`, and `scheduler.reload` event schemas exist and have subscribers registered in `handlers.ts:122-140`, but no code ever calls `eventBus.emit({ type: "playlist.created", ... })` etc.
- Files: `src/modules/server/events/schema.ts:73-113`, `src/modules/server/events/handlers.ts:122-140`, `src/modules/server/playlist/functions.ts:45-191`
- Trigger: Creating or updating a playlist does not reload the scheduler, so newly-created active scheduled playlists won't start syncing until the next server restart. Only `deletePlaylistServerFn` directly calls `scheduler.reload()` (`functions.ts:94`).
- Fix approach: Either (a) remove the unused event declarations and keep direct reload calls, or (b) emit the events from `createPlaylistServerFn`/`updatePlaylistServerFn` and remove the direct reload call from delete.

**`updatePlaylistServerFn` does not reload the scheduler:**
- Symptoms: Changing a playlist's schedule (interval/cron) via the UI doesn't take effect until restart.
- Files: `src/modules/server/playlist/functions.ts:144-191`
- Impact: Users think their schedule change applied but the scheduler is still running the old cron.
- Fix approach: Call `getScheduler().reload()` after successful update, or emit `playlist.updated` and wire the handler.

## Security Considerations

**spotdl CLI arguments accept unvalidated `extraArgs` array:**
- Risk: `RunRequestSchema.flags.extraArgs` is `z.array(z.string())` with no content validation. Although `child_process.spawn` (not `exec`) is used, which avoids shell-injection, a user can still pass arbitrary spotdl flags, including destructive ones (`--overwrite`, `--output /etc`, or undocumented flags that write to arbitrary paths).
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:19,127,191`
- Current mitigation: `spawn` prevents shell interpretation. The UI does not expose `extraArgs` directly.
- Recommendations: Either remove `extraArgs` entirely or whitelist allowed flags. If kept, reject values starting with `--output`, `--cookie-file`, `--save-file`, etc., and anything containing path-traversal tokens (`..`, `/etc`, `/root`).

**`outputDir` is not path-validated; traversal to host paths possible:**
- Risk: `PlaylistSchema.outputDir` is `z.string().min(1)` with no path sanitization. A playlist can be created with `outputDir: "/etc"` or `"../../root"`. `spotdl` will then write files outside the intended download volume. In Docker, breaking out of `/app/data` is still possible via `/tmp`, `/var/log`, etc., within the container filesystem.
- Files: `src/modules/client/playlist/schema/playlist.ts:88-91`, `src/modules/client/playlist/schema/create-playlist-form.ts:35-46` (refine only checks `.length > 0`)
- Current mitigation: The container runs as non-root `node` user which limits write destinations.
- Recommendations: Constrain `outputDir` to paths under a configured root (e.g., `/app/data/downloads`). Reject `..` segments after normalization and reject absolute paths outside the allowlist.

**`sourceUrl` accepts any URL at the server boundary:**
- Risk: `RunRequestSchema.sourceUrl` is `z.url()` (any URL). While the create-form UI restricts input to Spotify hostnames (`create-playlist-form.ts:17-33`), the server-side `createPlaylistServerFn` and `updatePlaylistServerFn` accept the same permissive `PlaylistSchema` that only validates `z.string().url()`. An attacker calling the server fn directly can persist e.g. `javascript:` or non-Spotify URLs. spotdl will still be invoked against whatever URL is stored.
- Files: `src/modules/client/playlist/schema/playlist.ts:8-20`, `src/modules/server/playlist/functions.ts:35-39`
- Current mitigation: None server-side.
- Recommendations: Move the Spotify hostname/path refinement from `create-playlist-form.ts` into `PlaylistSourceSchema`.

**No authentication / authorization anywhere:**
- Risk: Every server function is reachable by any client. Webhook URL, cookie settings, playlist CRUD, manual sync trigger — all unprotected.
- Files: all `src/modules/server/*/functions.ts`
- Current mitigation: README states the app is "self-hosted" and assumes a trusted network.
- Recommendations: Document this explicitly, or add a basic-auth/middleware gate. If exposed to the internet without a reverse proxy requiring auth, anyone can enumerate and trigger spotdl runs against arbitrary URLs.

**Cookies file content is trusted verbatim:**
- Risk: The now-unused `uploadCookiesFileServerFn` writes user-supplied content to `data/cookies/cookies.txt` with `z.string().min(1)` validation only — arbitrary text including huge payloads or non-cookie content is accepted.
- Files: `src/modules/server/spotdl/functions.ts:56-91`
- Current mitigation: Endpoint appears orphaned (UI uses env var instead).
- Recommendations: Delete the endpoint (see Tech Debt). If preserved, validate Netscape cookie format and cap size.

**Webhook test endpoint can be used as an open HTTP POST relay:**
- Risk: `testWebhookServerFn` accepts any URL and sends `{"content": "🧪 Test message from spotdl-manager"}` to it. Without auth, an unauthenticated attacker can cause the server to send arbitrary POSTs to internal services (SSRF on localhost/metadata endpoints like `http://169.254.169.254/...`).
- Files: `src/modules/server/webhooks/functions.ts:53-84`
- Current mitigation: Body content is fixed, but the victim URL is attacker-controlled.
- Recommendations: Restrict to Discord webhook hostnames (`https://discord.com/api/webhooks/*`, `https://discordapp.com/*`) or to the configured URL from settings only; block private/loopback/metadata IPs.

**Secrets (webhook URLs, cookie file contents) stored unencrypted in SQLite:**
- Risk: `global_settings` table holds the Discord webhook URL as plain text. Any DB read-access reveals it.
- Files: `src/modules/server/webhooks/repository.ts`, `data/db.sqlite`
- Current mitigation: SQLite file permissions on the host volume.
- Recommendations: Document this; consider reading webhook URL from env instead of DB for production deployments.

## Performance Bottlenecks

**Long-running sync blocks scheduler's single-process event loop:**
- Problem: Each sync spawns a child process and streams output into memory via `stdoutBuf += text` until completion. Large playlists produce megabytes of stdout; `stdoutBuf` is retained for the whole run and only sliced to last 10 lines at the end.
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:242,248,284`
- Cause: Accumulating unbounded stdout in memory even though it's also written to disk.
- Improvement path: Don't buffer stdout in memory at all — re-read the last N lines from the log file at the end, or keep a rolling tail of last 10 lines only (line-based, not full-string concatenation).

**Sync jobs are written to disk with no max-log-size enforcement:**
- Problem: A runaway spotdl process could fill the `/data/logs` volume with gigabytes of text.
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:224-263`
- Cause: No size cap or rotation.
- Improvement path: Cap log file size (truncate after N MB); the existing `registerLogCleanupHandler` only deletes old runs by count (>5), not size.

**Log polling via HTTP every 2s for running invocations:**
- Problem: `library_.$playlistId_.logs_.$logId.tsx:94` polls `getInvocationLogServerFn` every 2 seconds, which re-reads the entire log file on each request.
- Files: `src/routes/library_.$playlistId_.logs_.$logId.tsx:94`, `src/modules/server/playlist/functions.ts:256-310` (uses `fs.readFile` — reads whole file)
- Cause: No byte-offset streaming; full file re-read each poll.
- Improvement path: Return only bytes past a client-supplied offset, or use SSE/WebSockets for tail streaming.

**`getSummary` runs two duplicate queries per status page load:**
- Problem: `getStatusSummaryServerFn` calls `getSummary({since})` and `getSummary({})` — each executes two queries (counts + avg duration). That's 4 aggregation queries plus the `listRecent` query plus the `getPlaylistNames` query on every status page render.
- Files: `src/modules/server/invocation/functions.ts:36-53`, `src/modules/server/invocation/repository.ts:208-243`
- Cause: Separate window-scoped and all-time summaries.
- Improvement path: Combine into one SQL query returning both windowed and all-time aggregates.

**`avgDurationMs` SQL expression is dialect-fragile:**
- Problem: `sql<number>\`avg( ( ${schema.invocations.finishedAt} - ${schema.invocations.startedAt} ) * 1000 )\`` assumes timestamps are unix seconds; Drizzle stores them as unix seconds but the arithmetic assumes that. Also, no `ROUND` / `COALESCE`.
- Files: `src/modules/server/invocation/repository.ts:230-236`
- Improvement path: Use JS-side aggregation on selected rows for correctness, or document the timestamp-seconds assumption.

## Fragile Areas

**`data/` directory path hard-coded to `process.cwd()`:**
- Files: `src/modules/server/spotdl/SpotdlInvocator.ts:60,62`, `src/modules/server/spotdl/functions.ts:67`, `src/modules/server/db/index.ts:12`
- Why fragile: If the Nitro server is started from a different cwd than the project root, the DB and logs end up in the wrong place. Changing cwd in production will silently create a new empty DB.
- Safe modification: Introduce a `DATA_DIR` env var (validated in `src/env.ts`) and derive all paths from it. Update `Dockerfile` to set `WORKDIR` and `DATA_DIR` consistently.
- Test coverage: `SpotdlInvocator.test.ts` injects `logsDir`/`syncDir` via options, but no integration test verifies production path resolution.

**Seed script writes logs to `process.cwd()/logs`, not `data/logs`:**
- Files: `src/modules/server/db/seed.ts:87`
- Why fragile: Seeded invocations reference `logs/seed-playlist-daily-sample.txt`, but `SpotdlInvocator` writes real logs to `data/logs/`. The log-viewer route reads the exact `logPath` stored, so seeded logs work, but the directory layout is inconsistent.
- Safe modification: Change `seed.ts:87` to `path.join(process.cwd(), "data", "logs")`.

**Scheduler singleton + Nitro plugin double-initialization guards:**
- Files: `server/plugins/scheduler.ts:5,18`, `server/plugins/events.ts:13,20`
- Why fragile: Both plugins track `initialized` via a module-level `let`. Under Vite HMR or multiple Nitro worker imports, this can still double-register. The scheduler's `.initialize()` also happens async without awaiting in the plugin (`scheduler.ts:20-25`), so routes can fire before the scheduler is ready.
- Safe modification: Use Nitro's `nitroApp.hooks` for a single well-defined startup lifecycle; await initialization before server ready.
- Test coverage: `PlaylistScheduler.test.ts` tests the class in isolation; plugin wiring is untested.

**Scheduler uses singleton but `new SpotdlInvocator()` is replaced at runtime:**
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:19,37,328-329`
- Why fragile: `loadSpotdlSettings` mutates `this.invocator` — if a sync is in-flight via the old invocator reference at the moment settings change, no in-memory cancel happens. Race is benign for cookies but non-obvious.
- Safe modification: Capture `this.invocator` into a local inside `executePlaylistSync` so each run uses a stable reference.

**`executePlaylistSync` awaits `createPromise` after the child process has run:**
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:122,140`
- Why fragile: The invocation row is created in parallel with the spotdl run. If `create` fails (e.g., FK violation, DB locked), the spotdl run has already executed and completed — its log and output exist on disk but no DB row tracks them. The error branch on line 207-217 then tries to `update()` a row that was never created.
- Safe modification: `await` row creation before kicking off spotdl, or make the failure branch `upsert` via `create` when the initial create failed.

**SSR hydration of log polling uses loader data as initial value:**
- Files: `src/routes/library_.$playlistId_.logs_.$logId.tsx:32-43`
- Why fragile: Initial signals read `data().logResult.data?.content` at SSR time, then `onMount` begins polling. If the loader succeeds but returns `{success: false}`, `content` is `""` but `error` is set; the UI state transitions are inconsistent between SSR and hydration.
- Safe modification: Normalize to a single `LogState` union (loading/running/completed/error) computed from loader data.

**`scheduler.reload()` is called synchronously in delete handler without awaiting completion before DB insert events:**
- Files: `src/modules/server/playlist/functions.ts:92-94`
- Why fragile: If reload itself throws (e.g., cron parser error from a sibling playlist), the delete succeeds but the error is swallowed by the outer try/catch returning `{success: false, ...}` — confusing UX ("delete failed" even though the row is gone).
- Safe modification: Wrap reload in its own try/catch so delete success is reported independently.

**`await createPromise.catch(() => {});` swallows create errors:**
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:207-208`
- Why fragile: If the row create failed, the subsequent `invocationRepository.update(invocationId, ...)` will update zero rows and silently no-op.
- Safe modification: Explicitly create-or-update (upsert) in the error branch.

**`useRouter().invalidate()` used after mutations instead of TanStack Query / Router invalidation keys:**
- Files: `src/modules/client/settings/components/cookies-settings-form.tsx:38`, `src/modules/client/settings/components/webhook-settings-form.tsx:57`
- Why fragile: Invalidates the whole router, re-triggering every loader. Fine now but brittle as routes grow.
- Safe modification: Invalidate only the `/settings` route.

## Scaling Limits

**Single-process scheduler, no worker isolation:**
- Current capacity: All sync jobs run in the same Node process as the SSR server.
- Limit: Any spotdl-caused memory spike or hang blocks request handling. A 30-minute sync keeps the invocation row in "running" state with no way to cancel.
- Scaling path: Offload sync jobs to a child worker process or separate container. At minimum, add a per-job timeout that kills the spotdl child.

**Concurrent sync cap is "one per playlist" but no global cap:**
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:20,86-92`
- Current capacity: `runningPlaylists` set prevents same-playlist concurrent runs; no limit on cross-playlist concurrency.
- Limit: If 20 cron jobs fire at the same minute, 20 spotdl processes spawn simultaneously, each running ffmpeg and hitting network. CPU/network saturation on modest hosts.
- Scaling path: Add a global concurrency semaphore (e.g., `p-limit`), default to 2-3 parallel syncs, make configurable.

**SQLite + `better-sqlite3` synchronous driver:**
- Current capacity: Fine for single-user self-hosted scenarios.
- Limit: All DB calls in Node are synchronous; under load, they block the event loop. High invocation-log rates (if added) could degrade responsiveness.
- Scaling path: None needed for design scope, but document the assumption.

## Dependencies at Risk

**`nitro: "latest"` unpinned:**
- Risk: `package.json:48` pins Nitro to `"latest"` — any upstream breaking change will be pulled on next `pnpm install`.
- Impact: CI suddenly breaks; production build from a fresh lockfile may differ from dev.
- Migration plan: Pin to a specific version matching the one in `pnpm-lock.yaml`.

**TanStack Solid Start v1.149 is pre-1.0 stability territory:**
- Risk: Major-version breaking changes between minor releases documented historically.
- Impact: Planned upgrades are manual and potentially high-effort.
- Migration plan: Track release notes; lock major version.

**`zod@4.3.5` with `@t3-oss/env-core@0.13.10`:**
- Risk: `@t3-oss/env-core` officially supports Zod 3.x; Zod 4 is accepted but some validators (`z.url()` vs `z.string().url()`) have diverged. `src/env.ts:6` uses `z.url()` which is Zod 4 syntax.
- Impact: Potential validator mismatches; env-core error messages may look odd.
- Migration plan: Verify compatibility is declared, or downgrade to Zod 3 if env validation breaks.

## Missing Critical Features

**No way to cancel a running sync:**
- Problem: `PlaylistScheduler` has no API to kill an in-flight `child_process`. Status `canceled` exists in the schema but only the scheduler's own canceled-event branch handles it (dead code path).
- Blocks: Users can't stop a stuck/long spotdl process from the UI.

**No timeout on spotdl child process:**
- Problem: `spawn` has no timeout; a network-stalled spotdl run will stay "running" forever.
- Blocks: UI shows perpetual "running" status; scheduler's `runningPlaylists` set never releases that playlist's slot.

**Retries flag is persisted but ignored:**
- Files: `src/modules/client/playlist/schema/playlist.ts:27-33`, `src/modules/server/db/schema.ts:20`, `src/modules/server/scheduler/PlaylistScheduler.ts:130-138`
- Problem: `flagsRetries` is collected from the UI and stored but never passed to `SpotdlInvocator.run()` or translated to `--max-retries`.
- Blocks: Users configure retries thinking they take effect; they don't.

**Quality flag is persisted but ignored:**
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:130-138`
- Problem: `playlist.flagsQuality` is not passed to `invocator.run`. `RunRequestSchema.flags.quality` exists but `SpotdlInvocator.buildArgs` never maps it to a CLI flag.
- Blocks: Quality setting is UI-only; all downloads use spotdl's default quality.

**Scheduler init doesn't validate cron expressions before registering:**
- Files: `src/modules/server/scheduler/PlaylistScheduler.ts:261-285`
- Problem: Catches `new Cron(...)` errors but continues initialization. Validation lives in the Zod form schema, not the server, so a playlist with a malformed cron can exist in DB if created via API.
- Blocks: A single corrupt row doesn't stop the scheduler, but there's no surfacing to the user.

## Test Coverage Gaps

**No integration tests covering the SSR + scheduler + spotdl flow:**
- What's not tested: `server/plugins/scheduler.ts`, `server/plugins/events.ts`, the Nitro startup lifecycle, cross-module event flow (create playlist → event → scheduler reload).
- Files: Absent — only unit tests exist (`SpotdlInvocator.test.ts`, `PlaylistScheduler.test.ts`, `EventBus.test.ts`, `playlist.test.ts`).
- Risk: Wiring bugs like "update playlist doesn't reload scheduler" aren't caught.
- Priority: High.

**Cookies feature has no tests:**
- What's not tested: `src/modules/server/spotdl/schema.ts`, `src/modules/server/spotdl/repository.ts`, `src/modules/server/spotdl/functions.ts`, the cookies toggle UI.
- Files: None exist.
- Risk: The `cookiesFile` schema-stripping bug (see Bugs) is invisible.
- Priority: Medium — the feature is new (commit `83960c2`).

**Webhook service has no tests:**
- What's not tested: `src/modules/server/webhooks/**` (service, handler, repository, Discord formatting, retry/backoff logic).
- Files: None exist.
- Risk: Retry logic for 429/5xx and the client-error bail-out are untested.
- Priority: Medium.

**`InvocationRepository` has no tests:**
- What's not tested: Pagination bounds (page=0, limit=200), `getSummary` SQL expression, status filtering.
- Files: None exist for `src/modules/server/invocation/repository.ts`.
- Risk: Silent regression in status dashboard metrics.
- Priority: Medium.

**Path-traversal / `outputDir` validation is untested:**
- What's not tested: Whether invalid `outputDir` values are rejected server-side.
- Files: `src/modules/client/playlist/schema/playlist.ts`.
- Risk: Security-adjacent (see Security Considerations).
- Priority: High when auth/authZ is added; medium otherwise.

**SSR hydration of log-viewer polling untested:**
- What's not tested: Initial state when loader returns `{success: false}`, auto-scroll behavior, poll cleanup on status transition.
- Files: `src/routes/library_.$playlistId_.logs_.$logId.tsx`.
- Priority: Low.

---

*Concerns audit: 2026-04-23*
