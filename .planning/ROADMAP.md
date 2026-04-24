# Roadmap: spotdl-manager (Playwright + yt-dlp pivot)

## Overview

This milestone swaps the download engine from the broken `spotdl` CLI to a Playwright-scrape + `yt-dlp`-resolve pipeline, while preserving the existing infrastructure layer (SSR routes, scheduler, event bus, Discord webhooks, repository pattern). The pivot unfolds as a vertical slice: first clear out spotdl and stand up the new track-state schema (clean-break DB reset), then prove the Playwright login CLI, then drive **one playlist all the way to a tagged MP3 on disk** before broadening to albums, incremental rescrape, retry/expiry UI, and finally hardening the Docker image and CLI entrypoint for the deploy target.

## Phases

**Phase Numbering:**
- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

Decimal phases appear between their surrounding integers in numeric order.

- [x] **Phase 1: Schema reset & spotdl removal** (2026-04-24) - Rip out spotdl, introduce `tracks` table, clean-break DB wipe
- [ ] **Phase 2: Spotify session (Playwright login CLI)** - Persistent storage state written to `/data` via container-runnable CLI
- [ ] **Phase 3: Playlist happy-path slice (end-to-end MP3)** - One playlist scrapes, matches, downloads, tags a single track successfully
- [ ] **Phase 4: Album support & incremental rescrape** - Albums scrape identically, repeat syncs stop after 5 known-in-order tracks
- [ ] **Phase 5: Per-track UI & retry model** - Track state badges, per-track manual retry, auto-retry of non-downloaded tracks
- [ ] **Phase 6: Session-expiry surfaces** - UI banner + Discord webhook fire on `session_expired` failures
- [ ] **Phase 7: Docker image & deployment** - Slim Node + Chromium + yt-dlp + ffmpeg image with volume-mounted `/data` CLI flow

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

### Phase 2: Spotify session (Playwright login CLI)
**Goal**: A single operator command opens a headed Chromium, the user logs into Spotify once, and the resulting storage state persists to `/data` where the scheduler will later pick it up.
**Depends on**: Phase 1
**Requirements**: AUTH-01, AUTH-02, AUTH-04
**Success Criteria** (what must be TRUE):
  1. Running the login CLI (e.g. `pnpm login:spotify`) launches a headed Playwright Chromium pointed at Spotify login
  2. After the user completes login, storage state is saved to `data/spotify/storage-state.json` and the CLI exits 0
  3. A server-side helper loads that storage state and can open `https://open.spotify.com` in a headless context without being redirected to the login page
  4. Missing/unreadable storage state produces a clear, typed error that callers can catch (no silent fall-through)
**Plans**: TBD

### Phase 3: Playlist happy-path slice (end-to-end MP3)
**Goal**: Given a configured playlist URL and a valid session, one scheduled sync run scrapes every track, matches them on YouTube under the strict duration gate, and writes tagged MP3s to `data/music/<slug>/`. This is the first moment the app does its job end-to-end.
**Depends on**: Phase 2
**Requirements**: SCRAPE-01, SCRAPE-03, SCRAPE-04, SCRAPE-06, SCRAPE-07, MATCH-01, MATCH-02, MATCH-03, MATCH-04, DOWNLOAD-01, DOWNLOAD-02, DOWNLOAD-03, DOWNLOAD-04, DOWNLOAD-05
**Success Criteria** (what must be TRUE):
  1. User can add a Spotify playlist URL as a source and trigger a sync; track rows (title, artist, duration_ms, position, cover-art URL) land in the `tracks` table for every row in the playlist, including virtualized/lazy-loaded ones
  2. Each pending track is resolved via `yt-dlp ytsearch1:"<artist> <title>"`; accepted matches (within ±3s) persist `yt_video_id` and transition to `downloaded`; out-of-tolerance tracks transition to `skipped_low_confidence` with the duration delta stored in `failure_reason`
  3. Accepted tracks land on disk at `data/music/<slug>/<artist> - <title>.mp3` with embedded ID3 tags (title, artist, album, cover art) and sanitized filenames
  4. The sync runs 3 yt-dlp downloads in parallel by default; a global setting lets the user set this to 2 or 4 and also adjust the duration tolerance
  5. yt-dlp failures are recorded on the track row with exit code and the tail of stderr in `failure_reason`; the invocation row still completes with per-track counts in its summary
**Plans**: TBD
**UI hint**: yes

### Phase 4: Album support & incremental rescrape
**Goal**: Albums work the same as playlists, and repeat syncs on any source stop early once they see known content — cutting cost on large libraries and keeping scheduled runs cheap.
**Depends on**: Phase 3
**Requirements**: SCRAPE-02, SCRAPE-05
**Success Criteria** (what must be TRUE):
  1. User can add a Spotify album URL (`open.spotify.com/album/...`) as a source; scraping, matching, downloading, and tagging all behave identically to playlists
  2. The second and subsequent syncs on a source read newest-to-oldest and stop after 5 consecutive tracks already present in the `tracks` table in the same order
  3. Tracks appearing above the sentinel on a rescrape are inserted with correct `position` and flow into the normal matching pipeline
  4. A first-ever sync on a new source still reads the entire list top-to-bottom (no early-stop on empty state)
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

### Phase 6: Session-expiry surfaces
**Goal**: When the Spotify session expires, the user finds out fast — via a persistent banner in the app and a Discord ping — and knows exactly what to do next.
**Depends on**: Phase 5
**Requirements**: AUTH-05, AUTH-06, AUTH-07
**Success Criteria** (what must be TRUE):
  1. When a scrape hits the login redirect or auth-wall selectors, the invocation is marked failed with reason `session_expired` and a `playlist.sync.failed` event is emitted carrying that reason
  2. Whenever the most recent invocation failed with `session_expired`, a persistent banner appears across the app telling the user to re-run the login CLI
  3. The Discord webhook handler sends a dedicated, distinguishable message for `session_expired` failures (separate from generic sync failures)
  4. After the user re-runs the login CLI, the next sync succeeds and the banner disappears automatically
**Plans**: TBD
**UI hint**: yes

### Phase 7: Docker image & deployment
**Goal**: The app ships as a single container image that bundles exactly the runtime deps we need (Chromium, yt-dlp, ffmpeg) and supports the login CLI via `docker exec` against a single `/data` volume.
**Depends on**: Phase 6
**Requirements**: AUTH-03, DEPLOY-01, DEPLOY-02, DEPLOY-03
**Success Criteria** (what must be TRUE):
  1. The production `Dockerfile` is based on a slim Node image and installs only Chromium (not all Playwright browsers), yt-dlp, and ffmpeg
  2. All runtime state (SQLite DB, logs, sync state, Playwright storage state, music files) lives under a single mounted `/data` volume; nothing persists elsewhere
  3. `docker exec <container> pnpm login:spotify` runs the login CLI inside the running container and writes storage state to the mounted volume
  4. After the login CLI exits, the next scheduled sync picks up the new session without a container restart
**Plans**: TBD

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema reset & spotdl removal | 5/5 | Complete | 2026-04-24 |
| 2. Spotify session (Playwright login CLI) | 0/TBD | Not started | - |
| 3. Playlist happy-path slice (end-to-end MP3) | 0/TBD | Not started | - |
| 4. Album support & incremental rescrape | 0/TBD | Not started | - |
| 5. Per-track UI & retry model | 0/TBD | Not started | - |
| 6. Session-expiry surfaces | 0/TBD | Not started | - |
| 7. Docker image & deployment | 0/TBD | Not started | - |

---
*Roadmap created: 2026-04-23*
