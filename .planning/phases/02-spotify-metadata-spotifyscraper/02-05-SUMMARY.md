---
phase: 02-spotify-metadata-spotifyscraper
plan: "05"
subsystem: scheduler-wiring-webhook-ui
tags: [scheduler, syncrunner, webhook, discord, sync-now, ui, concurrency-guard, tdd, security]
dependency_graph:
  requires: [02-02, 02-04]
  provides: [real-scheduler-execution, webhook-truncation-rendering, sync-now-button]
  affects: [PlaylistScheduler, WebhookMessageFormatter, PlaylistConfigCard, library-detail-route]
tech_stack:
  added: []
  patterns:
    - Thin guard-wrapper delegation pattern (scheduler → SyncRunner)
    - Injectable dependency pattern (SyncRunner via constructor deps)
    - JSX slot prop pattern (syncAction?: JSX.Element parallel to deleteDialog)
    - T-2-05 sanitization: .replace(/\s+/g," ").slice(0,200) for webhook stderr output
key_files:
  created:
    - src/modules/server/webhooks/service.test.ts
  modified:
    - src/modules/server/scheduler/PlaylistScheduler.ts
    - src/modules/server/scheduler/PlaylistScheduler.test.ts
    - src/modules/server/webhooks/service.ts
    - src/modules/client/playlist/components/playlist-config-card.tsx
    - src/routes/library_.$playlistId.tsx
    - server/plugins/scheduler.ts
    - server/plugins/events.ts
decisions:
  - "Scheduler error handling: added try/catch in executePlaylistSync to prevent unhandled rejections from fire-and-forget void calls — SyncRunner.run should self-terminate but guard releases must be guaranteed regardless"
  - "getScheduler() signature changed from (logger?) to (deps?: {logger?,syncRunner?}) — caller plugins updated accordingly"
metrics:
  duration_minutes: 10
  completed_date: "2026-04-24"
  tasks_completed: 3
  tasks_total: 3
  files_modified: 8
  tests_added: 27
---

# Phase 2 Plan 05: Wiring — Scheduler, Webhook Formatter, Sync-now Button Summary

Phase 2 end-to-end wiring: replaced the no-op scheduler stub with a guard-wrapped SyncRunner delegation, extended the Discord webhook formatter to render trackCount/truncation/failureReason with T-2-05 stderr sanitization, and unhid the Sync-now button via a new `syncAction` JSX slot on `PlaylistConfigCard`.

## What Was Built

### Task 1: Scheduler stub → SyncRunner delegation (TDD)

`PlaylistScheduler.executePlaylistSync` is now a thin guard-wrapped `this.syncRunner.run(source)` call. The scheduler owns only cron scheduling and the `runningPlaylists` concurrency guard (D-06). All event emissions, DB writes, and subprocess lifecycle belong to SyncRunner (no `getEventBus()` calls remain in the scheduler file — W-2 guardrail enforced).

SyncRunner is injectable via `new PlaylistScheduler({ syncRunner })` for testability. The `getScheduler()` factory accepts the same deps shape.

5 new tests added covering: delegation, manual+scheduled race guard (D-06), sequential calls, throw cleanup (guard not poisoned), and no-direct-emit assertion.

### Task 2: WebhookMessageFormatter — truncation + failureReason + T-2-05 (TDD)

`formatCompleted` now appends `\n> N tracks` and `\n> ⚠️ possibly truncated (...)` when `trackCount`/`truncationSuspected` fields are present (D-11).

`formatFailed` now appends `\n> reason: \`${failureReason}\`` when the enum is present (D-09), and sanitizes the error string via `.replace(/\s+/g, " ").slice(0, 200)` (T-2-05) — collapsing multi-line stacktraces to a single bounded line before sending to Discord.

6 REQUIRED tests in `service.test.ts` (W-3), including a T-2-05 regression test that passes a >200-char multi-line Python traceback through the formatter and asserts the rendered body is ≤200 chars with no newlines.

### Task 3: Sync-now button (non-TDD)

`PlaylistConfigCard` gains `syncAction?: JSX.Element` — an optional slot rendered before `deleteDialog` in the header action cluster. Existing callers with no `syncAction` continue to work unchanged.

`library_.$playlistId.tsx` populates the slot with a `Button` wired to `triggerSync()` (existing server fn → `scheduler.triggerManualSync` → SyncRunner). The button is disabled while in-flight (`isSyncing()`) or when `playlist().status !== "active"`. On success, the loader is invalidated to refresh invocation history.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Added error catch in executePlaylistSync to prevent unhandled rejections**
- **Found during:** Task 1 GREEN phase — fire-and-forget `void this.executePlaylistSync(source)` produced unhandled Promise rejections in vitest when the injected mock runner threw
- **Issue:** The plan's `void` fire-and-forget pattern has no rejection handler; if `syncRunner.run` throws unexpectedly, Node emits an `UnhandledPromiseRejection` warning (and vitest treats it as a test error)
- **Fix:** Added `catch(err)` inside `executePlaylistSync`'s try/finally: logs the error and falls through to `finally` so the guard is always released. SyncRunner.run is expected to self-handle errors (Pitfall 8), but the catch is a safety net
- **Files modified:** `src/modules/server/scheduler/PlaylistScheduler.ts`
- **Commit:** 1ade7f4

**2. [Rule 1 - Bug] Updated getScheduler() signature and caller plugins**
- **Found during:** Task 1 typecheck — `server/plugins/events.ts` and `server/plugins/scheduler.ts` called `getScheduler(logger)` passing an `AppLogger` directly, but the new signature is `getScheduler(deps?: { logger?, syncRunner? })`
- **Fix:** Updated both plugins to `getScheduler({ logger: schedulerLogger })`
- **Files modified:** `server/plugins/events.ts`, `server/plugins/scheduler.ts`
- **Commit:** 1ade7f4

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The Sync-now button reuses the existing `triggerPlaylistSyncServerFn` server function — not a new attack surface (T-2-04 analysis in plan's threat model applies; SyncRunner's `isValidPlaylistUrl` gate is the server-side guard). T-2-05 mitigation is implemented and regression-tested.

## Self-Check: PASSED

All key files found:
- src/modules/server/scheduler/PlaylistScheduler.ts
- src/modules/server/scheduler/PlaylistScheduler.test.ts
- src/modules/server/webhooks/service.ts
- src/modules/server/webhooks/service.test.ts
- src/modules/client/playlist/components/playlist-config-card.tsx
- src/routes/library_.$playlistId.tsx

All task commits present:
- 1ade7f4: feat(02-05): replace scheduler stub with SyncRunner delegation + race-guard tests
- 8b90f80: feat(02-05): extend WebhookMessageFormatter with trackCount, truncation, failureReason + T-2-05 tests
- cb9b0e5: feat(02-05): unhide Sync-now button via PlaylistConfigCard syncAction slot (D-06)
