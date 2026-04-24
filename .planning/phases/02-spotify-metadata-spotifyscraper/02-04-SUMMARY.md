---
phase: 02-spotify-metadata-spotifyscraper
plan: 04
subsystem: scraper-repository-runner
tags: [scraper, repository, upsert, drizzle, transaction, runner, events, invocations, tdd]

dependency_graph:
  requires:
    - src/modules/server/scraper/schema.ts (PYTHON_CRASH_PREFIX, PythonEnvelope — from Plan 03)
    - src/modules/server/scraper/SpotifyScraperBridge.ts (bridge class — from Plan 03)
    - src/modules/server/events/schema.ts (FailureReasonSchema — from Plan 02)
    - src/modules/server/invocation/repository.ts (InvocationRepository — from Phase 1)
    - src/modules/server/db/schema.ts (tracks/sources tables + composite unique key — from Phase 1)
    - drizzle/0000_tranquil_squadron_sinister.sql (migration SQL — schema for in-memory test DB)
  provides:
    - src/modules/server/scraper/repository.ts (ScraperRepository.upsertAll + setCoverArtUrl)
    - src/modules/server/scraper/SyncRunner.ts (SyncRunner.run + isValidPlaylistUrl)
    - src/modules/server/scraper/index.ts (barrel: schema + bridge + repository + SyncRunner)
  affects:
    - Plan 05 (PlaylistScheduler delegates executePlaylistSync to SyncRunner.run)
    - Plan 06 (integration test exercises SyncRunner end-to-end against real Python)

tech_stack:
  added: []
  patterns:
    - Drizzle onConflictDoUpdate with composite target [sourceId, spotifyTrackId] — column-preservation D-14
    - better-sqlite3 synchronous db.transaction with .run() terminators
    - In-memory SQLite test DB bootstrapped from latest Drizzle migration SQL (W-5 pattern)
    - PYTHON_CRASH_PREFIX import for crash-envelope detection (W-1 pattern — no raw string literal)
    - SyncRunnerDeps interface for dependency injection in tests
    - vi.mock("../events") for intercepting EventBus.emit in unit tests
    - TDD RED/GREEN cycle — test committed before implementation for both tasks

key_files:
  created:
    - src/modules/server/scraper/repository.ts
    - src/modules/server/scraper/repository.test.ts
    - src/modules/server/scraper/SyncRunner.ts
    - src/modules/server/scraper/SyncRunner.test.ts
  modified:
    - src/modules/server/scraper/index.ts (added repository + SyncRunner exports)

decisions:
  - "ScraperRepository implemented as a class (not object literal) to match InvocationRepository style and allow constructor injection in tests"
  - "upsertAll wraps both tracks upsert AND cover_art_url update in a single db.transaction (D-08) — atomicity prevents stale cover-art when tracks succeed but cover-art fails"
  - "coverArtUrl === null in upsertAll is a no-op (skip sources update) — avoids overwriting an existing URL with null when the envelope has no cover art"
  - "SyncRunner.finalizeFailure always calls invocationRepo.update even when create threw — the invocationId is assigned before the try block so the update can always reference it"
  - "19 warnings (as unknown casts in test fakes) accepted — same pattern as SpotifyScraperBridge.test.ts and PlaylistScheduler.test.ts in the codebase"
  - "fakeBridgeThrows helper defined but not used by any test — left as a utility for future extension; Biome only warns (no error)"

metrics:
  duration_minutes: 9
  completed_date: "2026-04-24T12:20:00Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 1
---

# Phase 02 Plan 04: ScraperRepository + SyncRunner — Scrape Execution Core Summary

**One-liner:** Drizzle composite-key upsert repository preserving Phase-3 columns + SyncRunner orchestrating the full scrape lifecycle with event emission, typed failure taxonomy, truncation detection, and W-1 python_crash reclassification — proven by 21 unit tests (9 repo + 12 runner) against in-memory SQLite and fake bridge.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 (RED) | Failing tests for ScraperRepository (9 behaviors) | 1a39b59 | scraper/repository.test.ts |
| 1 (GREEN) | Implement ScraperRepository | cbca15f | scraper/repository.ts |
| 2 (RED) | Failing tests for SyncRunner (12 behaviors) | 0d061e3 | scraper/SyncRunner.test.ts |
| 2 (GREEN) | Implement SyncRunner + update barrel | b85cb89 | scraper/SyncRunner.ts, scraper/index.ts |
| 2 (STYLE) | Apply Biome formatting | 1adeadc | All 4 task files |

## What Was Built

### src/modules/server/scraper/repository.ts (132 lines)

`ScraperRepository` class with two public methods:

**`upsertAll(sourceId, tracks, coverArtUrl)`:**
- Wraps everything in `db.transaction()` (D-08 atomicity)
- `insert(schema.tracks).values(values).onConflictDoUpdate({ target: [sourceId, spotifyTrackId], set: { title, artist, durationMs, position, updatedAt } })` — 5-column set clause only (D-14)
- `state / ytVideoId / downloadPath / failureReason` are intentionally absent from the set clause — SQLite preserves existing values on conflict
- Empty input is a no-op (no throw, no DB touch) (D-13 compatibility)
- Missing tracks from current response are untouched (D-16)

**`setCoverArtUrl(sourceId, coverArtUrl)`:**
- Standalone update for explicit null-clear use

### src/modules/server/scraper/repository.test.ts (272 lines)

9 in-memory SQLite tests using the latest Drizzle migration SQL (W-5 pattern — never hand-written DDL):

| Test | Behavior |
|------|---------|
| 1 | Insert new: state=pending, null ytVideoId/downloadPath/failureReason |
| 2 | Upsert preserves state/ytVideoId/downloadPath/failureReason on conflict (D-14) |
| 3 | Position overwritten on upsert (D-15) |
| 4 | updatedAt refreshed; createdAt unchanged |
| 5 | Missing tracks from current scrape untouched (D-16) |
| 6 | Empty input is a no-op |
| 7 | Tracks + cover_art_url written atomically in one call |
| 8 | setCoverArtUrl(null) clears cover art |
| 9 | Two sourceIds with same spotifyTrackId coexist (composite key isolation) |

### src/modules/server/scraper/SyncRunner.ts (291 lines)

`SyncRunner` class with dependency injection via `SyncRunnerDeps`. The `run(source)` method:

1. Emits `playlist.sync.started`
2. Creates invocation row (`status: "running"`)
3. Node-side URL guard: `isValidPlaylistUrl()` rejects non-Spotify-playlist URLs → `invalid_url` (T-2-04)
4. Calls `SpotifyScraperBridge.fetchPlaylist(url)`
5. On `envelope.error`: detects PYTHON_CRASH_PREFIX via `.startsWith(PYTHON_CRASH_PREFIX)` — reclassifies `network_error` with prefix to `python_crash` (W-1)
6. On null tracks without error: `python_crash` (defensive)
7. On success: `upsertAll()` in ScraperRepository → `finalizeSuccess` → invocation `success` + `playlist.sync.completed` event with `trackCount` + `truncationSuspected` (D-10/D-11)
8. On any failure: `finalizeFailure` → invocation `failed` + `playlist.sync.failed` with `failureReason` enum (D-09)
9. Outer `catch`: always emits terminal event even on unexpected throws (Pitfall 8)

**`isValidPlaylistUrl(url)`:** exported for reuse — accepts only `open.spotify.com/playlist/…`.

### src/modules/server/scraper/SyncRunner.test.ts (393 lines)

12 unit tests + 7 URL validator tests via mocked EventBus (`vi.mock("../events")`):

| Test | Behavior |
|------|---------|
| 1 | Happy path: started → running → upsert(3 tracks) → success → completed event |
| 2 | invalid_url: bridge never called, invocation fails, failureReason=invalid_url |
| 3 | not_found from bridge → failureReason=not_found |
| 4 | parse_error from bridge → failureReason=parse_error |
| 5 | network_error from bridge → failureReason=network_error |
| 6 | W-1: python_crash synthesis detected via PYTHON_CRASH_PREFIX constant |
| 7 | 100 tracks → truncationSuspected=true, trackCount=100 in event + invocation |
| 8 | 99 tracks → truncationSuspected=false |
| 9 | Exactly 100 → truncationSuspected=true (>= boundary) |
| 10 | repo.upsertAll throws → invocation failed, terminal event emitted |
| 11 | invocationRepo.create throws → terminal event still fires (Pitfall 8) |
| 12 | null tracks without error → python_crash (defensive branch) |

### src/modules/server/scraper/index.ts (barrel)

Updated to export `schema`, `SpotifyScraperBridge`, `repository`, and `SyncRunner`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Wrong vi.mock path — `~/modules/server/events` → `../events`**
- **Found during:** Task 2 GREEN phase (all 12 SyncRunner tests failing with `emitSpy.mock.calls[0]` undefined)
- **Issue:** The test used `vi.mock("~/modules/server/events", ...)` but the `~` alias isn't resolved the same way in vitest mocking. The existing codebase mock in `PlaylistScheduler.test.ts` uses `"../events"` (relative path). `SyncRunner.ts` also imports from `"../events"` (relative path).
- **Fix:** Changed mock path to `"../events"` to match the import specifier actually used by SyncRunner.
- **Files modified:** `SyncRunner.test.ts`
- **Commit:** included in `b85cb89`

**2. [Rule 2 - Formatting] Biome formatting applied to all 4 new files**
- **Found during:** Post-GREEN Biome check (7 errors, 19 warnings)
- **Issue:** Import ordering (node: builtins after third-party), object multiline formatting, function signature wrapping
- **Fix:** `biome check --write` applied to all 4 files; errors resolved; 19 warnings remain (all `as unknown` casts in test fakes — same pattern as `SpotifyScraperBridge.test.ts`)
- **Files modified:** `repository.ts`, `repository.test.ts`, `SyncRunner.ts`, `SyncRunner.test.ts`
- **Commit:** `1adeadc`

## TDD Gate Compliance

**Task 1 (ScraperRepository):**
- RED commit `1a39b59` (`test(02-04)`) precedes GREEN commit `cbca15f` (`feat(02-04)`) — gate sequence VALID
- All 9 tests failed in RED phase (`Cannot find module './repository'`)
- All 9 tests pass in GREEN phase

**Task 2 (SyncRunner):**
- RED commit `0d061e3` (`test(02-04)`) precedes GREEN commit `b85cb89` (`feat(02-04)`) — gate sequence VALID
- All 12 tests failed in RED phase (`Cannot find module './SyncRunner'`)
- All 12 tests pass in GREEN phase (after mock path fix)

## Known Stubs

None. Both `ScraperRepository` and `SyncRunner` are fully implemented. The `SyncRunner.run()` is the real implementation; Plan 05 wires it into `PlaylistScheduler.executePlaylistSync` (replacing the Phase 1 stub there — that's Plan 05's concern, not a stub here).

## Threat Flags

No new network endpoints or auth paths beyond what the plan's `<threat_model>` covers.

Threat mitigations implemented as specified:
- T-2-03: `db.transaction` wraps tracks + cover-art — Test 7 verifies atomic write; Tests 10/11 verify no partial writes on failure
- T-2-04: `isValidPlaylistUrl()` rejects non-Spotify-playlist hosts/paths — Test 2 asserts bridge never called on reject
- T-2-05: SyncRunner passes `envelope.error.message` (already truncated to 500 chars by bridge) to `finalizeFailure`; only `failureReason` enum (not full error) is in the event payload available to webhook formatter

## Self-Check: PASSED

- `src/modules/server/scraper/repository.ts` exists: VERIFIED
- `src/modules/server/scraper/repository.test.ts` exists: VERIFIED
- `src/modules/server/scraper/SyncRunner.ts` exists: VERIFIED
- `src/modules/server/scraper/SyncRunner.test.ts` exists: VERIFIED
- `src/modules/server/scraper/index.ts` updated: VERIFIED
- Commits 1a39b59, cbca15f, 0d061e3, b85cb89, 1adeadc exist: VERIFIED (git log)
- 210/210 tests pass: VERIFIED (`pnpm test`)
- typecheck clean: VERIFIED (`pnpm typecheck`)
- onConflictDoUpdate with composite target: VERIFIED
- No raw "python crash:" string in SyncRunner.ts: VERIFIED
- PYTHON_CRASH_PREFIX imported and used in SyncRunner.ts: VERIFIED
- PYTHON_CRASH_PREFIX used in SyncRunner.test.ts test fixture: VERIFIED
- state/ytVideoId/downloadPath/failureReason absent from set clause: VERIFIED
- db.transaction present in repository.ts: VERIFIED
- No hand-written CREATE TABLE in repository.test.ts: VERIFIED
