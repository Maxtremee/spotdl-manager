# Spike Manifest

## Idea

Evaluate whether the Python package [`spotifyscraper`](https://pypi.org/project/spotifyscraper/) (v2.1.5, Jun 2025) can replace the planned custom Playwright + saved-session scraping pipeline for Spotify playlist/album metadata. Upside: no login CLI, no session-expiry UX, no Chromium in the Docker image, HTTP-only path. Downside: third-party scraper can break whenever Spotify changes its web player; dependency on Python runtime inside a Node project.

## Requirements

<!-- Design decisions that emerge from spike findings. Locked when validated. -->

- **Public-playlist-only scope is a hard constraint if spotifyscraper is adopted.** The library has no login-walled playlist support; PROJECT.md's saved-session path would be dropped. (source: spike 001)
- **`spotify_track_id` must be derived from `track.uri.split(':')[-1]` — the library's `id` field is always empty.** (source: spike 001)
- **Albums: per-track `artist` must fall back to `album.artists[0].name`** — spotifyscraper omits per-track artists on albums. Implies compilation/various-artists albums are either out-of-scope or need per-track refetch. (source: spike 001)
- **spotifyscraper is hard-capped at 100 tracks per playlist — silently.** The library uses Spotify's `/embed/playlist/<id>` endpoint, which only emits the first 100 tracks in its `__NEXT_DATA__` blob. The returned `track_count` field is also capped, so callers cannot detect truncation from library output alone. Any adoption path must add a >100-track fallback. (source: spike 002)

## Spikes

| # | Name | Type | Validates | Verdict | Tags |
|---|------|------|-----------|---------|------|
| 001 | spotifyscraper-feasibility | standard | Given public Spotify playlist + album URLs, when `get_playlist_info`/`get_album_info` called, then required fields (title, artist, duration_ms, spotify_track_id) present in preserved order | ✓ VALIDATED | scraping, python, metadata |
| 002 | spotifyscraper-large-playlist | standard | Given playlist with 500+ tracks, when scraped, then full track list returned (not truncated) in reasonable time | ✗ INVALIDATED | scraping, python, pagination, blocker |
