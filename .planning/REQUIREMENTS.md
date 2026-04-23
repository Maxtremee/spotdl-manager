# Requirements: spotdl-manager

**Defined:** 2026-04-23
**Core Value:** Scheduled, unattended downloads of Spotify playlists and albums as properly tagged MP3s — resilient to Spotify locking down its public API.

## v1 Requirements

Requirements for the pivot milestone. Each maps to a roadmap phase.

### Auth (Spotify session)

- [ ] **AUTH-01**: User can run a local CLI command that launches a headed Playwright browser and waits for the user to complete Spotify login
- [ ] **AUTH-02**: On successful login, the CLI persists Playwright storage state (cookies + localStorage) to a stable path under `/data` (e.g. `data/spotify/storage-state.json`)
- [ ] **AUTH-03**: The login CLI runs inside the Docker container via `docker exec` and writes storage state to the mounted `/data` volume
- [ ] **AUTH-04**: Scrapers automatically load the saved storage state on each run; no per-sync re-login
- [ ] **AUTH-05**: Scraper detects expired/invalid sessions (login redirect, auth-wall selectors) and fails the invocation with a `session_expired` reason
- [ ] **AUTH-06**: UI displays a persistent banner when the most recent invocation failed with `session_expired`, instructing the user to re-run the login CLI
- [ ] **AUTH-07**: Discord webhook handler sends a dedicated message when a `playlist.sync.failed` event carries a `session_expired` reason

### Scrape (Playwright metadata acquisition)

- [ ] **SCRAPE-01**: User can configure a Spotify playlist URL (`open.spotify.com/playlist/...`) as a source
- [ ] **SCRAPE-02**: User can configure a Spotify album URL (`open.spotify.com/album/...`) as a source
- [ ] **SCRAPE-03**: Scraper extracts track title, primary artist name, and track duration (ms) for every visible track in the source
- [ ] **SCRAPE-04**: First-ever scrape of a source reads all tracks top-to-bottom and records them in order
- [ ] **SCRAPE-05**: Incremental scrapes on subsequent syncs stop after encountering 5 consecutive tracks already stored for this source in the same order; tracks above that sentinel are inserted as additions
- [ ] **SCRAPE-06**: Scraper handles virtualized/lazy-loaded playlist rows (auto-scroll or equivalent) so all tracks are visible to the extraction step
- [ ] **SCRAPE-07**: Scraper captures the source's album cover-art URL (for playlists that have one, and for every album) so it can be embedded later

### Tracks (per-track state model)

- [ ] **TRACK-01**: New `tracks` table stores per-track state keyed uniquely by `(source_id, spotify_track_id)`
- [ ] **TRACK-02**: Track rows store at least: title, artist, duration_ms, state (`pending | matched | downloaded | skipped_low_confidence | failed`), yt_video_id, download_path, failure_reason, position, created_at, updated_at
- [ ] **TRACK-03**: Playlist/album detail page lists tracks with a visible state badge per track
- [ ] **TRACK-04**: User can manually retry any single track from the UI (including already-downloaded tracks — forces re-download)
- [ ] **TRACK-05**: Each scheduled sync automatically retries every non-downloaded track (state in `pending | skipped_low_confidence | failed`)

### Match (YouTube resolution)

- [ ] **MATCH-01**: Resolver calls `yt-dlp ytsearch1:"<artist> <title>"` for each track needing resolution
- [ ] **MATCH-02**: Resolver accepts the match when the returned video's duration is within ±3 seconds (tolerance configurable in global settings) of the Spotify duration
- [ ] **MATCH-03**: Out-of-tolerance matches are recorded as `skipped_low_confidence` with the observed duration delta stored in `failure_reason`
- [ ] **MATCH-04**: The resolved `yt_video_id` is persisted on the track row and reused on retries (no re-searching an already-matched track unless the user explicitly forces it)

### Download (yt-dlp + tagging)

- [ ] **DOWNLOAD-01**: yt-dlp downloads the resolved video and extracts audio to MP3 via ffmpeg
- [ ] **DOWNLOAD-02**: ID3 tags are embedded on each MP3: title, artist, album (scraped from Spotify), and cover art (fetched from the captured Spotify cover-art URL)
- [ ] **DOWNLOAD-03**: Output files land at `data/music/<source-slug>/<artist> - <title>.mp3`; artist, title, and slug are sanitized for cross-platform filesystem safety
- [ ] **DOWNLOAD-04**: Default sync runs 3 yt-dlp downloads in parallel; global setting lets the user change it to 2 or 4
- [ ] **DOWNLOAD-05**: Download failures capture yt-dlp's exit code and the last N lines of stderr into `failure_reason` on the track row

### Deploy (Docker + CLI)

- [ ] **DEPLOY-01**: Dockerfile is based on a slim Node image and installs only Chromium (not all Playwright browsers), yt-dlp, and ffmpeg at build time
- [ ] **DEPLOY-02**: All mutable state (SQLite DB, logs, sync state, Playwright storage state, music files) lives under a single `/data` volume
- [ ] **DEPLOY-03**: Login CLI is invocable via `docker exec` and writes its output to the `/data` volume so the running app picks it up on the next sync without a restart

### Cleanup (rip out spotdl)

- [ ] **CLEANUP-01**: Remove `SpotdlInvocator`, `SpotdlRepository`, and all spotdl CLI wiring from the server code
- [ ] **CLEANUP-02**: Remove spotdl-specific schema columns (flag toggles, cookies settings) and the `SPOTDL_COOKIES_FILE` env var
- [ ] **CLEANUP-03**: Drop / recreate the database on first boot of the new version (clean-break reset); surface a one-time "library reset" notice in the UI
- [ ] **CLEANUP-04**: Remove spotdl-specific UI: flag form sections, cookies checkbox, any routes or components only used by the old engine

## v2 Requirements

Deferred past the pivot milestone. Tracked but not in the current roadmap.

### Sources

- **SRC2-01**: Liked Songs pseudo-playlist support
- **SRC2-02**: Artist top-tracks source

### Metadata / format

- **FMT2-01**: Opus / m4a output formats (no re-encode path)
- **FMT2-02**: Lossless (FLAC) support where source quality allows
- **META2-01**: Additional ID3 frames (genre, year, track number, lyrics)

### Matching

- **MATCH2-01**: Match-review UI to let the user pick among top-N YouTube candidates for ambiguous tracks
- **MATCH2-02**: Reject-bad-terms list (live / cover / remix / reaction) as a secondary confidence gate

### Authentication

- **YTAUTH2-01**: yt-dlp cookies passthrough for age-gated / region-locked YouTube content

### Layout

- **LAY2-01**: User-configurable output-path template per source (`{source}/{pos} - {artist} - {title}`)

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Multi-user / auth layer | Personal self-hosted tool; added complexity with no value |
| Non-Spotify sources (Apple Music, Tidal, SoundCloud) | Scope stays Spotify-only; each source needs its own scraper |
| Spotify public API path (client ID/secret, OAuth) | The reason for the pivot — we assume no usable public API |
| Keeping spotdl as a fallback engine | spotdl is broken; maintaining two engines doubles work for zero benefit |
| Migration from spotdl-era schema/data | Personal tool; clean-break DB reset is cheaper than writing migrations |
| Library-style `<artist>/<album>/` hierarchy | Per-playlist folders are simpler and match today's shape |
| Rich v1 metadata (lyrics, ISRC, BPM) | Deferred to v2 to keep the pivot tight |
| Headful-browser-per-sync login | Incompatible with unattended scheduler runs |

## Traceability

Which phases cover which requirements. Populated by `gsd-roadmapper`.

| Requirement | Phase | Status |
|-------------|-------|--------|
| AUTH-01 | Phase 2 | Pending |
| AUTH-02 | Phase 2 | Pending |
| AUTH-03 | Phase 7 | Pending |
| AUTH-04 | Phase 2 | Pending |
| AUTH-05 | Phase 6 | Pending |
| AUTH-06 | Phase 6 | Pending |
| AUTH-07 | Phase 6 | Pending |
| SCRAPE-01 | Phase 3 | Pending |
| SCRAPE-02 | Phase 4 | Pending |
| SCRAPE-03 | Phase 3 | Pending |
| SCRAPE-04 | Phase 3 | Pending |
| SCRAPE-05 | Phase 4 | Pending |
| SCRAPE-06 | Phase 3 | Pending |
| SCRAPE-07 | Phase 3 | Pending |
| TRACK-01 | Phase 1 | Pending |
| TRACK-02 | Phase 1 | Pending |
| TRACK-03 | Phase 5 | Pending |
| TRACK-04 | Phase 5 | Pending |
| TRACK-05 | Phase 5 | Pending |
| MATCH-01 | Phase 3 | Pending |
| MATCH-02 | Phase 3 | Pending |
| MATCH-03 | Phase 3 | Pending |
| MATCH-04 | Phase 3 | Pending |
| DOWNLOAD-01 | Phase 3 | Pending |
| DOWNLOAD-02 | Phase 3 | Pending |
| DOWNLOAD-03 | Phase 3 | Pending |
| DOWNLOAD-04 | Phase 3 | Pending |
| DOWNLOAD-05 | Phase 3 | Pending |
| DEPLOY-01 | Phase 7 | Pending |
| DEPLOY-02 | Phase 7 | Pending |
| DEPLOY-03 | Phase 7 | Pending |
| CLEANUP-01 | Phase 1 | Pending |
| CLEANUP-02 | Phase 1 | Pending |
| CLEANUP-03 | Phase 1 | Pending |
| CLEANUP-04 | Phase 1 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

**Per-phase distribution:**
- Phase 1 (Schema reset & spotdl removal): 6 (TRACK-01, TRACK-02, CLEANUP-01, CLEANUP-02, CLEANUP-03, CLEANUP-04)
- Phase 2 (Spotify session): 3 (AUTH-01, AUTH-02, AUTH-04)
- Phase 3 (Playlist happy-path slice): 14 (SCRAPE-01, SCRAPE-03, SCRAPE-04, SCRAPE-06, SCRAPE-07, MATCH-01, MATCH-02, MATCH-03, MATCH-04, DOWNLOAD-01, DOWNLOAD-02, DOWNLOAD-03, DOWNLOAD-04, DOWNLOAD-05)
- Phase 4 (Album + incremental rescrape): 2 (SCRAPE-02, SCRAPE-05)
- Phase 5 (Per-track UI & retry): 3 (TRACK-03, TRACK-04, TRACK-05)
- Phase 6 (Session-expiry surfaces): 3 (AUTH-05, AUTH-06, AUTH-07)
- Phase 7 (Docker + CLI deploy): 4 (AUTH-03, DEPLOY-01, DEPLOY-02, DEPLOY-03)

---
*Requirements defined: 2026-04-23*
*Last updated: 2026-04-23 — traceability populated by gsd-roadmapper (35/35 mapped)*
