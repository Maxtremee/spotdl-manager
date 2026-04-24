# Phase 2: Spotify metadata via spotifyscraper - Context

**Gathered:** 2026-04-24
**Status:** Ready for planning

<domain>
## Phase Boundary

A configured Spotify playlist URL, on sync, invokes the Python `spotifyscraper` library via a subprocess bridge (no auth, no Chromium) and populates the `tracks` table with `pending` rows carrying `title`, primary `artist`, `duration_ms`, `position`, and the source's cover-art URL. This is the first phase where the scheduler does real work (replacing the Phase 1 no-op stub). Album support = Phase 4. YouTube match/download = Phase 3. Per-track UI/retry = Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Python bridge architecture
- **D-01:** Node invokes `spotifyscraper` via `child_process.spawn('python3', …)` **per sync** — no long-lived Python process, no HTTP sidecar. Cold start is ≤200ms; scrape itself is <0.5s (spike 001). Total per-sync cost is negligible and the code stays stateless.
- **D-02:** IO contract is **stdin JSON → stdout JSON**. Node writes a JSON request (`{ url, source_type: "playlist" }`) to Python's stdin; Python writes a single JSON blob to stdout (`{ tracks, cover_art_url, error }`). Exit code signals success/failure. Chosen over CLI-args for extensibility — future options (artist-fallback toggle, concurrency cap) add fields without reshaping the spawn call.
- **D-03:** Python code lives at **`scraper/` at repo root** (not inside `src/modules/server/`). Contents: `scraper.py`, `requirements.txt` (pin `spotifyscraper==2.1.5`), and a venv at `scraper/.venv/` (gitignored). Clear separation: this is the Python component. Dockerfile installs from `scraper/requirements.txt`.
- **D-04:** **Docker-only local dev path** — no host venv bootstrap. Devs touching the scrape path run `pnpm docker:dev`. Trade-off accepted: `pnpm dev` on host can't exercise the real scraper, but repo hygiene stays clean and there is no "works on my Python" divergence. Planner MUST address: how vitest unit tests handle the spawn boundary (expected: mock the bridge interface, integration tests run inside Docker).

### Scrape invocation & invocations table
- **D-05:** The `PlaylistScheduler.executePlaylistSync` body gets its **real implementation** in this phase. The no-op stub from Phase 1 (D-01/D-02/D-03 in `01-CONTEXT.md`) is replaced with a call to the new scrape function. Scheduler keeps emitting `playlist.sync.started` + `playlist.sync.completed` but now wraps real work.
- **D-06:** Manual "Sync now" button is **unhidden** and wired to the same scrape function the scheduler calls. Phase 1 D-04 (hide button, no engine) is retired. Single code path, two entry points (scheduled + manual). Planner should extend the existing `runningPlaylists` Set concurrency guard to cover manual triggers — can't have the button and the scheduler fire the same source simultaneously.
- **D-07:** **`invocations` rows are written.** Phase 1 D-03 deferred this until a real engine existed — Phase 2 is that engine. One row per scrape run: inserted with `status=running` at scrape start, updated on finish (`success` / `failed` / `canceled`). `summary` is a JSON blob carrying per-run metadata (see D-09, D-11).
- **D-08:** On any scrape-side failure, **no `tracks` rows are written** for that run — the whole scrape is atomic from the track-table perspective. The `invocations` row captures the failure; the `tracks` table stays consistent with the last successful scrape.
- **D-09:** **Typed failure taxonomy** — Python exceptions map to a fixed enum stored in `invocations.summary.failure_reason`:
  - `invalid_url` — URL doesn't match Spotify playlist shape (validated in Node before spawn)
  - `not_found` — spotifyscraper `ParsingError` on a nonexistent playlist
  - `parse_error` — spotifyscraper `ParsingError` on unexpected payload shape (Spotify changed `__NEXT_DATA__`)
  - `network_error` — underlying `requests` exception propagated from Python
  - `python_crash` — Python exits non-zero without emitting a parseable JSON error envelope
  The `playlist.sync.failed` event payload carries the same `failure_reason` so Discord-webhook + log handlers can branch on it.

### 100-track truncation detection
- **D-10:** When `len(tracks) == 100`, the scrape **still processes all 100 tracks** (upserts them into the `tracks` table) and flags the run as truncation-suspected. Rationale: the 100 returned tracks are real; discarding them over a *maybe-truncated* concern would be worse than silently losing data we never had access to. Milestone scope is already ≤100 per REQUIREMENTS.md "Out of Scope"; this flag is informational, not blocking.
- **D-11:** Truncation surfaces in **two places**:
  - `invocations.summary.truncation_suspected: true` (always, on every qualifying run)
  - A new field on the `playlist.sync.completed` event payload (`truncationSuspected: boolean`) so the existing Discord webhook handler reports it — requires extending `PlaylistSyncCompletedEventSchema` in `src/modules/server/events/schema.ts`
- **D-12:** No new column on `sources` in this phase (no sticky source-level flag). The per-run `summary` field is sufficient for Phase 5's per-source UI to badge the source off the latest invocation.

### Re-scrape behavior (interim, before Phase 4 incremental)
- **D-13:** Second and subsequent syncs **always do a full scrape** (all 100 tracks re-fetched) and **upsert on the `(source_id, spotify_track_id)` unique key**. No early-stop logic in this phase — that's Phase 4 (SCRAPE-05). Rationale: behavior stays correct until Phase 4 optimizes cost.
- **D-14:** On upsert, existing rows are **updated in place**: `title`, `artist`, `duration_ms`, `position`, `updated_at` are refreshed. **Never touched on upsert:** `state`, `yt_video_id`, `download_path`, `failure_reason` — those are Phase 3's concern and must survive a re-scrape.
- **D-15:** `position` is **overwritten with the current Spotify order** on every scrape. Tracks that moved positions reflect that. `position` is not a stable identifier; the unique key is `(source_id, spotify_track_id)`.
- **D-16:** Tracks that existed in a previous scrape but are **missing from the current response are left untouched** — row stays, any downloaded MP3 (Phase 3+) stays on disk. No soft-delete flag, no removal. Drift is tolerated; Phase 4 may revisit when incremental logic lands.

### Claude's Discretion
- Exact Python script shape (argparse vs stdin reader, single-function vs class) — planner picks
- Error-envelope JSON shape for Python → Node exception passing
- Drizzle upsert implementation (`onConflictDoUpdate` vs explicit select-then-insert-or-update)
- Whether to extract a `ScraperRepository` or inline the upsert in the scrape module
- How vitest unit tests fake the Python bridge (factor the spawn behind an interface)
- Logger namespacing (`Logger.get("Scraper")`, `Logger.get("PythonBridge")`, etc.)
- URL validation — where to do it (client `create-playlist-form.ts` already has partial validation; reuse vs duplicate in scraper module)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level decisions
- `.planning/PROJECT.md` — Core value, key decisions table (spotifyscraper pivot, 100-track cap accepted, no auth)
- `.planning/REQUIREMENTS.md` — Phase 2 requirements (SCRAPE-01, SCRAPE-03, SCRAPE-04, SCRAPE-07); Out-of-Scope list (AUTH-01..07, SCRAPE-06, playlists >100)
- `.planning/ROADMAP.md` §"Phase 2: Spotify metadata via spotifyscraper" — Goal, depends-on (Phase 1), success criteria 1–6 (especially SC #5 library-limit handling and SC #6 100-cap acceptance)
- `.planning/STATE.md` — Phase 2 of 6; last activity = roadmap pivot 2026-04-24

### Prior phase decisions (carried forward / overridden)
- `.planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md` — Phase 1 locked decisions D-01..D-13. **D-03 (no `invocations` rows) and D-04 (hide Sync-now) are explicitly retired here in D-06 + D-07 above.** D-01/D-02 carry forward — scheduler keeps emitting lifecycle events.

### Spike findings (MUST read — non-negotiable constraints)
- `.claude/skills/spike-findings-spotdl-manager/SKILL.md` — Requirements & findings index
- `.claude/skills/spike-findings-spotdl-manager/references/spotify-metadata-scraping.md` — Install, fetch patterns, normalization, scale guard, what-to-avoid list, constraints
- `.planning/spikes/MANIFEST.md` — Spike verdicts (001 VALIDATED, 002 INVALIDATED → 100-cap accepted)
- `.planning/spikes/CONVENTIONS.md` — Python venv + investigation patterns (informs `scraper/` dir layout)

### Codebase maps (read before touching code)
- `.planning/codebase/ARCHITECTURE.md` — Module structure, client/server boundary
- `.planning/codebase/STRUCTURE.md` — File layout
- `.planning/codebase/CONVENTIONS.md` — Coding conventions
- `.planning/codebase/STACK.md` — Tech stack (Drizzle, SQLite, TanStack Start, Solid.js). **Note:** STACK.md was written pre-pivot and still references the spotdl CLI — treat as historical for download-engine claims; sources/tracks/invocations schema claims are current.
- `.planning/codebase/INTEGRATIONS.md` — Event bus, Discord webhooks, scheduler wiring

### Repo guide
- `CLAUDE.md` — Claude-facing project guide; commands; event bus usage patterns; Logger singleton

### Files that will be touched (reference shape, not as specs)
- `src/modules/server/db/schema.ts` — `sources` (has `cover_art_url`), `tracks` (TRACK-01/02 shape), `invocations` (FK still `playlist_id` — Phase 3 renames)
- `src/modules/server/scheduler/PlaylistScheduler.ts` — No-op stub body replaced in this phase (see `executePlaylistSync` ~line 80)
- `src/modules/server/events/schema.ts` — `PlaylistSyncCompletedEventSchema` extended with `truncationSuspected: boolean`
- `src/modules/server/events/handlers.ts` — Discord webhook handler reads new `truncationSuspected` field
- `src/modules/server/invocation/` — Invocation repository (already exists from Phase 1); scrape module writes rows through it
- `src/modules/client/playlist/schema/create-playlist-form.ts` — URL validation already accepts `/playlist/` and `/album/`; Phase 2 uses only `/playlist/` (album = Phase 4 but validator stays broad)
- `Dockerfile` + `Dockerfile.dev` — Install `python3`, `python3-venv`, run `python3 -m venv scraper/.venv && scraper/.venv/bin/pip install -r scraper/requirements.txt` at build time

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Event bus** (`src/modules/server/events/`): Scrape emits `playlist.sync.started` / `.completed` / `.failed` through the existing bus — no new transport. Handlers (logging, metrics, duration warnings, Discord webhook) keep working; only the `.completed` schema needs the new `truncationSuspected` field.
- **Invocation repository** (`src/modules/server/invocation/`): Already exists from Phase 1. Scrape writes invocation rows through this layer — no new repo.
- **Sources table** (`schema.sources`): `cover_art_url` column already exists from Phase 1. Phase 2 populates it from the scrape response (SCRAPE-07).
- **Tracks table** (`schema.tracks`): Unique key `(source_id, spotify_track_id)` already in place. Upsert via `onConflictDoUpdate` lands cleanly.
- **PlaylistScheduler.runningPlaylists Set**: Concurrency guard pattern already in place for scheduled runs; extend to cover manual Sync-now triggers (D-06).
- **Logger** (`src/logger.ts`): `Logger.get("Scraper")` or similar; pino structured logging. Dev = pretty-printed; prod = JSON.

### Established Patterns
- **Drizzle schema** (`src/modules/server/db/schema.ts`): Single-file. Type inference via `$inferSelect`/`$inferInsert`.
- **Client/server boundary** (`CLAUDE.md`): Server-only code stays in `src/modules/server/`. New scrape module lands at `src/modules/server/scraper/` (TypeScript side of the bridge). Python code at `scraper/` (repo root — outside `src/`).
- **Server functions**: `createServerFn` with Zod `.inputValidator()`. Manual Sync-now button calls a server function that wraps the shared scrape entry point.
- **Zod schemas for events** (`src/modules/server/events/schema.ts`): Extending `PlaylistSyncCompletedEventSchema` with a new optional field preserves the contract for consumers that don't read it.

### Integration Points
- **PlaylistScheduler.executePlaylistSync** (`src/modules/server/scheduler/PlaylistScheduler.ts` ~line 80): Stub body replaced. Still reads `source` row, emits started/completed events, guards concurrency via `runningPlaylists`. Now delegates to the new scrape module between start/completed events.
- **Manual Sync button** (client playlist detail route, hidden in Phase 1 D-04): Unhidden. Calls a new server function that invokes the same scrape entry point.
- **Event schema** (`src/modules/server/events/schema.ts`): `PlaylistSyncCompletedEventSchema` gains optional `truncationSuspected: z.boolean().optional()`. `PlaylistSyncFailedEventSchema` gains `failureReason: z.enum([...])`.
- **Discord webhook handler** (`src/modules/server/events/handlers.ts`): Reads `truncationSuspected` + `failureReason`; formats message accordingly.
- **Dockerfile** (`Dockerfile`, `Dockerfile.dev`): Install `python3` + `python3-venv` via apt; create + populate `scraper/.venv` at build time; no Chromium, no Playwright (per DEPLOY-01).
- **`.dockerignore`**: Ensure `scraper/.venv/` is excluded from build context but created inside the image.
- **`.gitignore`**: Add `scraper/.venv/` and `scraper/__pycache__/` (mirrors spike conventions).

</code_context>

<specifics>
## Specific Ideas

- **Docker-only dev is deliberate**, not a default. User explicitly chose it over `pnpm install:scraper`. Implication: the dev feedback loop for scrape changes goes through `pnpm docker:dev`. Planner must make this loop fast — e.g. bind-mount `scraper/` and restart the Node side quickly, rather than rebuilding the image.
- **"Full scrape + upsert, leave removed tracks alone, overwrite position"** is a deliberately simple re-scrape policy. User prioritized "never accidentally delete user data" over "source playlist is always the source of truth." Phase 4 may revisit if removal tracking becomes necessary.
- **Typed failure taxonomy** is MORE valuable than free-text summaries because Phase 5 per-track retry UI (TRACK-05) and Discord notifications branch on it. Free-text would push that classification cost downstream.

</specifics>

<deferred>
## Deferred Ideas

- **Incremental scrape (stop-after-5)** — explicitly Phase 4 (SCRAPE-05). Not in Phase 2.
- **Album support** — explicitly Phase 4 (SCRAPE-02). Phase 2 scrapes playlists only.
- **Per-source sticky `truncation_suspected` column on `sources`** — rejected for this phase; per-run `invocations.summary` flag is sufficient until Phase 5 per-source UI demands it.
- **Removing tracks that disappear from Spotify between syncs** — deferred; row stays, MP3 (if any) stays.
- **Long-lived Python subprocess / HTTP sidecar** — rejected for simplicity. If scrape cost ever becomes a bottleneck (it won't at this scale), revisit.
- **`pnpm install:scraper` host venv bootstrap** — rejected in favor of Docker-only. Revisit only if host-dev-loop friction becomes blocking.
- **Source-level cover-art refresh policy** — `cover_art_url` updated on every scrape (implied by full re-scrape upsert). If Spotify cover art ever changes mid-playlist-lifetime, users get the new URL; no migration for already-downloaded MP3s (Phase 3 embeds at download time from whatever `cover_art_url` was current).

</deferred>

---

*Phase: 02-spotify-metadata-spotifyscraper*
*Context gathered: 2026-04-24*
