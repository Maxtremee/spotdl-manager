---
phase: 02-spotify-metadata-spotifyscraper
plan: 03
subsystem: scraper-node-bridge
tags: [scraper, bridge, subprocess, zod, child-process, tdd, security]

dependency_graph:
  requires:
    - src/modules/server/events/schema.ts (FailureReasonSchema — from Plan 02)
    - src/env.ts (PYTHON_BIN — from Plan 02)
    - scraper/scraper.py (Python subprocess — from Plan 01)
  provides:
    - src/modules/server/scraper/schema.ts (PythonEnvelopeSchema, PythonTrackSchema, PythonErrorSchema, ScrapeRequest, PYTHON_CRASH_PREFIX)
    - src/modules/server/scraper/SpotifyScraperBridge.ts (SpotifyScraperBridge class)
    - src/modules/server/scraper/index.ts (barrel exports)
  affects:
    - Plan 04 (SyncRunner imports SpotifyScraperBridge + PYTHON_CRASH_PREFIX for crash detection)

tech_stack:
  added: []
  patterns:
    - node:child_process spawn in argv-form (shell:false, stdio:piped) — T-2-01/T-2-02 mitigated
    - stdout buffered in Buffer[] chunks, parsed only on 'close' event (Pitfall 2 prevention)
    - node:events once() for clean async close-event await
    - PythonEnvelopeSchema.safeParse for Zod 4 validated envelope
    - PYTHON_CRASH_PREFIX constant exported as single source of truth (W-1 pattern)
    - python_crash synthesis via "network_error" placeholder type (SyncRunner reclassifies in Plan 04)
    - stderr truncation at 500 chars in synthesized message (T-2-06 DoS mitigation)
    - TDD RED/GREEN cycle — test committed before implementation

key_files:
  created:
    - src/modules/server/scraper/schema.ts
    - src/modules/server/scraper/SpotifyScraperBridge.ts
    - src/modules/server/scraper/SpotifyScraperBridge.test.ts
    - src/modules/server/scraper/index.ts
  modified: []

decisions:
  - "W-1 honored: PYTHON_CRASH_PREFIX exported from schema.ts; bridge imports it (no raw string literal); test asserts startsWith(PYTHON_CRASH_PREFIX)"
  - "Zod 4 compat: PythonErrorSchema error logging uses parsed.error.message not .errors (Zod 4 removed .errors array)"
  - "cover_art_url uses z.string().min(1).nullable() (not .url()) — Pitfall 7 workaround for Spotify CDN URLs"
  - "python_crash synthesis uses placeholder type 'network_error' — PythonErrorSchema is 4-member only; SyncRunner reclassifies in Plan 04"
  - "Task 1 barrel (index.ts) initially exported schema only; bridge export added in Task 2 commit to keep Task 1 typecheck clean"

metrics:
  duration_minutes: 12
  completed_date: "2026-04-24T12:07:08Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 0
---

# Phase 02 Plan 03: SpotifyScraperBridge — Node subprocess bridge Summary

**One-liner:** Node-side Python bridge spawning scraper/scraper.py via argv-form child_process.spawn, piping JSON through stdin, buffering stdout, and synthesizing python_crash envelopes — validated by 10 Zod-schema unit tests against a mocked child_process.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create PythonEnvelopeSchema and scraper barrel | ab4452a | scraper/schema.ts, scraper/index.ts |
| 2 (RED) | Failing tests for SpotifyScraperBridge (10 behaviors) | de0ffd8 | scraper/SpotifyScraperBridge.test.ts |
| 2 (GREEN) | Implement SpotifyScraperBridge + update barrel | 42b8a79 | scraper/SpotifyScraperBridge.ts, scraper/index.ts |

## What Was Built

### src/modules/server/scraper/schema.ts (67 lines)

Zod envelope contract for the Python → Node stdout channel:

- `PYTHON_CRASH_PREFIX = "python crash:"` — exported constant (W-1). Bridge and SyncRunner (Plan 04) both import this; no raw string literal duplicated.
- `PythonErrorSchema` — 4-member enum (`invalid_url`, `not_found`, `parse_error`, `network_error`); excludes `python_crash` because that is synthesized Node-side.
- `PythonTrackSchema` — per-track shape: `spotify_track_id: z.string().min(1)` (not `.url()`), `title`, `artist`, `duration_ms: z.number().int().nonnegative()`, `position: z.number().int().nonnegative()`.
- `PythonEnvelopeSchema` — `{ tracks: z.array(PythonTrackSchema).nullable(), cover_art_url: z.string().min(1).nullable(), error: PythonErrorSchema.nullable() }`. `cover_art_url` uses `min(1)` not `.url()` (Pitfall 7 — Zod 4's URL parser tightened and rejects some Spotify CDN URLs).
- `ScrapeRequest` interface — `{ url: string; source_type: "playlist" }`.
- Re-exports `FailureReasonSchema` + `FailureReason` from `../events/schema` for consumer convenience.

### src/modules/server/scraper/SpotifyScraperBridge.ts (136 lines)

Class wrapping `node:child_process.spawn`:

- Constructor: `(pythonBin?, scriptPath?, timeoutMs?, logger?)` — defaults to `env.PYTHON_BIN ?? "scraper/.venv/bin/python"`, `"scraper/scraper.py"`, `30_000`.
- `async fetchPlaylist(url: string): Promise<PythonEnvelope>`:
  1. `spawn(pythonBin, [scriptPath], { stdio: ["pipe", "pipe", "pipe"], timeout: timeoutMs })` — URL NEVER in argv; `shell` not set (Node default `false`).
  2. Accumulate stdout/stderr `Buffer[]` chunks via `on("data")`.
  3. `child.stdin.end(JSON.stringify({ url, source_type: "playlist" }) + "\n")` — closes stdin so Python's `sys.stdin.read()` unblocks.
  4. `await once(child, "close")` — parse ONLY after close fires (prevents mid-write parse errors, Pitfall 2).
  5. If stdout non-empty: `JSON.parse` + `PythonEnvelopeSchema.safeParse` — returns on success.
  6. Otherwise synthesizes python_crash envelope: `{ tracks: null, cover_art_url: null, error: { type: "network_error", message: \`${PYTHON_CRASH_PREFIX} exit=... stderr=...\` } }`. stderr sliced to `STDERR_SLICE_LIMIT` (500 chars).

Security properties documented in class-level JSDoc (T-2-01, T-2-02, T-2-06).

### src/modules/server/scraper/SpotifyScraperBridge.test.ts (305 lines)

10 unit tests against `vi.mock("node:child_process")` — no real Python spawn:

| Test | Behavior |
|------|---------|
| 1 | Happy path: valid envelope + exit 0 → returns parsed tracks |
| 2 | Handled error (`not_found`): envelope returned verbatim, no crash synthesis |
| 3 | stdin.end called with `{ url, source_type: "playlist" }` JSON |
| 4 | Promise does NOT resolve on mid-stream data events (waits for close) |
| 5 | Non-zero exit + empty stdout → crash envelope with `exit=2` in message |
| 6 | Malformed JSON on stdout → crash envelope synthesized |
| 7 | 2000-char stderr → message's stderr slice capped at 500 chars |
| 8 | spawn called with argv-form; `shell !== true`; `stdio: ["pipe","pipe","pipe"]` |
| 9 | `timeout: 30_000` passed to spawn options |
| 10 (W-1) | Synthesized message `.startsWith(PYTHON_CRASH_PREFIX)` — imported constant honored |

### src/modules/server/scraper/index.ts (barrel)

Exports all from `./schema` and `./SpotifyScraperBridge`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Zod 4 compatibility: `parsed.error.errors` → `parsed.error.message`**
- **Found during:** Task 2 GREEN phase (`pnpm typecheck`)
- **Issue:** Zod 4 removed the `.errors` array from `ZodError`; the property is now embedded in `.message` (JSON stringified). Referencing `parsed.error.errors` caused `TS2339: Property 'errors' does not exist`.
- **Fix:** Changed logger call from `{ validationErrors: parsed.error.errors }` to `{ validationErrors: parsed.error.message }`.
- **Files modified:** `SpotifyScraperBridge.ts`
- **Commit:** 42b8a79

**2. [Rule 2 - Formatting] Biome format applied to bridge and test files**
- **Found during:** Task 2 post-implementation Biome check
- **Issue:** Import order in bridge (env import before logger) and line-length wrapping in test needed Biome's auto-format.
- **Fix:** `pnpm exec biome check --write` applied 2 files, fixed 2 format errors. 10 warnings remain (`as any` in test mocks) — same pre-existing warning pattern as `PlaylistScheduler.test.ts` in the codebase.
- **Files modified:** `SpotifyScraperBridge.ts`, `SpotifyScraperBridge.test.ts`
- **Commit:** 42b8a79 (included in GREEN commit)

## TDD Gate Compliance

- RED commit `de0ffd8` (`test(02-03)`) precedes GREEN commit `42b8a79` (`feat(02-03)`) — gate sequence VALID.
- All 10 tests failed in RED phase (module not found — implementation absent).
- All 10 tests pass in GREEN phase.
- No REFACTOR commit needed — code was clean after Biome format.

## Known Stubs

None. All schema exports are fully typed and functional. The `"network_error"` type in the synthesized crash envelope is a documented placeholder (not a stub) — Plan 04's SyncRunner is specified to reclassify it to `"python_crash"` via the `PYTHON_CRASH_PREFIX` detection pattern.

## Threat Flags

No new network endpoints, auth paths, or schema changes beyond what the plan's `<threat_model>` covers.

Threat mitigations implemented as specified:
- T-2-01: URL in stdin JSON, never argv — unit test 8 asserts it
- T-2-02: `shell: true` never set — unit test 8 + Biome grep criterion asserts it
- T-2-03: `PythonEnvelopeSchema.safeParse` rejects malformed envelopes
- T-2-05: stderr goes to Pino logger only; envelope carries max 500-char slice
- T-2-06: documented in class JSDoc (accept+document per plan)

## Self-Check: PASSED

- `src/modules/server/scraper/schema.ts` exists: VERIFIED
- `src/modules/server/scraper/SpotifyScraperBridge.ts` exists: VERIFIED
- `src/modules/server/scraper/SpotifyScraperBridge.test.ts` exists: VERIFIED
- `src/modules/server/scraper/index.ts` exists: VERIFIED
- Commits ab4452a, de0ffd8, 42b8a79 exist: VERIFIED (git log --oneline -6)
- 10/10 bridge tests pass: VERIFIED (`pnpm test -- SpotifyScraperBridge`)
- 91/91 total tests pass: VERIFIED (`pnpm test`)
- typecheck clean: VERIFIED (`pnpm typecheck`)
- No raw `"python crash:"` string literal in bridge file: VERIFIED (`grep -qE '"python crash:"' ... || echo "clean"`)
- `PYTHON_CRASH_PREFIX` imported and used in bridge: VERIFIED
- `shell: true` never set: VERIFIED
