# spotdl-manager

## What This Is

A self-hosted, single-user web app that downloads Spotify playlists and albums as tagged MP3 files on a schedule. The existing `spotdl` CLI strategy broke due to Spotify API changes, so the app is pivoting to a Playwright-based pipeline: scrape playlist/album metadata from a logged-in Spotify session, resolve each track on YouTube via `yt-dlp`, and download to a local library.

## Core Value

Scheduled, unattended downloads of Spotify playlists and albums as properly tagged MP3s — resilient to Spotify locking down its public API.

## Requirements

### Validated

<!-- Existing capabilities from the current codebase (working UI / infrastructure layer). -->

- ✓ Browser-based UI for managing playlist configs (add / edit / delete, paginated library view) — existing
- ✓ Per-playlist scheduling via cron-style intervals (`croner`) — existing
- ✓ SQLite persistence via Drizzle ORM; layered client/server module boundary — existing
- ✓ Sync invocation tracking with per-run logs, exit codes, and status — existing
- ✓ Event bus + Discord webhook notifications for sync lifecycle — existing
- ✓ SSR via TanStack Start + Solid.js with route-driven loaders — existing

### Active

<!-- The pivot milestone: replace the download engine. Hypotheses until shipped. -->

**Spotify metadata acquisition (Playwright)**
- [ ] One-time Spotify login via local CLI command; Playwright saves storage state to a persistent volume
- [ ] Scrape playlist URLs using the saved session: track name, primary artist, duration (ms)
- [ ] Scrape album URLs using the saved session (same fields)
- [ ] Incremental rescrape heuristic: read newest-to-oldest; stop after 5 consecutive tracks already in our tracks table in the same order
- [ ] Detect expired/invalid session; mark invocation failed; emit a `playlist.sync.failed` event with reason `session_expired`

**Track state model**
- [ ] New `tracks` table keyed by `(playlist_id, spotify_track_id)` with: title, artist, duration_ms, match state, yt_video_id, download_path, failure_reason, timestamps
- [ ] Per-track visibility in the UI (matched / downloaded / skipped-low-confidence / failed)

**YouTube resolution + download (yt-dlp)**
- [ ] Resolve each track with `yt-dlp` using `ytsearch1:"<artist> <title>"`
- [ ] Confidence gate: accept only when the YouTube candidate's duration is within ±N seconds (configurable, default ~3s) of the Spotify duration; otherwise mark track `skipped-low-confidence`
- [ ] Download resolved tracks as MP3 via yt-dlp + ffmpeg
- [ ] Embed ID3 tags (title, artist, album, cover art) from the Spotify metadata we scraped
- [ ] Write to `data/music/<playlist-or-album-slug>/<artist> - <title>.mp3`
- [ ] Run N=2–4 yt-dlp downloads in parallel per sync (configurable, default 3)

**Retry model**
- [ ] Each scheduled sync auto-retries any track in `failed` or `skipped-low-confidence` state
- [ ] User can manually retry any track (including successfully-downloaded ones) from the UI

**Expiry / error surfaces**
- [ ] UI banner when any recent invocation failed with `session_expired`; instructs the user to re-run the login CLI
- [ ] Discord webhook fires for `session_expired` failures (reuses existing webhook integration)

**Deployment**
- [ ] Dockerfile based on slim Node image with Chromium (headless), yt-dlp, and ffmpeg installed
- [ ] Login CLI (`pnpm login:spotify` or equivalent) is runnable via `docker exec` and writes storage state to the mounted `/data` volume

**Rip out spotdl**
- [ ] Remove `SpotdlInvocator`, `SpotdlRepository`, spotdl-specific schema columns, `SPOTDL_COOKIES_FILE`, and related UI
- [ ] Clean-break DB reset on upgrade (no migration code) — users recreate playlists

### Out of Scope

- **Liked Songs, artist top tracks, podcasts** — deferred; playlists + albums cover the core use case
- **Lossless / Opus / format switching** — MP3 + ID3 matches what users already expect from the old spotdl flow
- **Spotify API (official) path** — the reason for the pivot; we assume no public metadata API
- **Multi-user, auth, cloud hosting** — stays single-user self-hosted
- **Rich metadata (lyrics, ISRC, genre, BPM)** — keep the tag set minimal; nice-to-have later
- **Library-style `<artist>/<album>/` hierarchy** — per-playlist folders win on simplicity
- **User-configurable output-path templates** — one layout for v1
- **Migration of existing playlist/invocation data** — clean break on upgrade; personal tool, migration burden not worth it
- **Keeping spotdl as a fallback engine** — spotdl is broken; carrying two engines doubles maintenance for no benefit
- **Non-Spotify sources (Apple Music, Tidal, SoundCloud)** — scope stays Spotify-only
- **Match review UI for ambiguous tracks** — strict duration gate + user retry is enough for v1

## Context

- **Prior strategy**: The app wrapped the `spotdl` CLI, which internally used Spotify's public API plus YouTube resolution. Spotify API changes have broken spotdl's metadata path, so the app's download flow no longer works end-to-end.
- **Existing codebase**: Solid.js + TanStack Start (SSR) + SQLite/Drizzle + PandaCSS + Ark UI. Feature-module layout (`src/modules/client/*`, `src/modules/server/*`) with strict client/server boundary. Codebase mapped on 2026-04-23 in `.planning/codebase/`. The **infrastructure layer stays** (scheduler, event bus, invocation tracking, UI shell, repositories pattern); only the download engine changes.
- **Deployment shape**: The app runs in a single container behind a user-provided reverse proxy. All state (SQLite DB, logs, sync state, and now Playwright storage state + downloaded music) lives under `/data`.
- **Personal-scale tool**: No auth, no multi-tenancy. The user runs it for themselves; UX can assume cooperative input.
- **YouTube rate-limit concern**: Parallel downloads ≥5 have historically drawn rate-limit responses from YouTube. Default concurrency stays ≤4; configurable so users can tune.

## Constraints

- **Tech stack**: Solid.js + TanStack Start + Drizzle/SQLite + PandaCSS — locked; inherited from existing codebase
- **Runtime binaries**: yt-dlp and ffmpeg must be available on `PATH`; Chromium must be available for Playwright — installed via Docker image
- **Deployment target**: Docker (single-container). Login CLI must work inside the container with `docker exec` and persist to the `/data` volume
- **Personal tool**: No auth, no RBAC, no multi-user considerations — everything runs as the single logged-in operator
- **Storage layout**: All mutable state lives under `/data` (DB, logs, sync state, storage-state JSON, music files) — one volume to back up
- **No Spotify API dependency**: Every piece of metadata comes from scraping the logged-in Spotify web UI — no client ID / secret, no OAuth flow
- **Clean break from old data**: No DB migration path from the spotdl schema; users are told to recreate playlists after upgrade

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Pivot from spotdl to Playwright + yt-dlp | Spotify API changes broke spotdl's metadata path; continuing to wrap a broken tool isn't viable | — Pending |
| Persistent Spotify session via one-time local CLI login | Only option that keeps the scheduler unattended; headful-per-sync blocks automation; cookie import is brittle | — Pending |
| `yt-dlp ytsearch1:` for YouTube resolution | Simplest possible matching path; avoids writing a custom scoring layer for v1 | — Pending |
| Duration tolerance is the sole confidence gate; skip on mismatch | Prefer "no wrong file" over "always something"; user-visible skip state lets them intervene | — Pending |
| Incremental rescrape: stop after 5 consecutive known-in-order tracks | Cuts scrape cost on large playlists; relies on "new tracks appear at top" assumption; removals are intentionally ignored | — Pending |
| New per-track table | Enables per-track state/retry/UI; aggregate-only model can't represent skipped-vs-failed-vs-downloaded | — Pending |
| Rip out spotdl entirely (not fallback) | Broken engine; side-by-side doubles maintenance for zero user benefit | — Pending |
| Clean-break DB wipe on upgrade | Personal tool; migration code cost > recreating a handful of playlists | — Pending |
| MP3 + ID3 tags | Matches prior spotdl output; keeps existing library readable in other players | — Pending |
| Concurrency default 3 (range 2–4), configurable | Balances speed vs YouTube rate-limiting risk; user can tune per environment | — Pending |
| `data/music/<playlist>/` layout | Simple, matches today's shape; albums reuse the same pattern | — Pending |
| Session-expiry surfaces via UI banner + Discord webhook | Reuses existing webhook integration; user sees the failure without checking the app | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-23 after initialization*
