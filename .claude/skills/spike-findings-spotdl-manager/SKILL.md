---
name: spike-findings-spotdl-manager
description: Implementation blueprint from spike experiments for spotdl-manager. Requirements, proven patterns, and verified knowledge — especially the spotifyscraper Python library's capabilities and hard limits. Auto-loaded during implementation work.
---

<context>
## Project: spotdl-manager

Browser-based UI for managing Spotify playlist/album downloads, pivoting from the broken `spotdl` CLI to a custom scraping + yt-dlp pipeline. Spikes evaluated replacing the planned Playwright + saved-session path with the Python library `spotifyscraper`.

Spike sessions wrapped: 2026-04-24
</context>

<requirements>
## Requirements

Non-negotiable rules that emerged from spiking. Every feature area reference honors these:

- **Public-playlist-only scope is a hard constraint if `spotifyscraper` is adopted.** The library has no login-walled playlist support; PROJECT.md's saved-session path would be dropped. (source: spike 001)
- **`spotify_track_id` must be derived from `track.uri.split(':')[-1]` — the library's `id` field is always empty.** (source: spike 001)
- **Albums: per-track `artist` must fall back to `album.artists[0].name`** — spotifyscraper omits per-track artists on albums. Compilation/various-artists albums are either out-of-scope or need per-track refetch. (source: spike 001)
- **spotifyscraper is hard-capped at 100 tracks per playlist — silently.** The library uses Spotify's `/embed/playlist/<id>` endpoint, which only emits the first 100 tracks. The returned `track_count` is also capped, so callers cannot detect truncation from library output alone. Any adoption path needs a >100-track fallback. (source: spike 002)
</requirements>

<findings_index>
## Feature Areas

| Area | Reference | Key Finding |
|------|-----------|-------------|
| Spotify metadata scraping | `references/spotify-metadata-scraping.md` | `spotifyscraper` works fast + auth-free for albums and ≤100-track playlists, but silently truncates larger playlists and hides critical fields behind empty strings — full build needs a >100-track fallback or Playwright continuation |

## Source Files

Original spike source files are preserved in `sources/` for complete reference:

- `sources/001-spotifyscraper-feasibility/` — happy-path + edge-case probes, README with field audit
- `sources/002-spotifyscraper-large-playlist/` — scale probe across 5 playlists, raw `scale_results.json` showing 100-cap
</findings_index>

<metadata>
## Processed Spikes

- 001-spotifyscraper-feasibility
- 002-spotifyscraper-large-playlist
</metadata>
