---
phase: 01-schema-reset-spotdl-removal
plan: 01
subsystem: database
tags: [drizzle, sqlite, schema, tracks, sources, migration]

# Dependency graph
requires:
  - phase: 01-schema-reset-spotdl-removal
    provides: "Phase 1 context + locked decisions D-08..D-13 and TRACK-01/TRACK-02 contract"
provides:
  - "sources table (renamed from playlists, no flags_*, no 'track' variant, nullable cover_art_url)"
  - "tracks table with (source_id, spotify_track_id) composite unique + CASCADE FK"
  - "SourceRow / NewSourceRow / TrackRow / NewTrackRow type exports"
  - "Single fresh drizzle migration 0000_tranquil_squadron_sinister.sql"
  - "data/db.sqlite seeded with the Phase 1 schema"
  - "Wave-0 schema.test.ts asserting the full TRACK-01/TRACK-02 contract"
affects:
  - 01-02-client-schema-trim
  - 01-03-spotdl-directory-deletion
  - 01-04-scheduler-stub
  - 01-05-db-reset-script
  - phase-03-scrape-and-match
  - phase-05-tracks-ui

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "drizzle composite unique via unique(\"name\").on(t.col1, t.col2) callback form"
    - "ON DELETE CASCADE FK via .references(() => sources.id, { onDelete: 'cascade' })"
    - "Per-table indexes via index(\"name\").on(t.col) in the 3-arg sqliteTable callback"
    - "Wave-0 schema contract test using getTableColumns + getTableConfig for structural assertions"

key-files:
  created:
    - "src/modules/server/db/schema.test.ts"
    - ".planning/phases/01-schema-reset-spotdl-removal/deferred-items.md"
  modified:
    - "src/modules/server/db/schema.ts"
    - "src/modules/server/db/seed.ts"
    - "src/modules/client/playlist/utils/mapper.ts"
    - "src/modules/server/playlist/repository.ts"
    - "src/modules/server/playlist/functions.ts"
    - "src/modules/server/invocation/repository.ts"
    - "src/modules/server/scheduler/PlaylistScheduler.ts"
    - "src/modules/server/scheduler/PlaylistScheduler.test.ts"
    - "drizzle/0000_tranquil_squadron_sinister.sql"
    - "drizzle/meta/_journal.json"
    - "drizzle/meta/0000_snapshot.json"

key-decisions:
  - "playlists -> sources rename committed in this plan (D-11) — aligns tracks.source_id FK with final table name; pollution-free Phase 3 queries"
  - "Added nullable cover_art_url to sources NOW (not Phase 3) to avoid a second schema churn when SCRAPE-07 embeds cover art"
  - "Kept invocations.playlist_id column name unchanged — only the FK target moved to sources.id. Phase 3 reworks invocations semantics per CONTEXT §Deferred Ideas"
  - "Generated migration via drizzle-kit generate (not push-only) so the SQL is checked in and reviewable"
  - "Hardcoded flags.format='mp3'/flags.overwrite=false in scheduler to keep call site compiling through the schema rename; Plan 01-04 replaces the whole sync body"

patterns-established:
  - "Wave-0 schema test: structural assertions (column sets, enum values, unique constraints, FK cascade) via drizzle-orm introspection functions, not DB-roundtrip tests"
  - "Clean-break migration: rm -rf drizzle && mkdir drizzle && pnpm db:generate — single fresh 0000_*.sql with zero ALTER TABLE"

requirements-completed:
  - TRACK-01
  - TRACK-02
  - CLEANUP-02

# Metrics
duration: 9min
completed: 2026-04-24
---

# Phase 1 Plan 01: Schema Reset (sources + tracks) Summary

**Renamed playlists -> sources, dropped flags_* columns and 'track' variant, added tracks table with composite unique on (source_id, spotify_track_id) + CASCADE FK, regenerated drizzle migration from scratch, and applied fresh schema to data/db.sqlite.**

## Performance

- **Duration:** ~9 min
- **Started:** 2026-04-24T08:29:26Z
- **Completed:** 2026-04-24T08:38:41Z
- **Tasks:** 4 (3 committed, 1 runtime-only)
- **Files modified:** 11

## Accomplishments

- New `sources` + `tracks` tables land the Phase 1 data contract in one atomic schema rewrite
- Composite unique `(source_id, spotify_track_id)` and `ON DELETE CASCADE` from sources enforce TRACK-01
- 9-assertion Wave-0 schema test (`schema.test.ts`) locks the contract against regression from future phases
- Single fresh `0000_tranquil_squadron_sinister.sql` replaces three legacy ALTER-drift migrations
- `data/db.sqlite` recreated against the new schema; `pnpm db:push` now reports "No changes detected" (idempotent)
- Zero `schema.playlists` / `PlaylistRow` references remain under `src/`

## Task Commits

Each task was committed atomically:

1. **Task 1: Write failing Wave-0 schema test** — `fec2331` (test) — RED: 9 assertions fail on missing `sources`/`tracks` exports
2. **Task 2: Rewrite schema.ts + update all consumers** — `25adc07` (feat) — GREEN: 10/10 schema tests pass; includes Rule 3 scheduler rename + Rule 1 mapper 'track' guard
3. **Task 3: Regenerate drizzle/ migrations from scratch** — `561de57` (feat) — Single `0000_tranquil_squadron_sinister.sql` with zero ALTER TABLE
4. **Task 4: [BLOCKING] Wipe data/db.sqlite and apply fresh schema** — runtime-only (no tracked-file changes; `data/` is gitignored)

_Note: Task 1 is the RED phase of the plan-level TDD gate; Task 2 is the GREEN phase. No refactor commit was needed._

## Files Created/Modified

**Created:**
- `src/modules/server/db/schema.test.ts` — 10 structural assertions for sources + tracks + retained tables
- `.planning/phases/01-schema-reset-spotdl-removal/deferred-items.md` — tracks 15 pre-existing typecheck errors in files outside this plan's scope

**Modified:**
- `src/modules/server/db/schema.ts` — Rewritten: sources (rename + drop flags_* + drop "track" enum + add cover_art_url), new tracks table, invocations FK retargeted to sources.id, globalSettings unchanged
- `src/modules/server/db/seed.ts` — Replaced `NewPlaylistRow`/`playlists` with `NewSourceRow`/`sources`; deleted the 3rd "track" seed; dropped all flags_* fields from remaining seeds
- `src/modules/client/playlist/utils/mapper.ts` — Uses `SourceRow`/`NewSourceRow`; dropped flags construction; added Rule 1 guard that rejects `source.type === "track"` in `playlistToRow`
- `src/modules/server/playlist/repository.ts` — 18 occurrences of `schema.playlists` -> `schema.sources`
- `src/modules/server/playlist/functions.ts` — 2 occurrences of `schema.playlists` -> `schema.sources`
- `src/modules/server/invocation/repository.ts` — 3 occurrences of `schema.playlists` -> `schema.sources` (used in `getPlaylistNames`)
- `src/modules/server/scheduler/PlaylistScheduler.ts` — [Rule 3] Minimal rename pass-through: `PlaylistRow` -> `SourceRow`, `schema.playlists` -> `schema.sources`, flag column reads replaced with hardcoded defaults. Plan 01-04 rewrites the full sync body.
- `src/modules/server/scheduler/PlaylistScheduler.test.ts` — [Rule 3] `PlaylistRow` -> `SourceRow`, dropped flags_* mock fields, added `coverArtUrl: null`. Plan 01-04 rewrites the whole test.
- `drizzle/0000_tranquil_squadron_sinister.sql` — New clean-break migration (replaces 3 legacy files)
- `drizzle/meta/_journal.json` — Single entry pointing at the new migration
- `drizzle/meta/0000_snapshot.json` — Fresh snapshot for the new schema

## Decisions Made

- **Renamed `playlists` -> `sources` in this plan** (D-11 discretion): tracks.source_id FK would read awkwardly against `playlists.id`. Clean break allows the final shape now; rename cost is a handful of files.
- **Added `cover_art_url` now** (D-11 discretion): Phase 3 SCRAPE-07 populates it; adding the column now avoids a later schema churn. Stays null through Phase 1.
- **Dropped `"track"` from `source_type` enum** (D-11): v1 is playlists + albums only per REQUIREMENTS.md SCRAPE-01/SCRAPE-02.
- **Kept `invocations.playlist_id` column name** (D-11, CONTEXT §Deferred Ideas): column name unchanged, only FK target moved. Phase 3 reworks invocations.
- **Generated migration via `drizzle-kit generate`** (RESEARCH Pitfall 1): single fresh 0000 SQL checked in, reviewable, no push-only drift.
- **Indexes on `tracks.source_id` and `tracks.state`** (D-10 discretion, RESEARCH Example 1): Phase 3+ query patterns scan by source_id (detail page) and by state (auto-retry).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Scheduler rename pass-through required for typecheck**
- **Found during:** Task 2 (GREEN)
- **Issue:** Plan 01-01's `files_modified` excluded `PlaylistScheduler.ts` and `PlaylistScheduler.test.ts`, but both reference `PlaylistRow` and `schema.playlists`. After removing the `playlists` export, `pnpm typecheck` fails on these files — which contradicts Task 2 acceptance `pnpm typecheck` exits 0.
- **Fix:** Minimal pass-through rename only — `PlaylistRow` -> `SourceRow`, `schema.playlists` -> `schema.sources`. The two `playlist.flagsFormat` / `playlist.flagsOverwrite` reads (scheduler.ts:135-136) were replaced with hardcoded defaults `format: "mp3"` / `overwrite: false` so the call site compiles. Comments flag this as temporary until Plan 01-04 rewrites the sync body. Also added `coverArtUrl: null` to the test-file mock builder.
- **Files modified:** src/modules/server/scheduler/PlaylistScheduler.ts, src/modules/server/scheduler/PlaylistScheduler.test.ts
- **Verification:** Net-new typecheck error count = 0. Schema test still green (10/10). Plan 01-04 replaces all affected code.
- **Committed in:** 25adc07 (Task 2)

**2. [Rule 1 - Bug] Added runtime guard for unsupported 'track' source type in playlistToRow**
- **Found during:** Task 2 (GREEN)
- **Issue:** Dropping `"track"` from `source_type` enum narrows `NewSourceRow["sourceType"]` to `"playlist" | "album"`. The Zod `PlaylistSchema` (unchanged in this plan, trimmed in Plan 01-02) still accepts `"track"`. Passing a Playlist with `source.type: "track"` to `playlistToRow` would silently coerce via `sourceType: playlist.source.type` — TS error, and semantically wrong.
- **Fix:** Added an explicit `if (playlist.source.type === "track") throw ...` guard with a useful error message. Unreachable after Plan 01-02 trims the Zod schema.
- **Files modified:** src/modules/client/playlist/utils/mapper.ts
- **Verification:** Typecheck passes; mapper produces rows with only valid source types.
- **Committed in:** 25adc07 (Task 2)

**3. [Rule 3 - Blocking] Created data/ directory before db:push**
- **Found during:** Task 4 (BLOCKING)
- **Issue:** `data/` is gitignored and did not exist in the fresh worktree. `drizzle-kit push` immediately errored with "Cannot open database because the directory does not exist".
- **Fix:** `mkdir -p data` before running `pnpm db:push`. Plan 01-05 likely codifies this in a reset script.
- **Files modified:** (runtime — data/ is gitignored)
- **Verification:** db:push succeeded; idempotent re-run prints "No changes detected".
- **Committed in:** (no commit — directory creation is runtime-only)

**4. [Rule 3 - Blocking] Used `drizzle-kit push --force` for initial apply**
- **Found during:** Task 4 (BLOCKING)
- **Issue:** `drizzle.config.ts` has `strict: true`, which makes drizzle-kit prompt interactively on every CREATE TABLE (even against an empty DB, not a destructive drift). RESEARCH §Pattern 1 documents push as non-interactive against clean slate — but `strict: true` overrides that.
- **Fix:** Initial apply used `pnpm exec drizzle-kit push --force` to accept the CREATE TABLE statements non-interactively. Subsequent `pnpm db:push` runs (schema matches DB) print "No changes detected" non-interactively — the steady-state path is clean.
- **Files modified:** (runtime — drizzle-kit invocation choice)
- **Verification:** db:push re-run under the plain `pnpm db:push` alias exits 0 with "No changes detected".
- **Committed in:** (no commit)

---

**Total deviations:** 4 auto-fixed (3 blocking, 1 bug)
**Impact on plan:** All deviations required for correctness. Scope stayed minimal — scheduler renames are pass-through only, mapper guard is unreachable after Plan 01-02 trims the Zod schema, data/ dir creation is idempotent and strict-mode force is only needed at initial apply.

## Issues Encountered

**Pre-existing typecheck errors (not introduced by this plan):**
`pnpm typecheck` reports 15 errors in files that Plan 01-01 did not touch (verified by comparing `git stash` + typecheck against the commit-88c8b34 baseline). Per the `SCOPE BOUNDARY` rule, these are out of scope for this plan and are logged in `.planning/phases/01-schema-reset-spotdl-removal/deferred-items.md` for their owning plans (01-02 for client types, 01-03 for the spotdl directory, plus two non-Phase-1 route and UI-component drifts). Net-new typecheck errors introduced by this plan: **0**.

**Literal-vs-semantic acceptance criteria:**
- Acceptance criterion `grep -q 'sqliteTable("tracks"' src/modules/server/db/schema.ts` expects a single-line form. Biome auto-reformats the 3-arg sqliteTable call across multiple lines (`sqliteTable(\n  "tracks",\n  { ... }, (t) => [...])`). The semantic check (`getTableName(tracks) === "tracks"`) passes in schema.test.ts.
- Acceptance criterion `sqlite3 data/db.sqlite '.schema tracks' | grep -q 'skipped_low_confidence'` — SQLite does not store text enum values in DDL (Drizzle enforces enums at the ORM layer). The semantic check passes in schema.test.ts via `getTableColumns(tracks).state.enumValues`.

## User Setup Required

None — no external service configuration needed for this plan.

## sqlite3 .schema output

```sql
CREATE TABLE `sources` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`source_type` text NOT NULL,
	`source_url` text NOT NULL,
	`output_dir` text NOT NULL,
	`cover_art_url` text,
	`schedule_enabled` integer DEFAULT false NOT NULL,
	`schedule_type` text DEFAULT 'interval' NOT NULL,
	`schedule_cron` text,
	`schedule_minutes` integer DEFAULT 1440,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL
);

CREATE TABLE `tracks` (
	`id` text PRIMARY KEY NOT NULL,
	`source_id` text NOT NULL,
	`spotify_track_id` text NOT NULL,
	`title` text NOT NULL,
	`artist` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`yt_video_id` text,
	`download_path` text,
	`failure_reason` text,
	`position` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch()) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch()) NOT NULL,
	FOREIGN KEY (`source_id`) REFERENCES `sources`(`id`) ON UPDATE no action ON DELETE cascade
);
CREATE INDEX `tracks_source_id_idx` ON `tracks` (`source_id`);
CREATE INDEX `tracks_state_idx` ON `tracks` (`state`);
CREATE UNIQUE INDEX `tracks_source_spotify_unique` ON `tracks` (`source_id`,`spotify_track_id`);
```

## Idempotence Confirmation

```
$ pnpm db:push
> drizzle-kit push
[✓] Pulling schema from database...
[i] No changes detected
```

## Next Phase Readiness

- **Plan 01-02 (client schema trim, Wave 1)** can begin: PlaylistSchema (Zod) still carries `flags` + `"track"` to be trimmed. Mapper's Rule 1 guard becomes unreachable after that.
- **Plan 01-03 (spotdl deletion, Wave 1)** can begin: schema rename is independent of spotdl directory teardown.
- **Plan 01-04 (scheduler stub, Wave 2)** prerequisites met: SourceRow type is in place; scheduler.ts imports already renamed; full sync body rewrite is the focus of that plan.
- **Plan 01-05 (db reset script, Wave 3)** prerequisites met: clean migration baseline + confirmed idempotent push flow. Plan 01-05 should also ensure `data/` is created if missing (see Deviation #3).

## TDD Gate Compliance

- **RED gate:** `test(01-01)` commit `fec2331` — 9 failing assertions against missing exports
- **GREEN gate:** `feat(01-01)` commit `25adc07` — 10/10 assertions pass (the 10th is a retained-tables sanity check)
- **REFACTOR gate:** Not needed — GREEN implementation is already in final shape

## Known Stubs

None. All new exports (`sources`, `tracks`, `SourceRow`, `NewSourceRow`, `TrackRow`, `NewTrackRow`) are real, typed, and consumed by downstream call sites or the schema test.

## Self-Check: PASSED

Verified on 2026-04-24:

- File `src/modules/server/db/schema.test.ts` — EXISTS
- File `.planning/phases/01-schema-reset-spotdl-removal/deferred-items.md` — EXISTS
- File `drizzle/0000_tranquil_squadron_sinister.sql` — EXISTS
- File `data/db.sqlite` — EXISTS (runtime-only, gitignored)
- File `.planning/phases/01-schema-reset-spotdl-removal/01-01-SUMMARY.md` — EXISTS
- Commit `fec2331` (Task 1, test) — EXISTS
- Commit `25adc07` (Task 2, feat) — EXISTS
- Commit `561de57` (Task 3, feat) — EXISTS
- Commit `c25272e` (metadata, docs) — EXISTS
- `grep -rn "schema\.playlists" src/` — 0 matches
- `grep -rn "PlaylistRow" src/modules/server/` — 0 matches
- `pnpm exec vitest run src/modules/server/db/schema.test.ts` — 10/10 passing
- `pnpm db:push` — idempotent ("No changes detected")
- 4 tables in `data/db.sqlite`: sources, tracks, invocations, global_settings

---
*Phase: 01-schema-reset-spotdl-removal*
*Completed: 2026-04-24*
