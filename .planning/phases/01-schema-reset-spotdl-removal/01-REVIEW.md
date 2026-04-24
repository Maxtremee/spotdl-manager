---
phase: 01-schema-reset-spotdl-removal
reviewed: 2026-04-24T00:00:00Z
depth: standard
files_reviewed: 34
files_reviewed_list:
  - .env.example
  - Dockerfile
  - Dockerfile.dev
  - drizzle/0000_tranquil_squadron_sinister.sql
  - drizzle/meta/_journal.json
  - drizzle/meta/0000_snapshot.json
  - package.json
  - scripts/reset-db.mjs
  - src/components/ui/file-upload.tsx
  - src/env.ts
  - src/modules/client/library/components/playlist-table.tsx
  - src/modules/client/playlist/components/basic-fields-section.tsx
  - src/modules/client/playlist/components/playlist-config-card.tsx
  - src/modules/client/playlist/components/playlist-header.tsx
  - src/modules/client/playlist/schema/create-playlist-form.ts
  - src/modules/client/playlist/schema/playlist.test.ts
  - src/modules/client/playlist/schema/playlist.ts
  - src/modules/client/playlist/service/options.ts
  - src/modules/client/playlist/service/playlist-actions.ts
  - src/modules/client/playlist/service/playlist.ts
  - src/modules/client/playlist/utils/mapper.ts
  - src/modules/client/settings/index.ts
  - src/modules/server/db/schema.test.ts
  - src/modules/server/db/schema.ts
  - src/modules/server/db/seed.ts
  - src/modules/server/invocation/repository.ts
  - src/modules/server/playlist/functions.ts
  - src/modules/server/playlist/repository.ts
  - src/modules/server/scheduler/PlaylistScheduler.test.ts
  - src/modules/server/scheduler/PlaylistScheduler.ts
  - src/routes/library_.$playlistId.tsx
  - src/routes/library_.add.tsx
  - src/routes/settings.tsx
findings:
  critical: 1
  warning: 6
  info: 7
  total: 14
status: issues_found
---

# Phase 1: Code Review Report

**Reviewed:** 2026-04-24
**Depth:** standard
**Files Reviewed:** 34
**Status:** issues_found

## Summary

Phase 1 delivers the schema rename (`playlists` -> `sources`), a new `tracks` table, the spotdl module removal, a trimmed client form, a PlaylistScheduler rewritten as an event-emitting no-op, and a new `pnpm reset:db` script. The core surgical work is sound: the migration SQL matches the Drizzle snapshot, FK cascades flow correctly from `sources` -> `invocations`/`tracks`, and the scheduler stub emits a schema-valid started/completed pair with a concurrency guard.

However, there is one Critical issue that will make the production Docker image fail to build, plus several correctness and consistency gaps around the schema reset that were missed by the client strip:

- Production `Dockerfile` uses `FROM node:22-slim` without a `AS builder` alias, so the later `COPY --from=builder` directives reference a stage that does not exist. The image will fail at the first multi-stage copy step.
- The `sources` <-> `tracks` contract exposes a migration foot-gun: `tracks.position` has no uniqueness within `source_id`, so ordering is non-deterministic the moment two rows share a position. Phase 3+ rely on this.
- The client form removed spotdl-era flag fields but left visible user-facing copy in `library-info-panel.tsx` promising "edit quality and format settings" that no longer exists.
- The Zod `PlaylistSchema` and Zod `CreatePlaylistFormSchema` accept `status: "error"` but the UI `statusOptions` only lists Active/Paused/Archived, so a source in `error` status renders an empty Select value in `PlaylistConfigCard` and the user can never restore it.
- `PlaylistScheduler.triggerManualSync` fire-and-forgets `executePlaylistSync` without a `.catch(...)`, so an emit failure becomes an unhandled promise rejection after the HTTP response has returned.
- Seed script writes a log template that still says `# spotdl run seed-run-001`, reinforcing the engine that has just been removed.

No hardcoded secrets, injection vectors, or authentication issues found. Docker, env, and migration journal are otherwise clean.

## Critical Issues

### CR-01: Production Dockerfile references a missing `builder` stage

**File:** `Dockerfile:5,49-51`
**Issue:** The multi-stage build declares only `FROM node:22-slim` (no `AS builder`) at line 5, then later uses `COPY --from=builder` three times at lines 49-51. Without the alias, Docker resolves `builder` to an external image lookup (which will fail) or to the wrong stage, and the production image build aborts at the first `COPY --from=builder`. This blocks `pnpm docker:prod:build` entirely.
**Fix:**
```dockerfile
# Stage 1: Dependencies and Build
FROM node:22-slim AS builder
WORKDIR /app
```
Additionally, the `data/` directory creation on line 58 is missing `/app/data` itself (only subdirs are created) — not a blocker because `mkdir -p` on the subdirs implicitly creates the parent, so this is fine as-is.

## Warnings

### WR-01: `tracks.position` has no per-source uniqueness or index

**File:** `src/modules/server/db/schema.ts:85`
**Issue:** `position` is declared `.notNull()` but has neither a unique constraint on `(source_id, position)` nor an index. Two Phase 3 writers racing on the same playlist can both insert `position: 5`, leaving the UI with a non-deterministic ordering that no query can recover. The `schema.test.ts` contract test never asserts uniqueness, so this silently ships.
**Fix:**
```typescript
(t) => [
  unique("tracks_source_spotify_unique").on(t.sourceId, t.spotifyTrackId),
  unique("tracks_source_position_unique").on(t.sourceId, t.position),
  index("tracks_source_id_idx").on(t.sourceId),
  index("tracks_state_idx").on(t.state),
],
```
If gapless ordering is not required (e.g., Spotify re-orders mid-sync), drop `unique` and add `index("tracks_source_position_idx").on(t.sourceId, t.position)` so `ORDER BY position` stays cheap. Either way, the schema test should lock the decision.

### WR-02: UI status `Select` cannot represent or recover from `status: "error"`

**File:** `src/modules/client/playlist/service/options.ts:1-5`, `src/modules/client/playlist/components/playlist-config-card.tsx:88-115`
**Issue:** `PlaylistSchema` enumerates `["active","paused","archived","error"]` (playlist.ts:70) and Drizzle persists the same, but `statusOptions` in `options.ts` only ships Active/Paused/Archived. When the scheduler (or any future failure handler) sets a source to `error`, the `<Select.Root value={[props.status]}>` is handed a value with no matching collection item. Ark UI renders an empty trigger and the user has no in-app path to flip it back to `active`. `updateStatus` in `playlist-actions.ts:81` also casts through `"active" | "paused" | "archived" | "error"`, so the type system does not catch this.
**Fix:** Decide intent:
- If `error` is internal-only (scheduler-written, UI-readable, never user-settable), change the Select `disabled` when `props.status === "error"` and add an "Acknowledge error" button that explicitly resets to `active`.
- If it should be user-visible, add `{ label: "Error", value: "error" }` to `statusOptions`.

Either way, tighten `StatusOption` so the cast at `playlist-actions.ts:81` becomes a no-op rather than a widening.

### WR-03: `triggerManualSync` leaks unhandled promise rejections

**File:** `src/modules/server/scheduler/PlaylistScheduler.ts:293-298`
**Issue:** `executePlaylistSync(source)` returns a Promise that is intentionally not awaited so the HTTP handler can respond immediately. However there is no `.catch(...)` attached, so if `eventBus.emit(...)` rejects (a handler throwing, bus down, etc.) it becomes an unhandled rejection after the response has been flushed. Under Node `--unhandled-rejections=strict` (the default since Node 15 for fatal handling paths) this can crash the Nitro worker. The pattern is the only one in the codebase that deliberately fire-and-forgets a Promise.
**Fix:**
```typescript
// Execute sync in background (don't await, let it run async)
this.executePlaylistSync(source).catch((err) => {
  this.logger.error(
    { err, sourceId: source.id, sourceName: source.name },
    "Manual sync failed in background",
  );
});
```

### WR-04: `scheduleMinutes` read path treats `0` as "fall back to 1440"

**File:** `src/modules/client/playlist/utils/mapper.ts:28-30`, `src/modules/server/scheduler/PlaylistScheduler.ts:150-153`
**Issue:** `row.scheduleMinutes || 1440` collapses `0` (invalid, but writable because the column is not constrained), `null`, and `undefined` to 1440. More concerning, `PlaylistScheduler.schedulePlaylist` uses `else if (source.scheduleType === "interval" && source.scheduleMinutes)` at line 151 — a `0` or `null` silently unschedules the source with only a "Invalid schedule configuration" log. The Zod schema enforces `.min(1)` on input, but the DB column has no CHECK, so a future direct insert (or the seed script's `null`) sidesteps it.
**Fix:** Split the DB and UI concerns:
- `schema.ts`: add `.notNull().default(1440)` and a CHECK via `drizzle-kit`'s raw SQL, or accept the Zod boundary as authoritative and document that the repo layer is the only writer.
- Scheduler: `source.scheduleMinutes != null` instead of truthy check, then treat `0` as an explicit invalid-config log rather than a silent drop.
- Mapper: `row.scheduleMinutes ?? 1440` (nullish coalescing) to preserve a legitimate `0` if the schema ever relaxes.

### WR-05: `reset-db.mjs` trusts `process.cwd()` as the repo root

**File:** `scripts/reset-db.mjs:18-20`
**Issue:** `repoRoot = process.cwd()` means `pnpm reset:db` run from a subdirectory (e.g., `cd src && pnpm reset:db`) deletes `src/data/db.sqlite` (nothing) and then runs `drizzle-kit push` against whatever `drizzle.config.ts` it can discover from `src/`. pnpm's lifecycle scripts normally run from the package root so this is unlikely, but a developer invoking `node scripts/reset-db.mjs` manually from any other cwd gets silently wrong behavior.
**Fix:**
```javascript
import { fileURLToPath } from "node:url";
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
```
This anchors the script to its own location regardless of cwd.

### WR-06: `existsSync` + `unlinkSync` TOCTOU on db file

**File:** `scripts/reset-db.mjs:27-32`
**Issue:** Minor but real: if a concurrent process (another dev, a watcher) removes the file between `existsSync` and `unlinkSync`, the script crashes with `ENOENT`. For a reset script this is harmless noise, but the idiomatic form avoids the race.
**Fix:**
```javascript
try {
  unlinkSync(dbPath);
  console.log(`[reset:db] Deleted ${dbPath}`);
} catch (err) {
  if (err.code !== "ENOENT") throw err;
  console.log(`[reset:db] No DB at ${dbPath} — clean slate`);
}
```

## Info

### IN-01: User-facing copy still references removed features

**File:** `src/modules/client/library/components/library-info-panel.tsx:17`
**Issue:** `"You can edit quality and format settings for each playlist"` is shown on the main library page but Phase 1 deliberately removed the flags/quality/format fields from the edit UI. This will confuse the first user.
**Fix:** Either delete the bullet or replace with something accurate for the new pipeline, e.g., `"Edit schedule and output directory for each playlist"`.

### IN-02: Seed sample log references the removed `spotdl` engine

**File:** `src/modules/server/db/seed.ts:66`
**Issue:** Sample log template opens with `# spotdl run seed-run-001` and the legacy CLI progress bar format. Not a runtime bug, but it will sit in every seeded dev DB after Phase 1 and mislead Phase 3 developers looking at invocation details for their first engine implementation.
**Fix:** Update the template to neutral or to the Playwright+yt-dlp format planned in Phase 3:
```
# playlist sync seed-run-001
startedAt: ${...}
finishedAt: ${...}
exitCode: 0
...
```

### IN-03: Seed insert return types ignored; sync `.run()` pattern inconsistent with repository

**File:** `src/modules/server/db/seed.ts:48-51,120-123`
**Issue:** Seed uses `db.insert(...).values(...).run()` (synchronous) while `PlaylistRepository.createPlaylist` uses `await db.insert(...).values(...)` (async). `better-sqlite3` supports both but the mixed pattern is confusing, and `.run()` bypasses the Drizzle Promise wrapping used everywhere else. The seed script is also not covered by the schema test suite so a future breaking change to the async API will not be caught here.
**Fix:** Align with the rest of the server code:
```typescript
await db.insert(sources).values(seedSources).onConflictDoNothing({ target: sources.id });
```

### IN-04: `avgMs` type assertion defeats the generic

**File:** `src/modules/server/invocation/repository.ts:237`
**Issue:** `(avgDurationRes[0]?.avgMs as unknown as number) ?? 0` — the `sql<number>` template already types `avgMs` as `number | null`. The double-cast is a leftover from earlier refactor noise. `avg()` returns `null` on empty sets, not a non-number, so the `?? 0` fallback is the only thing that matters.
**Fix:**
```typescript
const avgDurationMs = avgDurationRes[0]?.avgMs ?? 0;
```

### IN-05: `BasicFieldsSection` uses `any` for the form prop

**File:** `src/modules/client/playlist/components/basic-fields-section.tsx:6-8,14-15,36-37,61-62`
**Issue:** Four `biome-ignore` comments for `any` on TanStack Form — this is the same pattern used in `library_.add.tsx:25` (`// @ts-expect-error`). The TanStack Form type exports (`Form<...>` or `SolidFormApi<...>`) are exported from `@tanstack/solid-form` and have been stable since 1.26. The `any` escape hatch here is avoidable and masks any future prop-shape regressions when the form schema changes.
**Fix:** Type with `form: SolidFormApi<CreatePlaylistFormData, ...>` from `@tanstack/solid-form`. If the generics are too noisy, a `Pick<Form, "Field">` narrowing works too.

### IN-06: `parseQueryParams` returns a `FilterState` that bypasses the schema enum

**File:** `src/modules/client/playlist/service/playlist.ts:55`
**Issue:** `(params.get("status") as Playlist["status"]) || undefined` casts any URL string to the enum without validation. A user typing `?status=deleted` in the URL bar lands it straight into a Drizzle `eq(status, "deleted")`, which silently returns no rows. Not a security issue (no injection surface) but a UX surprise.
**Fix:**
```typescript
const rawStatus = params.get("status");
const validStatuses = ["active", "paused", "archived", "error"] as const;
const status = validStatuses.includes(rawStatus as typeof validStatuses[number])
  ? (rawStatus as Playlist["status"])
  : undefined;
```
Or use `PlaylistSchema.shape.status.safeParse(rawStatus)`.

### IN-07: `Dockerfile.dev` copies full `src/` at build time, defeating bind-mount dev workflow

**File:** `Dockerfile.dev:26`
**Issue:** `COPY src ./src` bakes a snapshot of `src/` into the image. For a dev Dockerfile this is only useful if `docker-compose.dev.yml` does not bind-mount the source; if it does (the usual case), the COPY wastes build cache invalidation on every source change and `pnpm install` re-runs unnecessarily. Not a phase-1-introduced regression, but worth noting while the file is in scope.
**Fix:** Confirm `docker-compose.yml` bind-mounts `./src:/app/src`. If yes, drop the `COPY src ./src` and rely on the mount. If no, leave as-is but move `COPY src ./src` after `pnpm install` to preserve install cache.

---

_Reviewed: 2026-04-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
