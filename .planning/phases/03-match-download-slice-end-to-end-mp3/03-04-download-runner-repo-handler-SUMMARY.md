---
phase: 03-match-download-slice-end-to-end-mp3
plan: "04"
subsystem: downloader
tags: [download, match, ytdlp, event-bus, scheduler, tdd, repository]
dependency_graph:
  requires:
    - 03-01-foundation-schema-deps-slug
    - 03-02-yt-dlp-bridge
    - 03-03-tagger-cover-art
  provides:
    - DownloadRepository (track state writes, match settings)
    - DownloadRunner (per-source orchestration, pLimit fan-out)
    - playlist.download.completed event type
    - registerDownloadHandler (EventBus subscription)
    - Nitro plugin registration
    - D-06 lock-spans-handler-chain integration tests
  affects:
    - src/modules/server/events/schema.ts
    - server/plugins/events.ts
    - src/modules/server/scheduler/PlaylistScheduler.test.ts
tech_stack:
  added: []
  patterns:
    - pLimit(N) fan-out with per-track failure isolation
    - Binary pre-flight (RESEARCH Pitfall #3) before any track work
    - W-1 YTDLP_CRASH_PREFIX reclassification pattern
    - T-3-02 path-traversal defense-in-depth (dir + per-track path)
    - EventBus await-chain spans scheduler lock (D-06 via Promise.allSettled)
    - vi.importActual to bypass module mock in integration test
key_files:
  created:
    - src/modules/server/downloader/repository.ts
    - src/modules/server/downloader/repository.test.ts
    - src/modules/server/downloader/DownloadRunner.ts
    - src/modules/server/downloader/DownloadRunner.test.ts
    - src/modules/server/downloader/handler.ts
  modified:
    - src/modules/server/downloader/index.ts
    - src/modules/server/events/schema.ts
    - server/plugins/events.ts
    - src/modules/server/scheduler/PlaylistScheduler.test.ts
decisions:
  - "MatchSettings unused import removed from DownloadRunner.ts (cleanup)"
  - "D-06 tests use vi.importActual to access real EventBus despite module-level mock"
  - "Track duration mismatch (durationMs vs probe durationSeconds) required all Test 1 tracks to have matching durations within ±3s tolerance"
  - "fsMock uses vi.hoisted() to avoid TDZ error in vi.mock factory"
  - "emitSpy.mockResolvedValue(undefined) re-established after vi.clearAllMocks() in beforeEach"
metrics:
  duration: "~50 minutes"
  completed: "2026-04-25"
  tasks_completed: 5
  tests_added: 32
  files_created: 5
  files_modified: 4
---

# Phase 03 Plan 04: DownloadRunner + Repository + Handler Summary

**One-liner:** DownloadRepository (track-state writes + match-settings JSON), DownloadRunner (pLimit fan-out + per-track state machine + binary pre-flight + W-1 reclassification + T-3-02 path guard), playlist.download.completed event, EventBus handler subscribed to playlist.sync.completed, Nitro plugin registration, and D-06 lock-spans-handler-chain integration tests — wiring the full scheduler→scrape→download pipeline end-to-end.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Extend events/schema.ts with PlaylistDownloadCompletedEventSchema | 14fe6a9 | src/modules/server/events/schema.ts |
| 2 | DownloadRepository + 16 in-memory tests (TDD) | 231c9d5 | repository.ts, repository.test.ts, index.ts |
| 3 | DownloadRunner orchestrator + 14 unit tests (TDD) | 338522f | DownloadRunner.ts, DownloadRunner.test.ts, index.ts |
| 4 | EventBus handler + Nitro plugin registration | 5885419 | handler.ts, index.ts, server/plugins/events.ts |
| 5 | D-06 lock-spans-handler-chain integration tests | bbbcd22 | PlaylistScheduler.test.ts |

## What Was Built

### Task 1 — PlaylistDownloadCompletedEventSchema

Added `PlaylistDownloadCompletedEventSchema` to `events/schema.ts` with download counters payload (`total`, `downloaded`, `matchedOnly`, `skippedLowConfidence`, `failed`) and appended to the `EventSchema` discriminated union. Type export `PlaylistDownloadCompletedEvent` added.

### Task 2 — DownloadRepository

`DownloadRepository` class with 9 methods:
- `getTracksToProcess(sourceId)` — `inArray(state, ['pending','matched'])` per D-07
- `getSource(sourceId)` — source lookup for slug/cover-art
- `markMatched(trackId, ytVideoId)` — D-02 first transition
- `markDownloaded(trackId, downloadPath)` — D-02 final transition, clears failureReason
- `markFailed(trackId, errorType, message)` — T-3-03: 500-char stderr cap
- `markSkippedLowConfidence(trackId, ytVideoId|null, reason)` — MATCH-03
- `getMatchSettings()` — fallback to DEFAULT_MATCH_SETTINGS on parse/Zod failure
- `saveMatchSettings(settings)` — `onConflictDoUpdate` upsert (mirrors webhooks/repository.ts)

16 in-memory Drizzle tests using W-5 latest-migration loader pattern.

### Task 3 — DownloadRunner

`DownloadRunner` class with full `run(source)` lifecycle:
1. Read tracks (for pre-flight total counter)
2. Binary pre-flight via DI `preflight()` — `spawnVersionCheck` for yt-dlp + ffmpeg
3. Pre-flight failure: create kind=download invocation → finalize with `exitCode=127, failure_reason=ytdlp_missing|ffmpeg_missing` → emit `playlist.download.completed` with `failed=total`
4. Zero-tracks: early exit (no invocation row, no event)
5. Snapshot settings (tolerance_seconds + parallel)
6. Create kind=download invocation row
7. T-3-02 dir path guard; `fs.mkdir({recursive:true})`
8. `pLimit(settings.parallel)` fan-out over tracks → `processTrack`
9. Aggregate counters; finalize invocation; emit `playlist.download.completed`

`processTrack` state machine: path-traversal guard → D-15 skip-if-exists → MATCH-04 reuse ytVideoId → probe → ±toleranceSeconds gate → markMatched → download → cover-art (best-effort) → tag (best-effort) → markDownloaded.

W-1 reclassification applied at both probe and download error points.

14 unit tests covering all behaviors.

### Task 4 — EventBus Handler + Nitro Plugin

`registerDownloadHandler()` subscribes to `playlist.sync.completed` via `bus.on()`, looks up source by `event.payload.playlistId`, awaits `runner.run(source)`. D-06 lock spans automatically because `EventBus.emit` awaits `Promise.allSettled(handlers)`.

`server/plugins/events.ts` registers `registerDownloadHandler(eventHandlerLogger)` after the Discord webhook handler. Full index.ts barrel added.

### Task 5 — D-06 Integration Tests

Two tests in new `describe("D-06 lock spans scrape→download handler chain")` block in `PlaylistScheduler.test.ts`:
1. Lock held while slow `playlist.sync.completed` handler is in-flight
2. Concurrent `triggerManualSync` blocked while download in-flight

Tests use `vi.importActual("../events/EventBus")` to bypass the module-level mock and exercise the real `EventBus.emit` → `Promise.allSettled` await chain. `EventBus.resetInstance()` in `afterEach` prevents handler leakage.

## Test Results

- Total tests after plan: **209 pass, 2 skipped** (full suite)
- New tests added: **32** (16 repository + 14 DownloadRunner + 2 D-06)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed DownloadRunner.test.ts TDZ error in vi.mock factory**
- **Found during:** Task 3 (RED phase)
- **Issue:** `vi.mock("node:fs", () => ({ promises: fsMock, ... }))` factory referenced `fsMock` before initialization — Temporal Dead Zone error.
- **Fix:** Moved `emitSpy` and `fsMock` into `vi.hoisted()` so they are initialized before the mock factory runs.
- **Files modified:** `src/modules/server/downloader/DownloadRunner.test.ts`

**2. [Rule 1 - Bug] Fixed Test 1 track durations exceeding ±3s tolerance gate**
- **Found during:** Task 3 (GREEN phase)
- **Issue:** Test 1 tracks had `durationMs: 120000` and `240000` but probe returned `durationSeconds: 180` — delta of 60s > 3s tolerance caused 2/3 tracks to be skipped_low_confidence instead of downloaded.
- **Fix:** Changed tracks to `durationMs: 181000` and `179000` (delta ≤ 1s from probe's 180s).
- **Files modified:** `src/modules/server/downloader/DownloadRunner.test.ts`

**3. [Rule 1 - Bug] Fixed unused MatchSettings import in DownloadRunner.ts**
- **Found during:** Task 3 typecheck
- **Issue:** `import type { MatchSettings } from "./schema"` not used at runtime.
- **Fix:** Removed the unused import.
- **Files modified:** `src/modules/server/downloader/DownloadRunner.ts`

**4. [Rule 1 - Bug] Fixed TypeScript TS2769 errors in DownloadRunner.test.ts**
- **Found during:** Task 3 typecheck
- **Issue:** `emitSpy.mock.calls.find((c: [any]) => ...)` causes "no overload matches" TS error (same pattern as pre-existing SyncRunner.test.ts errors).
- **Fix:** Changed to `(c) => (c as [any])[0].type === ...` to avoid the typed parameter annotation.
- **Files modified:** `src/modules/server/downloader/DownloadRunner.test.ts`

**5. [Rule 2 - Missing] Added emitSpy.mockResolvedValue(undefined) reset in beforeEach**
- **Found during:** Task 3 (debugging mock state)
- **Issue:** `vi.clearAllMocks()` clears mock implementations; `emitSpy` returned `undefined` synchronously instead of a resolved Promise after clearing.
- **Fix:** Added `emitSpy.mockResolvedValue(undefined)` in `beforeEach` after `vi.clearAllMocks()`.
- **Files modified:** `src/modules/server/downloader/DownloadRunner.test.ts`

**6. [Rule 1 - Bug] Added missing `beforeAll` import in PlaylistScheduler.test.ts**
- **Found during:** Task 5 (RED phase)
- **Issue:** `beforeAll` was used in D-06 describe block but not imported from vitest.
- **Fix:** Added `beforeAll` to the vitest import.
- **Files modified:** `src/modules/server/scheduler/PlaylistScheduler.test.ts`

## Known Stubs

None — all data flows are wired to real implementations. The `album` field is `null` for playlist tracks per D-13 (Phase 4 will populate it for album sources).

## Threat Flags

None — no new network endpoints, auth paths, or schema changes beyond what was planned. The path-traversal guard (T-3-02) is implemented at both directory and per-track levels.

## Self-Check

### Created files exist:
- src/modules/server/downloader/repository.ts: FOUND
- src/modules/server/downloader/repository.test.ts: FOUND
- src/modules/server/downloader/DownloadRunner.ts: FOUND
- src/modules/server/downloader/DownloadRunner.test.ts: FOUND
- src/modules/server/downloader/handler.ts: FOUND

### Commits exist:
- 14fe6a9: FOUND (Task 1)
- 231c9d5: FOUND (Task 2)
- 338522f: FOUND (Task 3)
- 5885419: FOUND (Task 4)
- bbbcd22: FOUND (Task 5)

## Self-Check: PASSED
