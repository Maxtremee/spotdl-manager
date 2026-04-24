---
phase: 01-schema-reset-spotdl-removal
verified: 2026-04-24T00:00:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "First boot on the new version drops the legacy DB and shows a one-time 'library reset' notice in the UI"
    reason: "ROADMAP SC #4 explicitly amended by D-07 (recorded in 01-CONTEXT.md). User-run `pnpm reset:db` script delivers the wipe; UI banner deliberately dropped because there are zero production instances. The orchestrator prompt itself confirms the override."
    accepted_by: "user (prompted override in verifier invocation + D-07 in 01-CONTEXT.md)"
    accepted_at: "2026-04-23T00:00:00Z"
---

# Phase 1: Schema reset & spotdl removal — Verification Report

**Phase Goal:** A clean codebase with no spotdl code, a new `tracks` table, and a first-boot DB reset — so Phase 2+ builds on fresh ground instead of coexisting with a broken engine.

**Verified:** 2026-04-24
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC-1 | `src/modules/server/spotdl/` and its imports no longer exist; `SpotdlInvocator`, `SpotdlRepository`, and the `spotdl` global setting are gone | PASS | Directory absent: `ls src/modules/server/spotdl/` → No such file or directory. Grep for `SpotdlInvocator\|SpotdlRepository` in src/: only matches are in `.md` doc files (events/ARCHITECTURE.md, IMPLEMENTATION.md, README.md, examples.ts comments) — no TypeScript runtime references. |
| SC-2 | `SPOTDL_COOKIES_FILE` env var and cookies checkbox UI are removed from `src/env.ts`, settings route, and schema | PASS | `grep SPOTDL_COOKIES_FILE src/ .env.example package.json` → zero hits. `src/env.ts` server block has only `SERVER_URL`. `src/modules/client/settings/components/cookies-settings-form.tsx` deleted. `src/routes/settings.tsx` does not import `CookiesSettingsForm` or `getSpotdlSettingsServerFn`. `.env.example` is the two-line "no required env vars" placeholder. |
| SC-3 | A new `tracks` table exists in `src/modules/server/db/schema.ts` with `(source_id, spotify_track_id)` uniqueness and the state/title/artist/duration/yt_video_id/download_path/failure_reason/position/timestamps columns | PASS | `schema.ts` defines `tracks = sqliteTable("tracks", ...)` with all TRACK-02 columns (id, sourceId, spotifyTrackId, title, artist, durationMs, state enum, ytVideoId, downloadPath, failureReason, position, createdAt, updatedAt). Composite unique `tracks_source_spotify_unique` on (source_id, spotify_track_id). CASCADE FK to sources.id. Live DB shows all three indexes. `src/modules/server/db/schema.test.ts` (9 Wave-0 assertions) passes. |
| SC-4 (overridden by D-07) | First-boot DB reset delivered via `pnpm reset:db`, no UI banner per D-07 | PASS (override) | `scripts/reset-db.mjs` (49 lines) — deletes `data/db.sqlite`, runs `drizzle-kit push --force`, idempotent. `package.json` → `"reset:db": "node scripts/reset-db.mjs"`. `[ ! -f server/plugins/db-reset.ts ]`. `grep "library reset\|library-reset" src/` → zero hits. |
| SC-5 | `pnpm build`, `pnpm typecheck`, and `pnpm test` all pass with the spotdl engine removed and no replacement yet (scheduler sync is a no-op stub) | PASS | `pnpm typecheck` → clean (exit 0). `pnpm test` → 62 tests passed across 4 files (schema.test.ts, playlist.test.ts, PlaylistScheduler.test.ts, EventBus.test.ts). `pnpm build` → built in 1.74s, `.output/` produced, Nitro build succeeded. `pnpm lint` → 13 warnings, 0 errors (non-blocking). |

**Score:** 5/5 truths verified (1 via accepted override)

### Required Artifacts

| Artifact | Expected | Exists | Substantive | Wired | Data Flow | Status |
|----------|----------|--------|-------------|-------|-----------|--------|
| `src/modules/server/spotdl/` | DELETED | No (deleted) | n/a | n/a | n/a | VERIFIED (absent) |
| `src/modules/server/db/schema.ts` | sources + tracks + invocations + globalSettings tables, no flags_*, no "track" enum, cover_art_url nullable | Yes (144 lines) | Yes — all 4 tables, `skipped_low_confidence` present, `tracks_source_spotify_unique`, `cover_art_url` present, no `flags_*` | Yes — imported by repository, scheduler, seed, mapper, and test | n/a (schema file) | VERIFIED |
| `src/modules/server/db/schema.test.ts` | Wave-0 assertions for TRACK-01 + TRACK-02 + absence of flags_* | Yes | 9 assertions (per plan 01-01 acceptance) | Yes — runs under `pnpm test` | n/a (test file) | VERIFIED |
| `src/modules/server/scheduler/PlaylistScheduler.ts` | Event-emitting stub, no spotdl/invocation imports, SourceRow types | Yes | `getEventBus().emit` called 2x for started/completed; `Math.max(1, elapsed)`; `SchedulerStub` logger scope; no `SpotdlInvocator`/`SpotdlRepository`/`InvocationRepository`/`PlaylistRow`/`schema.playlists` references | Yes — `triggerManualSync` called by `triggerPlaylistSyncServerFn` in functions.ts | n/a (stub — intentionally emits events with no DB writes per D-03) | VERIFIED |
| `src/modules/server/scheduler/PlaylistScheduler.test.ts` | Event bus mock + stub assertions, no spotdl/invocation mocks | Yes | 21 `it()` calls (plan requested ~17); asserts `mockEventBusEmit` × 2 per tick, concurrency guard, Zod payload validation | Yes — runs under `pnpm test` | n/a | VERIFIED |
| `src/env.ts` | Server block has only SERVER_URL | Yes (40 lines) | Yes — no SPOTDL_COOKIES_FILE | Yes — imported by runtime | n/a (env definition) | VERIFIED |
| `.env.example` | No SPOTDL_COOKIES_FILE reference | Yes (2 lines) | Yes — generic placeholder | n/a | n/a | VERIFIED |
| `Dockerfile` | No python3/pipx/spotdl/pip3 install; retains ffmpeg + sqlite3 | Yes | Builder stage retains `python3-dev` + make + g++ (for better-sqlite3 per plan 03 action); runtime stage has only ffmpeg + sqlite3; no `pip3 install`, no `spotdl --version` | n/a | n/a | VERIFIED |
| `Dockerfile.dev` | No python3/pipx/spotdl install; retains ffmpeg + git + sqlite3 + make + g++ | Yes | Only apt installs: ffmpeg, git, sqlite3, make, g++ | n/a | n/a | VERIFIED |
| `src/modules/client/playlist/components/advanced-flags-section.tsx` | FILE DELETED | No (deleted) | n/a | n/a | n/a | VERIFIED (absent) |
| `src/modules/client/settings/components/cookies-settings-form.tsx` | FILE DELETED | No (deleted) | n/a | n/a | n/a | VERIFIED (absent) |
| `src/modules/client/playlist/components/playlist-config-card.tsx` | Status select only; no Format/Quality/Run Now | Yes (123 lines) | Confirmed — only Status Select in right column; no PlayIcon, no `onRunSync`, no Format/Quality fields | Yes — consumed by `library_.$playlistId.tsx` with trimmed props | n/a | VERIFIED |
| `src/routes/settings.tsx` | Only WebhookSettingsForm, no CookiesSettingsForm | Yes | Loader returns only `webhookSettings` | Yes | n/a | VERIFIED |
| `scripts/reset-db.mjs` | Cross-platform Node ESM: unlink data/db.sqlite + drizzle-kit push | Yes (49 lines, executable) | Uses `unlinkSync`, `spawnSync`, `mkdirSync`, `drizzle-kit push --force`; pure stdlib | Yes — wired via package.json `reset:db` script | n/a (script) | VERIFIED |
| `package.json` | `reset:db` script entry | Yes | `"reset:db": "node scripts/reset-db.mjs"` | Yes — executable | n/a | VERIFIED |
| `drizzle/0000_tranquil_squadron_sinister.sql` | Single fresh migration creating all 4 tables | Yes | 1 migration file; `CREATE TABLE sources`, `CREATE TABLE tracks`, `CREATE TABLE invocations`, `CREATE TABLE global_settings`; unique index `tracks_source_spotify_unique`; no `flags_`; no `ALTER TABLE` | Yes — applied to `data/db.sqlite` | n/a | VERIFIED |
| `drizzle/meta/_journal.json` | Exactly 1 entry | Yes | `.entries.length === 1` | Yes | n/a | VERIFIED |

### Key Link Verification

| From | To | Via | Verified | Details |
|------|-----|-----|----------|---------|
| `tracks.sourceId` | `sources.id` | Drizzle `references()` with `onDelete: "cascade"` | Yes | Confirmed in both schema.ts and applied DB (`FOREIGN KEY (source_id) REFERENCES sources(id) ... ON DELETE cascade`) |
| `PlaylistScheduler` | EventBus | `getEventBus().emit({ type: 'playlist.sync.started'/'completed' })` | Yes | 2 emit calls in executePlaylistSync; test asserts both fire with valid Zod payloads |
| `PlaylistScheduler` | `db/schema` | `import type { SourceRow }` + `schema.sources` references | Yes | No `PlaylistRow` or `schema.playlists` present; `SourceRow` + `schema.sources` confirmed |
| `package.json` `reset:db` | `scripts/reset-db.mjs` | `node scripts/reset-db.mjs` | Yes | Script exists, is executable (+x), and runs idempotently |
| `invocations.playlistId` | `sources.id` | `references(() => sources.id)` | Yes | FK intact in schema.ts and applied migration |
| `src/env.ts` server block | runtime env | `createEnv` with `SERVER_URL: z.url().optional()` | Yes | Only field, SPOTDL_COOKIES_FILE purged |

### Data-Flow Trace (Level 4)

Skipped for pure schema / infrastructure artifacts (schema.ts, env.ts, Dockerfiles, reset-db script, migration SQL). For runtime artifacts:

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `PlaylistScheduler.ts` stub | event payloads (started/completed) | Composed from `SourceRow` fields + `randomUUID()` + `Math.max(1, elapsed)` | Yes — payloads construct valid Zod-validated data from source row; stub intentionally emits events only (D-03 no DB writes) | FLOWING (stub semantics) |
| `playlist-config-card.tsx` | `props.status`, `props.schedule`, `props.sourceUrl` | Passed from `library_.$playlistId.tsx` loader (server fn → repository → Drizzle) | Yes — full server-fn loader chain preserved (not touched in Phase 1 cleanup) | FLOWING |
| `data/db.sqlite` (applied schema) | schema contents | drizzle-kit push against `src/modules/server/db/schema.ts` | Yes — 4 tables present, all empty per D-03 | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All tests pass | `pnpm test` | 62/62 tests passed across 4 files | PASS |
| TypeScript compiles | `pnpm typecheck` | exit 0, no errors | PASS |
| Production build succeeds | `pnpm build` | built in 1.74s, `.output/` produced | PASS |
| Lint clean (warnings allowed) | `pnpm lint` | 13 warnings, 0 errors | PASS |
| DB contains Phase 1 tables | `sqlite3 data/db.sqlite "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"` | `global_settings / invocations / sources / tracks` | PASS |
| tracks composite unique present | `sqlite3 ... ".schema tracks"` | `UNIQUE INDEX tracks_source_spotify_unique (source_id, spotify_track_id)` | PASS |
| D-03 preservation — all tables empty | Row counts | invocations=0, sources=0, tracks=0, global_settings=0 | PASS |
| No `flags_` in applied sources table | `sqlite3 ... ".schema sources"` | clean — cover_art_url present, no flags_ | PASS |
| Spotdl directory absent | `ls src/modules/server/spotdl/` | No such file or directory | PASS |
| No library-reset UI (D-07) | `grep -rn "library reset\|library-reset" src/` | zero matches | PASS |
| No Nitro reset plugin (RESEARCH Open Q #1) | `test -f server/plugins/db-reset.ts` | absent | PASS |
| `pnpm reset:db` idempotent | re-run script | exits 0 both times | PASS (verified via plan 01-05 Task 2 during execution) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| TRACK-01 | 01-01 | `tracks` table with unique `(source_id, spotify_track_id)` | SATISFIED | schema.ts tracks table + `tracks_source_spotify_unique` index confirmed in applied DB |
| TRACK-02 | 01-01 | Track rows store title, artist, duration_ms, state enum, yt_video_id, download_path, failure_reason, position, timestamps | SATISFIED | All columns present, state enum matches TRACK-02, `default("pending")` applied |
| CLEANUP-01 | 01-03, 01-04 | Remove SpotdlInvocator, SpotdlRepository, all CLI wiring | SATISFIED | Directory deleted; scheduler rewritten as event-emitting stub with no spotdl imports |
| CLEANUP-02 | 01-01, 01-03 | Remove spotdl schema columns + SPOTDL_COOKIES_FILE env var | SATISFIED | schema.ts has no flags_* columns; env.ts / .env.example / Dockerfiles purged |
| CLEANUP-03 | 01-05 | DB wipe on first boot (notice dropped per D-07) | SATISFIED (override) | `pnpm reset:db` script delivers wipe; UI banner explicitly out per D-07 |
| CLEANUP-04 | 01-02 | Remove spotdl-specific UI (flag form sections, cookies checkbox, Run Now) | SATISFIED | advanced-flags-section.tsx + cookies-settings-form.tsx deleted; Run Now button hidden; PlaylistSchema trimmed |

All 6 phase requirements accounted for. No orphaned IDs in REQUIREMENTS.md for Phase 1.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/modules/server/db/seed.ts` | 66 | Sample log template still says `# spotdl run seed-run-001` | Info | Cosmetic — seeded dev DB has misleading template; noted in 01-REVIEW IN-02 |
| `src/modules/server/events/ARCHITECTURE.md` / `IMPLEMENTATION.md` / `README.md` / `examples.ts` | various | Doc comments reference `spotdl` engine | Info | Cosmetic-only per plan 01-03 Threat T-03-05; no build impact |
| `src/modules/server/webhooks/functions.ts` | 63 | Test webhook message: "Test message from spotdl-manager" | Info | Literal app/repo name — not a `spotdl` engine reference |
| `src/modules/server/scheduler/PlaylistScheduler.ts` | triggerManualSync | fire-and-forget promise with no `.catch` | Info | Flagged in 01-REVIEW WR-03; pre-existing pattern, not Phase-1-introduced |
| `Dockerfile` | 5 | `FROM node:22-slim` missing `AS builder` with later `COPY --from=builder` | Warning (pre-existing) | Flagged in 01-REVIEW CR-01 + plan 01-03 Known Bug — intentionally deferred to Phase 7 Docker work |
| `src/modules/client/library/components/library-info-panel.tsx` | 17 | User-facing copy promises "edit quality and format settings" (removed features) | Info | Flagged in 01-REVIEW IN-01 |

None of these anti-patterns block Phase 1 goal achievement. All are documented in 01-REVIEW.md with explicit disposition; the Dockerfile `AS builder` bug is explicitly deferred to Phase 7 per plan 01-03.

### Human Verification Required

No blocking items require human verification to confirm goal achievement. Every phase success criterion is automation-verified above. The 01-VALIDATION.md manual-only items (live scheduler tick observation, real Discord webhook firing) are optional integration spot-checks that confirm wiring beyond unit-level mocks — they are not required to establish the phase goal.

### Gaps Summary

No gaps. Phase 1 achieves its goal: spotdl code removed, `tracks` table in place, `pnpm reset:db` delivers the first-boot DB reset path (with UI notice deliberately dropped per the D-07 override that the verifier invocation explicitly acknowledged), and the full suite (test + typecheck + build + lint) is green. The scheduler is a clean event-emitting no-op stub wired to EventBus for handler exercise during the interim.

Residual observations flagged by 01-REVIEW.md (CR-01 Dockerfile builder alias, WR-01 tracks.position uniqueness, WR-02 error status UX, WR-03 unhandled-rejection, WR-04 scheduleMinutes 0 handling, cosmetic IN-01…IN-07) are either pre-existing, deferred to Phase 3/5/7 by design, or non-blocking doc copy. None of them prevent Phase 2 from proceeding on a clean foundation.

---

_Verified: 2026-04-24_
_Verifier: Claude (gsd-verifier)_
