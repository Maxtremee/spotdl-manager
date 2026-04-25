# Roadmap: spotdl-manager (spotifyscraper + yt-dlp pivot)

## Overview

This milestone swaps the download engine from the broken `spotdl` CLI to a `spotifyscraper`-driven metadata path feeding `yt-dlp`-based YouTube resolution, while preserving the existing infrastructure layer (SSR routes, scheduler, event bus, Discord webhooks, repository pattern). The pivot unfolds as a vertical slice: first clear out spotdl and stand up the new track-state schema (clean-break DB reset), then integrate the `spotifyscraper` library to populate `tracks` from a configured Spotify URL, then drive those rows through YouTube match + tagged-MP3 download, before broadening to albums + incremental rescrape, per-track UI/retry, and finally hardening the Docker image and CLI entrypoint for the deploy target.

**Pivot from the original Playwright-session plan (2026-04-24):** Spike 001 validated that `spotifyscraper` v2.1.5 fetches public Spotify metadata against the live web player without auth or Chromium. Spike 002 uncovered a hard-cap — the library uses Spotify's `/embed/playlist/` endpoint, which Spotify itself caps at 100 tracks per playlist. Albums are unaffected. We accept the constraint: milestone scope is albums + playlists ≤100 tracks. All session/login/expiry concerns from the old plan fall away with this library choice.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Schema reset & spotdl removal** (2026-04-24) - Rip out spotdl, introduce `tracks` table, clean-break DB wipe
- [x] **Phase 2: Spotify metadata via spotifyscraper** (2026-04-24) - Configured playlist URL populates `tracks` via `spotifyscraper` — no auth, no Chromium
- [ ] **Phase 3: Match + download slice (end-to-end MP3)** - Pending tracks resolve on YouTube, download via yt-dlp, and land as tagged MP3s on disk
- [ ] **Phase 4: Album support & incremental rescrape** - Albums scrape identically (no 100-track cap); repeat syncs stop after 5 known-in-order tracks
- [ ] **Phase 5: Per-track UI & retry model** - Track state badges, per-track manual retry, auto-retry of non-downloaded tracks
- [ ] **Phase 6: Docker image & deployment** - Slim Node + yt-dlp + ffmpeg image with volume-mounted `/data`

## Phase Details

### Phase 1: Schema reset & spotdl removal
**Goal**: A clean codebase with no spotdl code, a new `tracks` table, and a first-boot DB reset — so Phase 2+ builds on fresh ground instead of coexisting with a broken engine.
**Depends on**: Nothing (first phase)
**Requirements**: TRACK-01, TRACK-02, CLEANUP-01, CLEANUP-02, CLEANUP-03, CLEANUP-04
**Success Criteria** (what must be TRUE):
  1. `src/modules/server/spotdl/` and its imports no longer exist; `SpotdlInvocator`, `SpotdlRepository`, and the `spotdl` global setting are gone
  2. `SPOTDL_COOKIES_FILE` env var and cookies checkbox UI are removed from `src/env.ts`, settings route, and schema
  3. A new `tracks` table exists in `src/modules/server/db/schema.ts` with `(source_id, spotify_track_id)` uniqueness and the state/title/artist/duration/yt_video_id/download_path/failure_reason/position/timestamps columns
  4. First boot on the new version drops the legacy DB and shows a one-time "library reset" notice in the UI
  5. `pnpm build`, `pnpm typecheck`, and `pnpm test` all pass with the spotdl engine removed and no replacement yet (scheduler sync is a no-op stub)
**Plans**: TBD
**UI hint**: yes

### Phase 2: Spotify metadata via spotifyscraper
**Goal**: A configured Spotify playlist URL, on sync, fetches metadata via the `spotifyscraper` library (no auth, no Chromium) and populates the `tracks` table with pending rows carrying title, primary-artist, duration_ms, position, and cover-art URL. This replaces the old Playwright-session approach entirely.
**Depends on**: Phase 1
**Requirements**: SCRAPE-01, SCRAPE-03, SCRAPE-04, SCRAPE-07
**Success Criteria** (what must be TRUE):
  1. User can configure a Spotify playlist URL (`open.spotify.com/playlist/...`) as a source
  2. On sync, `spotifyscraper` is invoked and every returned track lands in the `tracks` table with `spotify_track_id` (derived from `track.uri.split(":")[-1]`), `title`, primary `artist` name, `duration_ms`, `position`, and `state = pending`
  3. The source's cover-art URL is captured (at the source level, for later ID3 embedding)
  4. First-ever scrape of a source reads all tracks top-to-bottom and records them in order (no early-stop on empty state)
  5. Library limitations are handled explicitly: empty `id` → derived from `uri`; `spotifyscraper` exceptions surface as typed errors the sync pipeline can catch
  6. **Constraint accepted**: playlists >100 tracks are truncated by the library (Spotify `/embed/playlist/` cap). Milestone scope = playlists ≤100 tracks + albums. Revisit only if requirements change.
**Plans**: 6 plans
  - [ ] 02-01-PLAN.md — Python scraper bridge (scraper/scraper.py) + Docker image python3/venv layers (prod + dev)
  - [ ] 02-02-PLAN.md — Event schema extension (truncationSuspected, trackCount, failureReason enum) + URL-validator test matrix (T-2-04 SSRF guard) + PYTHON_BIN env var
  - [ ] 02-03-PLAN.md — SpotifyScraperBridge (Node child_process.spawn wrapper) + PythonEnvelopeSchema + mocked-spawn unit tests
  - [ ] 02-04-PLAN.md — ScraperRepository (composite-key upsert with column preservation) + SyncRunner (shared entry point; URL guard, truncation flag, python_crash reclassification, terminal event)
  - [ ] 02-05-PLAN.md — Scheduler body replacement (SyncRunner delegation + shared runningPlaylists guard) + Webhook formatter extension + Sync-now button (new PlaylistConfigCard.syncAction slot)
  - [ ] 02-06-PLAN.md — Gated integration test (SCRAPER_INTEGRATION=1 real Python spawn) + manual end-to-end smoke checkpoint

### Phase 3: Match + download slice (end-to-end MP3)
**Goal**: Pending rows produced by Phase 2 are resolved on YouTube under the strict duration gate, downloaded via yt-dlp, tagged, and land on disk at `data/music/<slug>/`. This is the first moment the app does its job end-to-end.
**Depends on**: Phase 2
**Requirements**: MATCH-01, MATCH-02, MATCH-03, MATCH-04, DOWNLOAD-01, DOWNLOAD-02, DOWNLOAD-03, DOWNLOAD-04, DOWNLOAD-05
**Success Criteria** (what must be TRUE):
  1. Each `pending` track is resolved via `yt-dlp ytsearch1:"<artist> <title>"`; accepted matches (within ±3s) persist `yt_video_id` and transition to `downloaded`; out-of-tolerance tracks transition to `skipped_low_confidence` with the duration delta stored in `failure_reason`
  2. Accepted tracks land on disk at `data/music/<slug>/<artist> - <title>.mp3` with embedded ID3 tags (title, artist, album, cover art) and sanitized filenames
  3. The sync runs 3 yt-dlp downloads in parallel by default; a global setting lets the user set this to 2 or 4 and also adjust the duration tolerance
  4. yt-dlp failures are recorded on the track row with exit code and the tail of stderr in `failure_reason`; the invocation row still completes with per-track counts in its summary
  5. A complete sync on a single configured playlist ends with at least one real tagged MP3 on disk for a known-good track
**Plans**: 5 plans
  - [x] 03-01-PLAN.md — Foundation: schema (album + kind columns), deps (node-id3 + p-limit + slugify + yt-dlp pin), slug.ts + downloader/schema.ts (W-1 constants), default match settings seed, [BLOCKING] db:push
  - [ ] 03-02-PLAN.md — YtDlpBridge (argv-form spawn wrapper for probe + download) + mocked-spawn unit suite (no_results gotcha covered)
  - [ ] 03-03-PLAN.md — tagger.ts (node-id3 wrapper) + cover-art.ts (HTTPS-only fetch with size + MIME guards, T-3-04 mitigation) + fixtures + tests
  - [ ] 03-04-PLAN.md — DownloadRepository + DownloadRunner (per-track state machine + pLimit fan-out + per-track failure isolation) + EventBus handler + plugin registration + playlist.download.completed event + D-06 lock-spans-handler test
  - [ ] 03-05-PLAN.md — Gated DOWNLOADER_INTEGRATION=1 integration test + manual end-to-end smoke checkpoint (Success Criterion #5)
**UI hint**: yes

### Phase 4: Album support & incremental rescrape
**Goal**: Albums work the same as playlists (no 100-track cap applies at the album endpoint), and repeat syncs on any source stop early once they see known content — cutting cost on large libraries and keeping scheduled runs cheap.
**Depends on**: Phase 3
**Requirements**: SCRAPE-02, SCRAPE-05
**Success Criteria** (what must be TRUE):
  1. User can add a Spotify album URL (`open.spotify.com/album/...`) as a source; scraping, matching, downloading, and tagging all behave identically to playlists
  2. Album-track rows fall back to `album.artists[0].name` for the artist field when the per-track `artists` field is empty (spotifyscraper quirk documented in spike 001)
  3. The second and subsequent syncs on a source read newest-to-oldest and stop after 5 consecutive tracks already present in the `tracks` table in the same order
  4. Tracks appearing above the sentinel on a rescrape are inserted with correct `position` and flow into the normal matching pipeline
  5. A first-ever sync on a new source still reads the entire list top-to-bottom (no early-stop on empty state)
**Plans**: TBD

### Phase 5: Per-track UI & retry model
**Goal**: The user can see the state of every track in a source and act on failures — both automatically on every scheduled sync and manually from the UI.
**Depends on**: Phase 4
**Requirements**: TRACK-03, TRACK-04, TRACK-05
**Success Criteria** (what must be TRUE):
  1. The playlist/album detail route lists every track with a visible state badge (`pending | matched | downloaded | skipped_low_confidence | failed`)
  2. User can click a per-track retry button and that track is re-run through match+download on the next tick; retry works on any state, including `downloaded` (forces a re-download)
  3. Every scheduled sync automatically re-attempts any track whose state is not `downloaded`, without needing manual intervention
  4. After a retry succeeds, the track's badge updates without a full page reload (loader invalidation is sufficient)
**Plans**: TBD
**UI hint**: yes

### Phase 6: Docker image & deployment
**Goal**: The app ships as a single container image that bundles exactly the runtime deps we need (Python + spotifyscraper, yt-dlp, ffmpeg) and supports first-run from a single `/data` volume. No Chromium — the spotifyscraper pivot removed the Playwright dependency entirely.
**Depends on**: Phase 5
**Requirements**: DEPLOY-01, DEPLOY-02, DEPLOY-03
**Success Criteria** (what must be TRUE):
  1. The production `Dockerfile` is based on a slim Node image and installs only Python + `spotifyscraper` (pinned version), yt-dlp, and ffmpeg — no Chromium, no Playwright browsers
  2. All runtime state (SQLite DB, logs, sync state, music files) lives under a single mounted `/data` volume; nothing persists elsewhere
  3. The container starts cleanly against an empty `/data` volume and the first sync works without any manual setup step (no login CLI needed)
  4. Image size stays meaningfully smaller than the Playwright-bearing reference, since Chromium is removed
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema reset & spotdl removal | 5/5 | Complete | 2026-04-24 |
| 2. Spotify metadata via spotifyscraper | 6/6 | Complete | 2026-04-24 |
| 3. Match + download slice (end-to-end MP3) | 0/5 | Planned | - |
| 4. Album support & incremental rescrape | 0/TBD | Not started | - |
| 5. Per-track UI & retry model | 0/TBD | Not started | - |
| 6. Docker image & deployment | 0/TBD | Not started | - |

---
*Roadmap created: 2026-04-23*
*Restructured 2026-04-24: pivot from Playwright session to spotifyscraper (per spikes 001/002). Removed old Phase 2 (Spotify session) and old Phase 6 (session-expiry surfaces). Renumbered old Phase 7 → new Phase 6.*
*Phase 2 planned: 2026-04-24 — 6 plans across 5 waves (01 Docker+Python | 02 schemas, parallel with 01 | 03 bridge | 04 runner+repo | 05 scheduler+UI+webhook | 06 integration test + manual smoke)*
*Phase 3 planned: 2026-04-25 — 5 plans across 4 waves (01 foundation/schema/deps/slug | 02 YtDlpBridge, parallel with 03 | 03 tagger+cover-art, parallel with 02 | 04 DownloadRunner+repo+handler+plugin+D-06 test | 05 gated integration test + HUMAN-UAT smoke)*
