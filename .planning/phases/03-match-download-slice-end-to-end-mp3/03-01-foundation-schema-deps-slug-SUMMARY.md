---
phase: 03-match-download-slice-end-to-end-mp3
plan: "01"
subsystem: foundation
tags: [schema, migration, deps, slug, downloader, drizzle, sqlite]
dependency_graph:
  requires: []
  provides:
    - src/modules/server/db/schema.ts (tracks.album + invocations.kind columns)
    - src/modules/server/downloader/ (schema constants + slug helpers)
    - data/db.sqlite (live schema migrated)
  affects:
    - All Phase 3 plans (Wave 2+) that import from downloader/ or write to album/kind columns
    - Plan 03-02 (YtDlpBridge) imports YTDLP_CRASH_PREFIX, YtDlpProbeEnvelopeSchema, YtDlpErrorSchema
    - Plan 03-04 (DownloadRunner) imports MATCH_SETTINGS_KEY, DEFAULT_MATCH_SETTINGS, sourceSlug, safeFilename
    - Plan 03-05 (Docker integration) needs yt-dlp in container
tech_stack:
  added:
    - node-id3@0.2.9 (ID3 tagging — consumed by Plan 03-03 tagger)
    - p-limit@7.3.0 (concurrency limiting — consumed by Plan 03-04 DownloadRunner)
    - slugify@1.6.9 (URL-safe slug generation — used in downloader/slug.ts)
    - yt-dlp==2026.3.17 (Python package pinned in scraper/requirements.txt)
  patterns:
    - W-5 multi-migration test loader (apply all migrations in order, not just latest)
    - biome-ignore lint comment for intentional control character regex
    - onConflictDoNothing seed pattern (mirrors webhook settings)
key_files:
  created:
    - src/modules/server/downloader/schema.ts
    - src/modules/server/downloader/slug.ts
    - src/modules/server/downloader/slug.test.ts
    - src/modules/server/downloader/index.ts
    - drizzle/0001_condemned_black_widow.sql
    - drizzle/meta/0001_snapshot.json
  modified:
    - src/modules/server/db/schema.ts (album + kind columns)
    - src/env.ts (YT_DLP_BIN validator)
    - src/modules/server/db/seed.ts (match settings seed row)
    - package.json (node-id3, p-limit, slugify)
    - pnpm-lock.yaml
    - scraper/requirements.txt (yt-dlp==2026.3.17)
    - Dockerfile (ENV YT_DLP_BIN)
    - Dockerfile.dev (ENV YT_DLP_BIN)
    - drizzle/meta/_journal.json
    - src/modules/server/db/schema.test.ts (album column added to assertion)
    - src/modules/server/scraper/repository.test.ts (W-5 multi-migration fix)
decisions:
  - "Applied drizzle-kit push --force for fresh worktree SQLite (no existing data; Phase 1 D-05 clean-break approach)"
  - "Used biome-ignore comment for FS_UNSAFE_CHARS regex (\\x00-\\x1F intentional control char range)"
  - "Fixed W-5 test loader to apply all migrations in order — required once delta migrations exist alongside baseline"
metrics:
  duration: "9 minutes"
  completed: "2026-04-25"
  tasks_completed: 5
  files_changed: 18
---

# Phase 3 Plan 1: Foundation — Schema, Deps, Slug Summary

**One-liner:** SQLite schema extended with `tracks.album` + `invocations.kind`, Drizzle migration generated and pushed, yt-dlp pinned in scraper venv, three Node deps installed, and the `src/modules/server/downloader/` module initialized with Zod envelope schemas, slug helpers (Windows-safe), and 15 unit tests.

## Tasks Completed

| # | Name | Commit | Key Output |
|---|------|--------|------------|
| 1 | Add album/kind columns + YT_DLP_BIN env | 412ef88 | schema.ts + env.ts |
| 2 | Install deps + yt-dlp + Docker ENV | 7784fc7 | package.json, requirements.txt, Dockerfiles |
| 3 | Create downloader/ module (schema+slug+tests+barrel) | 1f9cee5 | 4 new files, 15 tests green |
| 4 | Seed default match settings | 8bffe2f | seed.ts onConflictDoNothing insert |
| 5 | [BLOCKING] Generate migration + push to live SQLite | 2a812d2 | 0001_condemned_black_widow.sql applied |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] W-5 test loader only read latest migration, not all migrations**
- **Found during:** Task 5 — `pnpm test` after generating the 0001 migration
- **Issue:** `createTestDb` in `repository.test.ts` used `.sort().pop()` to load only the latest `.sql` file. Once `0001_condemned_black_widow.sql` (containing only `ALTER TABLE` statements) was generated, the in-memory test DB had no tables (`CREATE TABLE` statements are in `0000_*`). This caused `SqliteError: no such table: invocations` across 10 tests.
- **Fix:** Changed loop to apply all migration files in sorted order (cumulative application). This is the correct W-5 behavior for any project with delta migrations.
- **Files modified:** `src/modules/server/scraper/repository.test.ts`
- **Commit:** 2a812d2

**2. [Rule 1 - Bug] schema.test.ts TRACK-02 assertion missing `album` column**
- **Found during:** Task 5 — same test run
- **Issue:** The "exposes the full TRACK-02 column set" test had a hardcoded list of 13 columns that didn't include `album`. The sorted comparison failed with `expected [...] to deeply equal [...]`.
- **Fix:** Added `"album"` to the expected column list; updated test description to note the Phase 3 D-13 addition.
- **Files modified:** `src/modules/server/db/schema.test.ts`
- **Commit:** 2a812d2

**3. [Rule 2 - Biome compliance] FS_UNSAFE_CHARS regex uses control characters**
- **Found during:** Task 3 — `pnpm biome check` on new downloader files
- **Issue:** Biome `noControlCharactersInRegex` rule flagged `\x00-\x1F` in `slug.ts`.
- **Fix:** Added `biome-ignore lint/suspicious/noControlCharactersInRegex: intentional` comment — the control character range is a required security sanitization per T-3-02-A mitigation.
- **Files modified:** `src/modules/server/downloader/slug.ts`
- **Commit:** 1f9cee5

### Pre-existing Issues (Out of Scope)

The following pre-existing issues were discovered but are NOT caused by this plan's changes:
- `pnpm typecheck` errors in `SyncRunner.test.ts` (TS2769 tuple overload mismatches) — pre-existing
- `pnpm biome check` errors in `heading.tsx`, `image.tsx`, `toast.tsx`, various other files — pre-existing
- Vite server "close timed out" warning in test runner — pre-existing infrastructure issue

## Threat Flags

No new security-relevant surface beyond what the plan's `<threat_model>` already catalogued (T-3-02-A, T-3-02-B, T-3-09 mitigations implemented as specified).

## Known Stubs

None — all Phase 3 Plan 1 deliverables are fully wired:
- `DEFAULT_MATCH_SETTINGS` resolves to `{ tolerance_seconds: 3, parallel: 3 }` (not empty/null)
- `sourceSlug` and `safeFilename` are pure deterministic functions with no placeholders
- Schema columns are real Drizzle columns (not string literals)

## Self-Check: PASSED

All 6 created files verified present on disk. All 5 task commits verified in git log.

| Check | Result |
|-------|--------|
| src/modules/server/downloader/schema.ts | FOUND |
| src/modules/server/downloader/slug.ts | FOUND |
| src/modules/server/downloader/slug.test.ts | FOUND |
| src/modules/server/downloader/index.ts | FOUND |
| drizzle/0001_condemned_black_widow.sql | FOUND |
| drizzle/meta/0001_snapshot.json | FOUND |
| Commit 412ef88 (Task 1) | FOUND |
| Commit 7784fc7 (Task 2) | FOUND |
| Commit 1f9cee5 (Task 3) | FOUND |
| Commit 8bffe2f (Task 4) | FOUND |
| Commit 2a812d2 (Task 5) | FOUND |
