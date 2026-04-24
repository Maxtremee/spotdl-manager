---
phase: 02-spotify-metadata-spotifyscraper
plan: 02
subsystem: events/schema + client validation + env
tags: [events, schema, zod, validation, ssrf-guard, env, tdd]
dependency_graph:
  requires: []
  provides:
    - FailureReasonSchema (z.enum of 5 locked failure reasons)
    - PlaylistSyncCompletedEventSchema.payload.truncationSuspected
    - PlaylistSyncCompletedEventSchema.payload.trackCount
    - PlaylistSyncFailedEventSchema.payload.failureReason
    - env.PYTHON_BIN optional server env var
  affects:
    - src/modules/server/events/schema.ts (downstream: Plan 03 imports FailureReasonSchema, Plan 04 SyncRunner emits new fields, Plan 05 webhook formatter reads them)
    - src/env.ts (downstream: Plan 03 bridge reads env.PYTHON_BIN)
tech_stack:
  added: []
  patterns:
    - Zod additive schema extension (new optional fields preserve backward compat)
    - TDD: RED/GREEN cycle for both tasks (test first, then implementation)
    - Biome formatting enforced on new test files
key_files:
  created:
    - src/modules/server/events/schema.test.ts
    - src/modules/client/playlist/schema/create-playlist-form.test.ts
  modified:
    - src/modules/server/events/schema.ts
    - src/env.ts
decisions:
  - FailureReasonSchema enum order matches D-09 in 02-CONTEXT.md exactly (invalid_url, not_found, parse_error, network_error, python_crash)
  - PYTHON_BIN declared without default — bridge (Plan 03) owns the default path (scraper/.venv/bin/python)
  - http:// protocol documented as accepted in Phase 2; protocol hardening is out of scope until Phase 5
  - schema.test.ts formatted with Biome after creation (deviation style fix)
metrics:
  duration: ~5 minutes
  completed: "2026-04-24T11:55:14Z"
  tasks_completed: 3
  files_created: 2
  files_modified: 2
---

# Phase 2 Plan 02: Event Schema Extensions + URL Validator Test Matrix Summary

**One-liner:** Zod event-schema extensions (FailureReasonSchema enum + truncationSuspected/trackCount/failureReason optional fields) with TDD-driven test coverage and PYTHON_BIN env escape hatch.

## What Was Built

### Task 1: Event schema extensions (TDD)

Extended `src/modules/server/events/schema.ts` with three additive changes:

1. New `FailureReasonSchema` z.enum with exactly 5 values locked by D-09: `invalid_url`, `not_found`, `parse_error`, `network_error`, `python_crash`. Exported with companion `FailureReason` type alias.
2. `PlaylistSyncCompletedEventSchema.payload` gains two optional fields: `truncationSuspected: z.boolean().optional()` and `trackCount: z.number().int().nonnegative().optional()` (D-10/D-11).
3. `PlaylistSyncFailedEventSchema.payload` gains `failureReason: FailureReasonSchema.optional()` (D-09).

All new fields are `.optional()` — existing emitters (Phase 1 scheduler stub) validate without modification (backward compatibility preserved).

Created `src/modules/server/events/schema.test.ts` (92 lines) with 9 behaviors: accept/reject matrix for truncationSuspected, trackCount (nonnegative int constraint), and failureReason enum values including the "unknown" reject case and backward-compat (missing field) accept case.

### Task 2: CreatePlaylistFormSchema URL test matrix (TDD)

Created `src/modules/client/playlist/schema/create-playlist-form.test.ts` (146 lines) with a 10-case accept/reject matrix:

- Accepts: playlist URL, playlist URL with query string, album URL (Phase 4 forward-compat)
- Rejects: `evil.example.com` (SSRF T-2-04), `api.open.spotify.com` (subdomain — exact hostname match enforced), `/artist/` path, `/track/` path (Phase 1 D-11 removal preserved), bare string, empty string
- Documents: `http://` is accepted in Phase 2 scope (protocol hardening is out of scope)

Schema was NOT modified — the existing validator already satisfies all cases. Test matrix is documentation + regression guard.

### Task 3: PYTHON_BIN env var

Added `PYTHON_BIN: z.string().min(1).optional()` to the server block in `src/env.ts`. The bridge (Plan 03) reads `env.PYTHON_BIN ?? "scraper/.venv/bin/python"`. `min(1)` prevents empty-string ambiguity; `emptyStringAsUndefined: true` already set globally handles `PYTHON_BIN=""` gracefully.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `66628d5` | feat | extend event schemas with FailureReason enum + truncation fields |
| `920f0b4` | test | add URL accept/reject matrix for CreatePlaylistFormSchema (SCRAPE-01, T-2-04) |
| `e4de999` | feat | add optional PYTHON_BIN server env var |
| `080e22a` | style | apply Biome formatting to schema.test.ts |

## Verification

- `pnpm test`: 81 tests pass (6 test files)
- `pnpm typecheck`: clean (0 errors)
- All acceptance criteria grep checks pass
- Biome formatting applied to new test files (pre-existing errors in other files are out of scope)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing] Biome format error in schema.test.ts**
- **Found during:** Post-task verification (`pnpm check`)
- **Issue:** New test file had a minor formatting deviation (function signature line wrap) that Biome flagged as a format error
- **Fix:** Ran `biome format --write` on the file; added a separate `style(02-02)` commit
- **Files modified:** `src/modules/server/events/schema.test.ts`
- **Commit:** `080e22a`

## Known Stubs

None. This plan is contract-only (schemas + tests + env var). No UI or data-flow stubs introduced.

## Threat Flags

No new network endpoints, auth paths, file access patterns, or schema changes at trust boundaries beyond what the plan's threat model covers (T-2-03, T-2-04 mitigations implemented as specified).

## Self-Check: PASSED

All created/modified files exist on disk. All task commits verified in git log.
