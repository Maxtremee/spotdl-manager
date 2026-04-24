---
phase: 02-spotify-metadata-spotifyscraper
verified: 2026-04-24T15:00:00Z
status: human_needed
score: 5/6
must_haves_verified: 5
must_haves_total: 6
overrides_applied: 0
re_verification: false
deferred:
  - truth: "Production Docker image builds successfully with python3 venv at /app/scraper/.venv and node:node ownership"
    addressed_in: "Phase 6"
    evidence: "Phase 6 success criteria: 'The production Dockerfile is based on a slim Node image and installs only Python + spotifyscraper (pinned version), yt-dlp, and ffmpeg — no Chromium, no Playwright browsers.' The AS builder alias gap (CR-01) is a Dockerfile structural fix that Phase 6 will address when the full Docker hardening pass occurs."
human_verification:
  - test: "Docker dev container end-to-end smoke: python3 -c 'import spotify_scraper', SCRAPER_INTEGRATION=1 pnpm test -- integration, UI add-playlist + Sync-now, DB tracks/cover_art/invocations checks"
    expected: "Python venv at /app/scraper/.venv imports spotify_scraper 2.1.5; integration test passes (or exits with network_error warning); at least 1 tracks row with state=pending appears in DB; sources.cover_art_url is non-null HTTPS CDN URL; invocations row has status=success and summary with track_count + truncation_suspected"
    why_human: "Plan 06 Task 2 is gate=blocking and was auto-approved without completion. The full end-to-end path (Dockerfile.dev build → container boot → real Python spawn → Spotify network call → DB write) requires running the Docker dev container against a live Spotify URL. Also, the production Dockerfile cannot be built at all until CR-01 (missing AS builder alias on Stage 1) is fixed — making the prod image path unverifiable programmatically."
---

# Phase 2: Spotify Metadata via spotifyscraper — Verification Report

**Phase Goal:** A configured Spotify playlist URL, on sync, fetches metadata via the `spotifyscraper` library (no auth, no Chromium) and populates the `tracks` table with pending rows carrying title, primary-artist, duration_ms, position, and cover-art URL.
**Verified:** 2026-04-24T15:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from Roadmap Success Criteria + Plan must_haves)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User can configure a Spotify playlist URL as a source (SCRAPE-01) | VERIFIED | `CreatePlaylistFormSchema` enforces `hostname === "open.spotify.com"` + `/playlist/` or `/album/` path. 10-case URL accept/reject matrix in `create-playlist-form.test.ts` (146 lines) passes. SSRF guard (T-2-04) rejects `evil.example.com` and subdomains. |
| 2 | On sync, every returned track lands in `tracks` table with spotify_track_id (from uri.split(":")[-1]), title, artist, duration_ms, position, and state=pending | VERIFIED | `scraper.py` derives `spotify_track_id` via `uri.split(":")[-1]` (line 60). `SyncRunner.run()` calls `ScraperRepository.upsertAll()` mapping `t.spotify_track_id`, `t.title`, `t.artist`, `t.duration_ms`, `t.position`. `tracks` schema has `state` defaulting to `"pending"`. 9 repo tests + 12 SyncRunner tests confirm behavior. All 128 tests pass. |
| 3 | The source's cover-art URL is captured (SCRAPE-07) | VERIFIED | `scraper.py._largest_image_url()` selects max-width image. `PythonEnvelopeSchema.cover_art_url` validates it. `ScraperRepository.upsertAll()` updates `sources.coverArtUrl` in the same transaction (D-08). `schema.ts` has `coverArtUrl` on `sources` table. |
| 4 | First-ever scrape reads all tracks top-to-bottom in order (SCRAPE-04) | VERIFIED | `_normalize()` assigns `position = enumerate index`. `upsertAll()` uses `onConflictDoUpdate` composite target `[sourceId, spotifyTrackId]` — no early-stop logic. Repository tests (Test 3) confirm position overwrites correctly. D-16 preserves rows missing from current scrape (Test 5). |
| 5 | Library limitations handled: empty `id` derived from `uri`; spotifyscraper exceptions surface as typed errors (SCRAPE-03 + SC5) | VERIFIED | `_uri_to_track_id()` in `scraper.py` uses `uri.split(":")[-1]` with spike-001 comment. Four Python error enums (`invalid_url`, `not_found`, `parse_error`, `network_error`) + Node-synthesized `python_crash` (5th via `PYTHON_CRASH_PREFIX` constant, W-1 pattern). `SyncRunner` reclassifies crash envelopes. 10 bridge unit tests + 12 SyncRunner tests cover all error paths. |
| 6 | Real Docker end-to-end: pnpm docker:dev → Python venv import → real Spotify URL sync → tracks in DB (Plan 06 Task 2 gate) | HUMAN NEEDED | Plan 06 Task 2 (`gate="blocking"`) was auto-approved without the 7-step smoke test being performed. The production Dockerfile also cannot be built (CR-01: Stage 1 missing `AS builder` alias — Stage 2 references `--from=builder` but no named stage exists). Dockerfile.dev is single-stage and likely functional for the dev container, but this requires human execution to confirm. |

**Score:** 5/6 truths verified programmatically

### Deferred Items

Items not yet met but explicitly addressed in later milestone phases.

| # | Item | Addressed In | Evidence |
|---|------|-------------|----------|
| 1 | Production Dockerfile builds successfully (CR-01: `FROM node:22-slim AS builder` alias missing; Stage 2 `COPY --from=builder` references nonexistent named stage) | Phase 6 | Phase 6 goal: "Docker image & deployment." Phase 6 success criteria SC1: "The production Dockerfile is based on a slim Node image and installs only Python + spotifyscraper (pinned version), yt-dlp, and ffmpeg — no Chromium, no Playwright browsers." DEPLOY-01 is explicitly mapped to Phase 6. |

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `scraper/scraper.py` | Python stdin-reader bridge, ≥90 lines, uri.split | VERIFIED | 210 lines. Contains `uri.split(":")[-1]`, `get_playlist_info`, all 4 error enums, exit 0 on envelopes, exit 2 on crash. |
| `scraper/requirements.txt` | Pins `spotifyscraper==2.1.5` | VERIFIED | Single line: `spotifyscraper==2.1.5` |
| `Dockerfile` | Production image with python3-venv, venv at /app/scraper/.venv, chown node:node | STUB/BROKEN | python3-venv present (line 40), venv build and chown present (lines 70-73), but Stage 1 is `FROM node:22-slim` without `AS builder` — Stage 2 `COPY --from=builder` references a non-existent named stage. Image cannot be built. |
| `Dockerfile.dev` | Dev image with python3-venv and venv at /app/scraper/.venv | VERIFIED | python3-venv on line 12, venv build on lines 32-33. Single-stage — no --from= references. Likely buildable. |
| `.gitignore` | Excludes `scraper/.venv/` and `scraper/__pycache__/` | VERIFIED | Line 25: `scraper/.venv/` present |
| `.dockerignore` | Excludes `scraper/.venv/` but not `scraper/` wholesale | VERIFIED | Line 62: `scraper/.venv/` present. No `scraper/` wholesale exclusion. |
| `src/modules/server/events/schema.ts` | FailureReasonSchema z.enum of 5 values + truncationSuspected + trackCount + failureReason optional fields | VERIFIED | FailureReasonSchema at line 15. truncationSuspected (line 53), trackCount (line 55), failureReason (line 72) all present. |
| `src/modules/server/events/schema.test.ts` | ≥60 lines, 9 behaviors | VERIFIED | 109 lines |
| `src/modules/client/playlist/schema/create-playlist-form.test.ts` | ≥40 lines, 10 accept/reject cases | VERIFIED | 146 lines |
| `src/env.ts` | PYTHON_BIN optional server env var | VERIFIED | Line 14: `PYTHON_BIN: z.string().min(1).optional()` |
| `src/modules/server/scraper/schema.ts` | PythonEnvelopeSchema, PYTHON_CRASH_PREFIX constant, ≥40 lines | VERIFIED | 66 lines. PYTHON_CRASH_PREFIX exported. PythonEnvelopeSchema, PythonTrackSchema, PythonErrorSchema, ScrapeRequest all present. |
| `src/modules/server/scraper/SpotifyScraperBridge.ts` | Class wrapping spawn, ≥80 lines, contains "spawn" | VERIFIED | 136 lines. Imports `spawn` from `node:child_process`. argv-form, stdio piped, timeout 30s, stdin.end, once("close"), PYTHON_CRASH_PREFIX used. |
| `src/modules/server/scraper/SpotifyScraperBridge.test.ts` | ≥120 lines, 10 tests with mocked spawn | VERIFIED | 395 lines. 10 tests covering all behaviors. |
| `src/modules/server/scraper/index.ts` | Barrel exports | VERIFIED | Exports schema, SpotifyScraperBridge, repository, SyncRunner. |
| `src/modules/server/scraper/repository.ts` | ScraperRepository with onConflictDoUpdate, ≥70 lines | VERIFIED | 132 lines. onConflictDoUpdate with composite target [sourceId, spotifyTrackId]. db.transaction wraps tracks + cover art. state/ytVideoId/downloadPath/failureReason NOT in set clause. |
| `src/modules/server/scraper/repository.test.ts` | ≥120 lines, 9 in-memory SQLite tests | VERIFIED | 272 lines. 9 tests. No hand-written CREATE TABLE. |
| `src/modules/server/scraper/SyncRunner.ts` | SyncRunner class, ≥120 lines, contains "failureReason" | VERIFIED | 290 lines. isValidPlaylistUrl, PYTHON_CRASH_PREFIX import, TRUNCATION_THRESHOLD=100, all event types emitted. No raw "python crash:" string literal. |
| `src/modules/server/scraper/SyncRunner.test.ts` | ≥150 lines, 12+ tests | VERIFIED | 459 lines. 12 SyncRunner tests + 7 URL validator tests. |
| `src/modules/server/scheduler/PlaylistScheduler.ts` | Delegates to SyncRunner, no direct event emissions | VERIFIED | SyncRunner imported and used as `this.syncRunner.run(source)`. No getEventBus(), no playlist.sync.started/completed/failed emissions. runningPlaylists Set present. |
| `src/modules/server/scheduler/PlaylistScheduler.test.ts` | ≥40 lines | VERIFIED | 511 lines. Race-guard tests added. |
| `src/modules/server/webhooks/service.ts` | truncationSuspected, trackCount, failureReason rendering, T-2-05 sanitization | VERIFIED | truncationSuspected (line 46), trackCount (lines 43-44), failureReason (lines 58-59), `.replace(/\s+/g, " ").slice(0, 200)` (line 62). |
| `src/modules/server/webhooks/service.test.ts` | ≥50 lines, T-2-05 test explicit | VERIFIED | 127 lines. T-2-05 sanitization test present. |
| `src/modules/client/playlist/components/playlist-config-card.tsx` | syncAction?: JSX.Element slot | VERIFIED | Line 28: `syncAction?: JSX.Element`. Line 38: `{props.syncAction}` rendered. |
| `src/routes/library_.$playlistId.tsx` | Sync-now button with triggerSync | VERIFIED | triggerSync imported (line 12), handleSyncNow defined (line 66), syncAction prop wired (line 96), "Sync now" text rendered. |
| `src/modules/server/scraper/integration.test.ts` | ≥40 lines, SCRAPER_INTEGRATION gate, describe.skip | VERIFIED | 79 lines. Line 29: `const d = gated ? describe : describe.skip`. Line 28: `SCRAPER_INTEGRATION === "1"`. No vi.mock. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `Dockerfile` | `scraper/requirements.txt` | `COPY + pip install` | BROKEN (CR-01) | pip install line present (line 72) but Dockerfile cannot build due to missing `AS builder` on Stage 1. |
| `Dockerfile.dev` | `scraper/requirements.txt` | `COPY + pip install` | VERIFIED | Line 33: pip install -r /app/scraper/requirements.txt. Single-stage image. |
| `scraper/scraper.py` | `spotify_scraper.SpotifyClient.get_playlist_info` | library call | VERIFIED | Line 162: `data = client.get_playlist_info(url)` |
| `src/modules/server/events/schema.ts` | `FailureReasonSchema` | z.enum export | VERIFIED | Line 15-22: `export const FailureReasonSchema = z.enum([...])` |
| `src/modules/server/scraper/SpotifyScraperBridge.ts` | `src/modules/server/scraper/schema.ts` | import PYTHON_CRASH_PREFIX | VERIFIED | Lines 26-28: imports PYTHON_CRASH_PREFIX, PythonEnvelopeSchema from "./schema" |
| `src/modules/server/scraper/SpotifyScraperBridge.ts` | `node:child_process` | spawn import | VERIFIED | Line 20: `import { spawn } from "node:child_process"` |
| `src/modules/server/scraper/schema.ts` | `src/modules/server/events/schema.ts` | import FailureReasonSchema | VERIFIED | `from "../events/schema"` |
| `src/modules/server/scraper/SyncRunner.ts` | `SpotifyScraperBridge.ts` | import + inject | VERIFIED | Bridge injected via SyncRunnerDeps; `this.bridge.fetchPlaylist(url)` called |
| `src/modules/server/scraper/SyncRunner.ts` | `src/modules/server/scraper/schema.ts` | import PYTHON_CRASH_PREFIX | VERIFIED | Line 30: `import { PYTHON_CRASH_PREFIX } from "./schema"` |
| `src/modules/server/scraper/SyncRunner.ts` | `src/modules/server/invocation/repository.ts` | InvocationRepository | VERIFIED | InvocationRepository.create() + .update() called in run() |
| `src/modules/server/scraper/SyncRunner.ts` | `src/modules/server/events` | getEventBus().emit | VERIFIED | playlist.sync.started, completed, failed all emitted |
| `src/modules/server/scraper/repository.ts` | `src/modules/server/db/schema.ts` | onConflictDoUpdate | VERIFIED | `target: [schema.tracks.sourceId, schema.tracks.spotifyTrackId]` with 5-column set clause |
| `src/modules/server/scheduler/PlaylistScheduler.ts` | `src/modules/server/scraper/SyncRunner.ts` | this.syncRunner.run(source) | VERIFIED | Line 34: `this.syncRunner = deps.syncRunner ?? new SyncRunner()`. executePlaylistSync calls `this.syncRunner.run(source)`. |
| `src/modules/server/webhooks/service.ts` | `PlaylistSyncCompletedEvent.payload.truncationSuspected` | conditional render | VERIFIED | Line 46: `event.payload.truncationSuspected` branched |
| `src/routes/library_.$playlistId.tsx` | `triggerSync` | onClick handler | VERIFIED | handleSyncNow calls `triggerSync(playlist().id!, {...})` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `SyncRunner.ts` | `envelope` (PythonEnvelope) | `this.bridge.fetchPlaylist(source.sourceUrl)` → real Python subprocess | Yes — bridge spawns scraper.py which calls `SpotifyClient.get_playlist_info()` | FLOWING |
| `ScraperRepository.upsertAll` | `tracks` rows | `envelope.tracks` from bridge, written via Drizzle `onConflictDoUpdate` | Yes — upsert writes real track data; unit tests verify 9 behaviors against in-memory SQLite | FLOWING (unit-verified; real Docker path needs human check) |
| `PlaylistScheduler.executePlaylistSync` | — | Delegates entirely to `SyncRunner.run(source)` — no independent data state | Yes — thin wrapper | FLOWING |
| `webhooks/service.ts formatCompleted` | `event.payload.trackCount`, `event.payload.truncationSuspected` | Populated by `SyncRunner.finalizeSuccess()` from `envelope.tracks.length` | Yes — real track count flows through | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `pnpm test` | 10 passed, 1 skipped (integration), 128 tests pass, 2 skipped | PASS |
| Integration test skips when SCRAPER_INTEGRATION unset | `pnpm test -- integration` (SCRAPER_INTEGRATION not set) | 2 tests skipped, exit 0 | PASS |
| No raw "python crash:" string in bridge or SyncRunner | `grep -qE '"python crash:"' SpotifyScraperBridge.ts SyncRunner.ts` | No match | PASS |
| No shell:true in bridge | `grep -qE 'shell:.*true' SpotifyScraperBridge.ts` | No match | PASS |
| Dockerfile Stage 1 has AS builder alias | `grep -n '^FROM' Dockerfile` | Line 5: `FROM node:22-slim` (no `AS builder`); Line 34 Stage 2 references `--from=builder` | FAIL (CR-01 — deferred to Phase 6) |
| Real Docker end-to-end smoke | `pnpm docker:dev` + 7-step checklist | Not run (auto-approved without execution) | SKIP — human needed |

### Requirements Coverage

| Requirement | Source Plans | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| SCRAPE-01 | 02-02, 02-05, 02-06 | User can configure a Spotify playlist URL as a source | SATISFIED | CreatePlaylistFormSchema enforces open.spotify.com + /playlist/ or /album/ path. 10-case test matrix passes. URL validated server-side in SyncRunner.isValidPlaylistUrl(). |
| SCRAPE-03 | 02-01, 02-03, 02-04, 02-05, 02-06 | Scraper extracts title, primary artist, duration_ms for every track | SATISFIED | scraper.py._normalize() extracts title, artist (artists[0].name), duration_ms. PythonTrackSchema validates shape. SyncRunner maps to DB columns. |
| SCRAPE-04 | 02-04, 02-06 | First-ever scrape reads all tracks top-to-bottom in order | SATISFIED | position = enumerate index in _normalize(). onConflictDoUpdate upserts in order. D-16: missing tracks untouched. Repository Test 3 confirms position overwrite. |
| SCRAPE-07 | 02-01, 02-03, 02-04, 02-05, 02-06 | Scraper captures source's cover-art URL | SATISFIED | _largest_image_url() selects max-width image. cover_art_url in PythonEnvelope. ScraperRepository.upsertAll() updates sources.coverArtUrl in same transaction. |

### Anti-Patterns Found

| File | Location | Pattern | Severity | Impact |
|------|----------|---------|----------|--------|
| `Dockerfile` | Line 5 | `FROM node:22-slim` without `AS builder`; Stage 2 references `--from=builder` | BLOCKER (prod only) | Production Docker image cannot be built. Dev image (Dockerfile.dev) is single-stage and unaffected. Deferred to Phase 6. |
| `src/modules/server/scraper/repository.ts` | Lines 87-91 | `sql.raw(`excluded.${schema.tracks.title.name}`)` — uses `sql.raw` instead of tagged template `sql\`excluded.${col}\`` | WARNING | Noted in CR-02. Tests pass (128/128), so it functions in current Drizzle + better-sqlite3 version. Risk: future Drizzle version may break this. Not a current functional gap. |
| `src/modules/server/webhooks/service.ts` | ~line 93 | Unbounded `sleep(waitMs)` on Retry-After header (WR-01) | WARNING | Server-controlled delay could block event handler for extended period. Not a phase-goal blocker. |
| `src/modules/server/webhooks/service.ts` | ~line 70 | Webhook URL accepts any valid URL, not restricted to Discord hosts (WR-02) | WARNING | SSRF gap for webhook URL. Not a phase-2 must-have (webhook SSRF mitigation was scoped to T-2-04 for source URLs, not webhook URLs). |
| `src/modules/server/scheduler/PlaylistScheduler.ts` | getScheduler factory | Singleton silently ignores deps on repeat calls (WR-03) | INFO | Test isolation concern. Tests use `new PlaylistScheduler(...)` directly — minimal practical impact. |
| `scraper/scraper.py` | Line 139 | `f"bad request: {e!r}"` includes raw JSONDecodeError repr in error message (IN-01) | INFO | Message could be long (includes raw input excerpt). No security risk; STDERR_SLICE_LIMIT caps bridge synthesis but not Python envelope error.message. |

### Human Verification Required

#### 1. Docker Dev Container End-to-End Smoke Test

**Test:** Run `pnpm docker:dev`, wait for server start, then execute the 7-step checklist from Plan 06 Task 2:
1. `docker exec -it <container> /app/scraper/.venv/bin/python -c 'import spotify_scraper; print(spotify_scraper.__version__)'` — expected `2.1.5`
2. `SCRAPER_INTEGRATION=1 pnpm test -- integration` inside container — expected 2 pass (or 1 pass + network_error warning)
3. UI: add a Spotify playlist source, click Sync-now, observe toast
4. `SELECT count(*), state FROM tracks GROUP BY state;` — expected ≥1 row with `state = pending`
5. `SELECT name, cover_art_url FROM sources;` — expected non-null HTTPS CDN URL
6. `SELECT status, summary FROM invocations ORDER BY started_at DESC LIMIT 1;` — expected `status = success`, summary has `track_count` + `truncation_suspected`
7. (Optional) Discord webhook renders trackCount, truncation note, failureReason

**Expected:** All 6 mandatory steps produce expected output. The Sync-now button appears on the playlist detail page, triggers a sync, and track rows appear in the DB with state=pending and correct field values.

**Why human:** Plan 06 Task 2 is marked `gate="blocking"` and was auto-approved without the 7-step Docker smoke being performed. The real Python subprocess path (Dockerfile.dev build → container boot → spotifyscraper call → Spotify network → DB write) cannot be verified programmatically. The production Dockerfile (CR-01) also has a missing `AS builder` alias on Stage 1 that would prevent a production image build, though this is deferred to Phase 6.

### Gaps Summary

No programmatic gaps block the phase goal under unit testing. All 128 automated tests pass (2 integration tests are correctly skipped when SCRAPER_INTEGRATION is unset).

One deferred item exists: the production Dockerfile has a CR-01 defect (missing `AS builder` on Stage 1) that prevents building the production image. This is scoped to Phase 6 (DEPLOY-01) and does not affect the dev container or unit tests.

Human verification is needed because the blocking Plan 06 Task 2 human checkpoint was auto-approved without the Docker dev container smoke test being performed. The phase goal requires real track rows in the DB from a real Spotify URL, which can only be confirmed by running the container.

The two critical code review findings from 02-REVIEW.md (CR-01 Dockerfile AS builder, CR-02 sql.raw pattern) do not negate any unit-tested behaviors — all 128 tests pass. CR-01 is deferred to Phase 6. CR-02 is a code-quality warning where the current behavior is correct (tests prove it) but the approach is fragile against future Drizzle upgrades.

---

_Verified: 2026-04-24T15:00:00Z_
_Verifier: Claude (gsd-verifier)_
