---
phase: 01-schema-reset-spotdl-removal
plan: 04
subsystem: scheduler
tags: [croner, event-bus, zod, vitest, stub, cleanup, phase-1]

# Dependency graph
requires:
  - phase: 01-schema-reset-spotdl-removal
    provides: "SourceRow type + schema.sources (Plan 01-01); deletion of src/modules/server/spotdl/ directory (Plan 01-03)"
provides:
  - "PlaylistScheduler.ts rewritten as Phase-1 event-emitting no-op stub (D-01/D-02/D-03)"
  - "Cron ticks emit playlist.sync.started → playlist.sync.completed via event bus with no DB writes"
  - "Concurrency guard preserved: runningPlaylists set entered before first await"
  - "Pitfall 2 duration guard: Math.max(1, elapsedMs) keeps Zod z.number().positive() green"
  - "triggerManualSync preserved per Pitfall 5 (Phase 3 re-enables UI Run Now button)"
  - "PlaylistScheduler.test.ts rewritten with 21 specs; no spotdl/invocation mocks"
  - "Last consumer of src/modules/server/spotdl/ module closed — zero grep hits repo-wide"
affects:
  - 01-05-db-reset-script
  - phase-03-scrape-and-match

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Event-emitting no-op stub for scheduled jobs: emit lifecycle started/completed with no work body to keep downstream handlers exercised"
    - "Zod-.positive()-aware duration guard (Math.max(1, elapsed)) at emit sites"
    - "Hoisted-mock event-bus pattern in vitest: vi.hoisted + vi.mock(\"../events\") returning { getEventBus: () => ({ emit: mockFn }) }"

key-files:
  created: []
  modified:
    - "src/modules/server/scheduler/PlaylistScheduler.ts"
    - "src/modules/server/scheduler/PlaylistScheduler.test.ts"

key-decisions:
  - "Stripped InvocationRepository entirely (D-03): field, import, and all .create/.update calls — no invocation rows in Phase 1"
  - "Preserved triggerManualSync public method surface (Pitfall 5) so Phase 3 can re-enable Run Now UI without re-plumbing the scheduler API"
  - "Renamed internal log fields playlistId/playlistName → sourceId/sourceName, but KEPT public schedulePlaylist/unschedulePlaylist names (external callers still use them)"
  - "Logger scope Logger.get(\"SchedulerStub\") per CONTEXT §Reusable Assets — clearly identifies no-op ticks in logs"
  - "No playlist.sync.failed / .canceled emit paths in the stub — only two outcomes: skip-on-concurrency or started+completed"

patterns-established:
  - "Stub-lifecycle event emission: two emits per tick (started + completed) with a throwaway invocationId so handlers receive valid Zod payloads"
  - "Event-bus test harness: single hoisted mockEventBusEmit with vi.mock(\"../events\") replaces ad-hoc per-emit stubs"

requirements-completed:
  - CLEANUP-01

# Metrics
duration: 7min
completed: 2026-04-24
---

# Phase 1 Plan 04: Scheduler Event-Emitting Stub Summary

**Rewrote PlaylistScheduler.ts into a Phase-1 event-emitting no-op stub (started + completed emits per tick, no DB writes, Math.max(1,…) duration guard), rewrote PlaylistScheduler.test.ts from 10 spotdl-mocked specs to 21 event-bus-only specs, and closed the last consumer of the deleted `src/modules/server/spotdl/` directory.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-04-24T09:02:55Z
- **Completed:** 2026-04-24T09:09:48Z
- **Tasks:** 2 (TDD: RED then GREEN, no refactor needed)
- **Files modified:** 2

## Accomplishments

- `PlaylistScheduler.ts` has **zero** spotdl/invocation imports — `grep -rn "from \"~/modules/server/spotdl\|from \"\.\./spotdl" src/` returns no results repo-wide
- Stub `executePlaylistSync` fires exactly **two** events per non-skipped tick: `playlist.sync.started` then `playlist.sync.completed`. Verified by `expect(mockEventBusEmit).toHaveBeenCalledTimes(2)` in the test
- `duration` payload is always `Math.max(1, Date.now() - startedAt)` — Zod `z.number().positive()` never trips, downstream webhook/metrics/duration-warning handlers see valid events every tick
- `runningPlaylists` concurrency set entered **before** first `await` → back-to-back `cb()` calls fire 2 emits total, not 4 (concurrency guard test green)
- `loadSpotdlSettings` method + `invocationRepository` + `spotdlRepository` + `invocator` fields all deleted; constructor now trivial (`this.logger = logger ?? Logger.get("SchedulerStub")`)
- `triggerManualSync` preserved per Pitfall 5 — Phase 3 plan matching SCRAPE-01 can flip the UI Run Now button back on without touching the scheduler class surface
- `PlaylistScheduler.test.ts` rewrite: 21 specs (up from ~10 that mocked spotdl), covers `intervalToCron × 4`, `schedulePlaylist × 5`, `unschedulePlaylist × 2`, `initialize × 2`, `reload × 1`, `shutdown × 1`, `executePlaylistSync stub × 4`, singleton + multi-source cases × 2

## Task Commits

Each task was committed atomically:

1. **Task 1: Rewrite PlaylistScheduler.test.ts (RED)** — `45831f8` (test) — vitest exits non-zero with `Cannot find module '../spotdl/repository'` (expected RED signal)
2. **Task 2: Rewrite PlaylistScheduler.ts + fix test-file type narrowing (GREEN)** — `24efc3b` (feat) — 21/21 tests pass; typecheck shows 0 net-new errors in scheduler files

_Note: RED→GREEN is the plan-level TDD gate. No refactor commit needed — GREEN implementation is already in final shape._

## Files Created/Modified

**Modified:**

- `src/modules/server/scheduler/PlaylistScheduler.ts` — Wholesale rewrite:
  - Deleted imports: `InvocationRepository`, `SpotdlRepository`, `SpotdlInvocator`
  - Deleted class fields: `invocator`, `invocationRepository`, `spotdlRepository`
  - Deleted method: `loadSpotdlSettings()`
  - Rewrote `executePlaylistSync()` body: now ~35 lines emitting `started` + `completed` via `getEventBus()` with concurrency guard; no DB calls
  - Rewrote `initialize()` + `reload()`: dropped `await this.loadSpotdlSettings()` line
  - Renamed `getScheduledPlaylists()` → `getScheduledSources()`; `schema.playlists` → `schema.sources`
  - Param types everywhere: `PlaylistRow` → `SourceRow`; internal vars `playlist` → `source`
  - Logger scope: `Logger.get("PlaylistScheduler")` → `Logger.get("SchedulerStub")`
  - Preserved: `schedulePlaylist`, `unschedulePlaylist`, `shutdown`, `getScheduledCount`, `isScheduled`, `isRunning`, `getScheduler` singleton, `intervalToCron`, `triggerManualSync` (public API surface unchanged)
  - File shrunk from 409 to 312 lines

- `src/modules/server/scheduler/PlaylistScheduler.test.ts` — Wholesale rewrite:
  - Dropped mocks: `vi.mock("../spotdl/repository")`, `vi.mock("../spotdl/SpotdlInvocator")`, `vi.mock("../invocation/repository")`, `mockSpotdlRun`, `mockSpotdlGetSettings`, `mockInvocationCreate`, `mockInvocationUpdate`
  - Added mock: `vi.mock("../events")` returning `{ getEventBus: () => ({ emit: mockEventBusEmit }) }`
  - Renamed helper: `createMockPlaylist` → `createMockSource` (SourceRow shape, no `flags_*`)
  - Fixed `schema.playlists` → `schema.sources` in the db mock
  - Typed `mockEventBusEmit` to accept emit envelope so `.mock.calls[i][0]` has a proper type
  - New test group `executePlaylistSync (stub)` with 4 specs: started+completed emit count, started payload Zod parse, completed positive-duration + exitCode, concurrency guard
  - Old `executePlaylistSync × 3` group (create-invocation, concurrent-prevention, error-handling) removed — obsolete under D-03
  - File grew from 465 to 396 lines (lost 100 lines of spotdl mocks, gained stub-specific assertions)

## Event payload shape (example emitted by the stub)

```jsonc
// 1st emit per tick
{
  "type": "playlist.sync.started",
  "payload": {
    "playlistId":   "<source.id>",                                  // e.g. "source-1"
    "playlistName": "<source.name>",
    "invocationId": "a1b2c3d4-...-...",                             // randomUUID(), throwaway (no DB row)
    "sourceUrl":    "https://open.spotify.com/playlist/...",
    "outputDir":    "/music/downloads"
  }
}

// 2nd emit per tick (fires immediately after — no work body)
{
  "type": "playlist.sync.completed",
  "payload": {
    "playlistId":   "<source.id>",
    "playlistName": "<source.name>",
    "invocationId": "a1b2c3d4-...-...",                              // same UUID as started
    "duration":     1,                                                // Math.max(1, elapsedMs) — never 0
    "exitCode":     0,
    "summary":      "Phase 1 stub — no engine attached"
  }
}
```

No `playlist.sync.failed` or `playlist.sync.canceled` emit paths exist in the stub — the only two outcomes per tick are (a) skip when `runningPlaylists` already contains `source.id` or (b) started + completed.

## Rewritten test file coverage

21 `it()` specs total:

| Group                              | Count |
| ---------------------------------- | ----- |
| `intervalToCron`                   | 4     |
| `schedulePlaylist`                 | 5     |
| `unschedulePlaylist`               | 2     |
| `initialize`                       | 2     |
| `reload`                           | 1     |
| `shutdown`                         | 1     |
| `executePlaylistSync (stub)`       | 4     |
| `getScheduler singleton`           | 1     |
| `multiple sources w/ diff schedules` | 1   |
| **Total**                          | **21** |

The 4 new stub-specific specs assert:

1. Exactly **2** emits per tick (started, then completed) — enforces D-03 (no DB writes would imply additional observable surface).
2. `playlistSyncStartedEventSchema.shape.payload.parse(started.payload)` doesn't throw, and the payload carries correct `playlistId`/`playlistName`/`sourceUrl`/`outputDir`.
3. `playlistSyncCompletedEventSchema.shape.payload.parse(completed.payload)` doesn't throw; `duration > 0`; `exitCode === 0` (Pitfall 2 guard).
4. Back-to-back `cb()` + `cb()` on the same cron instance emits exactly 2 events total (not 4) — concurrency guard fires.

## Decisions Made

- **Stripped `InvocationRepository` entirely** (D-03 lock): field, import, and all `.create`/`.update` calls gone. Phase 3 reworks invocations semantics per CONTEXT §Deferred Ideas; no preemptive churn.
- **Preserved `triggerManualSync` public method surface** (Pitfall 5): the UI Run Now button is hidden (D-04, Plan 01-02), but the server fn remains callable. Harmless during Phase 1 (stub body = no DB writes, no external calls).
- **Kept public method names** `schedulePlaylist` / `unschedulePlaylist`: external callers (plugins, server fns) still reference them. Only param types + internal var names renamed.
- **Logger scope `"SchedulerStub"`** per CONTEXT §Reusable Assets: makes Phase-1 stub ticks identifiable in the log stream vs. the Phase-3 engine that will replace this class.
- **`Math.max(1, Date.now() - startedAt)` duration guard** (Pitfall 2): `PlaylistSyncCompletedEventSchema` uses `z.number().positive()`, which rejects `0`. A same-tick synchronous stub can legitimately measure `0 ms`. Flooring to `1 ms` keeps the Zod parse green and downstream handlers subscribed.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript narrowed `mockEventBusEmit.mock.calls[i]` to empty tuple**

- **Found during:** Task 2 (typecheck verification after GREEN tests passed)
- **Issue:** The hoisted mock `vi.fn(() => Promise.resolve())` had no declared parameter, so `TypeScript` inferred `calls` as `[][]` — indexing `calls[0][0]` triggered `TS2493: Tuple type '[]' of length '0' has no element at index '0'`. Additionally, the concurrency test's `const cb = mockCronInstances.get("0 6 * * *")?.callback` produced `cb: any | undefined`, and `cb()` failed `TS18048: cb is possibly 'undefined'`.
- **Fix:** Typed the hoisted mock as `vi.fn((_event: { type: string; payload: any }) => Promise.resolve())` so `.mock.calls[i][0]` narrows to the envelope. In the concurrency test, pulled the cron instance out with `expect(cronInstance).toBeDefined()` + `cronInstance!.callback` non-null assertion.
- **Files modified:** `src/modules/server/scheduler/PlaylistScheduler.test.ts`
- **Verification:** `pnpm typecheck` reports 0 errors under `src/modules/server/scheduler/**`; 21/21 tests still pass.
- **Committed in:** `24efc3b` (folded into Task 2 commit — the errors only surfaced once the GREEN source rewrite landed and tests could actually reach the emit assertions).

---

**Total deviations:** 1 auto-fixed (1 bug in a file this plan authored)
**Impact on plan:** Zero scope creep. Both edits were inside the test file introduced by Task 1; no other files touched beyond the plan's `files_modified` list.

## Issues Encountered

**Worktree had no `node_modules`** at executor start — fresh worktree. Resolved with `pnpm install` (~5s). No code changes, not a deviation.

**Full-repo `pnpm typecheck` still shows 12 errors**, but all 12 are documented in `.planning/phases/01-schema-reset-spotdl-removal/deferred-items.md` as pre-existing baseline + Wave-1 transients owned by sibling plans (01-01 mapper.ts guard, 01-02 playlist-table/playlist-header narrowing, 01-03 server/playlist/functions.ts flag block, plus two pre-existing `file-upload.tsx` + `library.tsx` drifts). **Net-new typecheck errors introduced by this plan: 0**. All Plan-04-owned files (`PlaylistScheduler.ts`, `PlaylistScheduler.test.ts`) are typecheck-clean.

The plan's acceptance criterion "pnpm typecheck exits 0 repo-wide" assumed Wave 1 had fully converged on typecheck. In practice Wave 1 merged with the documented transients still open (see the Deferred Items tracker); this plan closed its own share of the spotdl-import surface, which was the load-bearing Wave-2 work. A Wave-3 plan (01-05 or follow-up) will close the residual 01-01/01-02/01-03 Wave-1 transients and reach repo-wide clean typecheck.

## Verification Evidence

```bash
$ pnpm exec vitest run src/modules/server/scheduler/PlaylistScheduler.test.ts
Test Files  1 passed (1)
     Tests  21 passed (21)

$ pnpm test
Test Files  4 passed (4)
     Tests  62 passed (62)

$ grep -rn 'from "~/modules/server/spotdl\|from "../spotdl\|from "\./spotdl' src/
(no output)

$ grep -c "getEventBus()\.emit\|eventBus\.emit" src/modules/server/scheduler/PlaylistScheduler.ts
2

$ grep -c "InvocationRepository\|invocationRepository" src/modules/server/scheduler/PlaylistScheduler.ts
0

$ grep -c "Math\.max(1," src/modules/server/scheduler/PlaylistScheduler.ts
4   # 1 on the duration line + references in doc comments

$ grep -c "^\s*it(" src/modules/server/scheduler/PlaylistScheduler.test.ts
21
```

## Smoke-test status

`pnpm dev` path not exercised in this executor run (worktree agent; dev server would block on port 3000 and the parent Nitro/plugins boot sequence requires the full merged Wave-1 + Wave-2 tree to typecheck cleanly end-to-end). The scheduler-stub behavior is fully exercised by the unit test harness:

- Cron tick path: `createMockSource → scheduler.schedulePlaylist → mockCronInstances.get(pattern)?.callback()` executes the stub body end-to-end against the mocked event bus.
- "Log line fires + zero invocation rows" assertion equivalent: `mockEventBusEmit` is called exactly 2× with valid Zod payloads AND the `InvocationRepository` is never imported — so a DB write path physically does not exist in this code.

Phase-1 final smoke (dev server + SQLite inspection) belongs to Plan 01-05 after the DB reset script lands.

## Note for Phase 3 planner

- **`triggerManualSync` is intentionally preserved.** Phase 3 will replace the `executePlaylistSync` body with the real engine (scrape + yt-dlp); the public surface stays. Re-enable the UI "Run Now" button in the plan matching SCRAPE-01 (un-hide the `<Button>` in `src/modules/client/playlist/components/playlist-config-card.tsx` that Plan 01-02 removed).
- **The stub's two-emit pattern (`started` → `completed` with no body)** is the contract downstream handlers will continue to expect. Phase 3's real engine should continue to emit `started` up-front and either `completed`, `failed`, or `canceled` depending on outcome — re-introducing the three-outcome switch that existed pre-Phase-1.
- **`invocationId` is a throwaway UUID** in the stub. Phase 3 re-introduces an `invocations` row keyed on this ID — emit the `started` event AFTER the row is inserted so downstream subscribers can join on it.

## Next Phase Readiness

- **Wave 2 (this plan) is complete.** Scheduler stub is live; cron ticks now emit valid Zod events through the bus with no DB writes.
- **Plan 01-05 (DB reset script, Wave 3)** prerequisites met — scheduler no longer writes to `invocations`, so the DB reset script can drop & recreate without racing stub ticks.
- **Phase 3 (scrape + match) prerequisites:** the scheduler's public method surface (`schedulePlaylist`, `unschedulePlaylist`, `triggerManualSync`, `initialize`, `reload`, `shutdown`, `getScheduler`) is stable and documented. Only `executePlaylistSync`'s body changes in Phase 3.
- **Residual Wave-1 typecheck transients** (documented in `deferred-items.md`) will need to close before a Phase-1 completion sweep. They do not block Wave 2 or Wave 3 execution.

## TDD Gate Compliance

- **RED gate:** `test(01-04)` commit `45831f8` — vitest fails with module-resolution error (`Cannot find module '../spotdl/repository'`), confirming test preceded source rewrite.
- **GREEN gate:** `feat(01-04)` commit `24efc3b` — 21/21 assertions pass; stub contract met.
- **REFACTOR gate:** Not needed. GREEN implementation is already in final shape (direct translation of CONTEXT §D-01/D-02/D-03 + RESEARCH Example 3).

## Known Stubs

This entire plan **is** a stub — the `executePlaylistSync` body is a deliberate Phase-1 no-op per CONTEXT §D-01 / §D-02 / §D-03. This is not an "accidental stub" in the `deferred-items.md` sense — it's the locked Phase-1 contract, flagged for Phase 3 re-implementation above.

No other stubs introduced.

## Self-Check: PASSED

Verified on 2026-04-24:

- File `src/modules/server/scheduler/PlaylistScheduler.ts` — EXISTS (312 lines)
- File `src/modules/server/scheduler/PlaylistScheduler.test.ts` — EXISTS (396 lines)
- File `.planning/phases/01-schema-reset-spotdl-removal/01-04-SUMMARY.md` — will exist after this Write
- Commit `45831f8` (Task 1, test) — FOUND in `git log --oneline -5`
- Commit `24efc3b` (Task 2, feat) — FOUND in `git log --oneline -5`
- `pnpm exec vitest run src/modules/server/scheduler/PlaylistScheduler.test.ts` — 21/21 PASS
- `pnpm test` — 62/62 PASS across all suites
- `grep -rn 'from "~/modules/server/spotdl\|from "../spotdl' src/` — 0 matches (last spotdl consumer closed)
- `grep -c "getEventBus()\.emit" src/modules/server/scheduler/PlaylistScheduler.ts` — 2 (started + completed)
- `grep -c "InvocationRepository\|invocationRepository" src/modules/server/scheduler/PlaylistScheduler.ts` — 0
- `grep -c "Math\.max(1," src/modules/server/scheduler/PlaylistScheduler.ts` — ≥1 (duration guard present)

---
*Phase: 01-schema-reset-spotdl-removal*
*Completed: 2026-04-24*
