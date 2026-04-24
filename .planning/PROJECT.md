# spotdl-manager

## What This Is

A self-hosted, single-user web app that downloads Spotify playlists and albums as tagged MP3 files on a schedule. The existing `spotdl` CLI strategy broke due to Spotify API changes, so the app is pivoting to a `spotifyscraper`-driven metadata path (no auth, no Chromium) feeding `yt-dlp`-based YouTube resolution to download tagged MP3s to a local library. Playlists are capped at 100 tracks (Spotify `/embed/playlist/` endpoint limit); albums are unaffected.

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

**Spotify metadata acquisition (spotifyscraper)**
- [x] `spotifyscraper` v2.1.5 fetches public playlist metadata via `/embed/playlist/` — no auth, no Chromium — validated in Phase 2
- [x] Python subprocess bridge (`scraper/scraper.py` + `SpotifyScraperBridge`) reads JSON from stdin, writes validated envelope to stdout, with typed error enum (`invalid_url`, `not_found`, `parse_error`, `network_error`, `python_crash`) — validated in Phase 2
- [x] Playlist URL → tracks rows with `spotify_track_id` (derived from `uri.split(":")[-1]`), title, artist, duration_ms, position, state=pending — validated in Phase 2
- [x] Source-level `cover_art_url` captured from largest-image URL for later ID3 embedding — validated in Phase 2
- [x] Truncation detection: invocations summary + completed event payload carry `truncationSuspected=true` when tracks.length ≥ 100 — validated in Phase 2
- [ ] Album URLs scrape identically (no 100-track cap) — deferred to Phase 4
- [ ] Incremental rescrape: stop after 5 consecutive known-in-order tracks — deferred to Phase 4

**Track state model**
- [x] New `tracks` table keyed by `(source_id, spotify_track_id)` with: title, artist, duration_ms, match state, yt_video_id, download_path, failure_reason, timestamps — validated in Phase 1
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

**Error surfaces**
- [x] Typed failure reasons (`invalid_url`, `not_found`, `parse_error`, `network_error`, `python_crash`) — validated in Phase 2
- [x] Discord webhook renders `failureReason` enum + T-2-05-sanitized error (≤200 chars) for failed syncs; `trackCount` line + `⚠️ possibly truncated` note for completed syncs — validated in Phase 2
- [ ] UI badge per track showing state (matched / downloaded / skipped-low-confidence / failed) — Phase 5

**Deployment**
- [ ] Production Dockerfile (slim Node + Python + spotifyscraper + yt-dlp + ffmpeg) — Phase 6
- [x] Dev Dockerfile installs Python 3 + spotifyscraper venv at `/app/scraper/.venv/bin/python`, chowned to node:node — validated in Phase 2

**Rip out spotdl**
- [x] Remove `SpotdlInvocator`, `SpotdlRepository`, spotdl-specific schema columns, `SPOTDL_COOKIES_FILE`, and related UI — validated in Phase 1
- [x] Clean-break DB reset via `pnpm reset:db` (no migration code, no UI banner per D-07) — validated in Phase 1

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
| Pivot from spotdl to spotifyscraper + yt-dlp | spike 001 validated auth-free metadata fetch; no Chromium or Playwright required; removes the login/session surface entirely | ✓ Validated (Phase 2) |
| 100-track cap accepted as milestone scope | Spotify `/embed/playlist/` endpoint caps at 100; albums unaffected; truncation surfaced in invocation summary + webhook | ✓ Validated (Phase 2) |
| Python subprocess bridge over embedded runtime | Keeps Node surface thin; argv-form spawn (shell: false) prevents command injection; stdin JSON avoids argv URL exposure | ✓ Validated (Phase 2) |
| `yt-dlp ytsearch1:` for YouTube resolution | Simplest possible matching path; avoids writing a custom scoring layer for v1 | — Pending |
| Duration tolerance is the sole confidence gate; skip on mismatch | Prefer "no wrong file" over "always something"; user-visible skip state lets them intervene | — Pending |
| Incremental rescrape: stop after 5 consecutive known-in-order tracks | Cuts scrape cost on large playlists; relies on "new tracks appear at top" assumption; removals are intentionally ignored | — Pending |
| New per-track table | Enables per-track state/retry/UI; aggregate-only model can't represent skipped-vs-failed-vs-downloaded | — Pending |
| Rip out spotdl entirely (not fallback) | Broken engine; side-by-side doubles maintenance for zero user benefit | ✓ Validated (Phase 1) |
| Clean-break DB wipe on upgrade | Personal tool; migration code cost > recreating a handful of playlists | ✓ Validated (Phase 1) — delivered via `pnpm reset:db` script; UI banner dropped per D-07 |
| New `tracks` table (per-track state) | Aggregate-only model can't represent skipped-vs-failed-vs-downloaded | ✓ Validated (Phase 1) — schema in place; per-track UI still pending (Phase 5) |
| Scheduler rewritten as event-emitting no-op stub | Keeps scheduler wiring + event-bus contract alive while download engine is swapped; Phase 2+ fills in the body | ✓ Validated (Phase 1) |
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
*Last updated: 2026-04-24 after Phase 2 completion*
