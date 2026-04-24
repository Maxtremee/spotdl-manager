# Spike Wrap-Up Summary

**Date:** 2026-04-24
**Spikes processed:** 2
**Feature areas:** Spotify metadata scraping
**Skill output:** `./.claude/skills/spike-findings-spotdl-manager/`

## Processed Spikes

| # | Name | Type | Verdict | Feature Area |
|---|------|------|---------|--------------|
| 001 | spotifyscraper-feasibility | standard | ✓ VALIDATED (with caveats) | Spotify metadata scraping |
| 002 | spotifyscraper-large-playlist | standard | ✗ INVALIDATED (100-track cap) | Spotify metadata scraping |

## Key Findings

- **`spotifyscraper` v2.1.5 fetches public Spotify metadata against the live web player as of 2026-04-24** — no auth, no Chromium, <0.5s per fetch. Covers `title`, `duration_ms`, `artist` (for playlists), and ordering correctly.
- **Field traps, not showstoppers (001):**
  - `id` is always empty — derive `spotify_track_id` from `track.uri.split(":")[-1]`.
  - Album tracks have no `artists` field — fall back to `album.artists[0].name`, which fails for Various-Artists compilations.
- **Showstopper for larger playlists (002):** library uses Spotify's `/embed/playlist/` endpoint, hard-capped at 100 tracks by Spotify itself. `track_count` is also capped, so truncation is invisible. No pagination API exists in the library. Albums are unaffected.
- **Signal for the real build:** choosing `spotifyscraper` only makes sense if the project's practical scope is albums + short playlists. Any "works for playlists of any size" requirement forces either a hybrid (spotifyscraper + Playwright fallback) — which keeps the Chromium cost — or staying with PROJECT.md's original Playwright + saved-session plan outright.
- **Conventions that emerged:** per-spike Python venv layout, dual happy-path + edge-case test files, verifying suspicious library behavior against raw endpoints with `curl` + `inspect.getsource`. Captured in `.planning/spikes/CONVENTIONS.md`.
