---
spike: 001
name: spotifyscraper-feasibility
type: standard
validates: "Given public Spotify playlist + album URLs, when get_playlist_info / get_album_info is called against Spotify today, then required fields (title, artist, duration_ms, spotify_track_id) are present with preserved ordering"
verdict: VALIDATED
related: [002]
tags: [scraping, python, metadata]
---

# Spike 001: spotifyscraper-feasibility

## What This Validates

Given public Spotify playlist + album URLs, when `get_playlist_info` / `get_album_info` is called against Spotify today, then required fields (title, artist, `duration_ms`, `spotify_track_id`) are present with preserved ordering.

## Research

`spotifyscraper` v2.1.5, released 2025-06-12 ([PyPI](https://pypi.org/project/spotifyscraper/), [docs](https://spotifyscraper.readthedocs.io/), [GitHub](https://github.com/AliAkhtari78/SpotifyScraper)). 303 commits, 5 open issues, Python 3.8+.

Approach comparison:

| Approach | Tool | Pros | Cons | Status |
|----------|------|------|------|--------|
| Playwright + saved session (PROJECT.md active plan) | Playwright (Chromium) | Full control, handles auth-only playlists, runs in-process (Node) | Chromium in Docker, session expiry UX, login CLI, maintenance burden | Planned |
| `spotifyscraper` (this spike) | requests (HTTP-only) | No auth, no Chromium, tiny footprint, fast (<0.5s per playlist) | Third-party scraper breakage risk, Python runtime dependency, can't scrape private/login-walled playlists | Evaluating |
| Official Spotify Web API | `spotipy` | Stable, documented | The reason for the pivot — API locked down | Ruled out by PROJECT.md |

**Chosen approach for spike:** `spotifyscraper` default HTTP mode (no Selenium).

## How to Run

```bash
cd .planning/spikes/001-spotifyscraper-feasibility
python3 -m venv .venv
.venv/bin/pip install spotifyscraper
.venv/bin/python test_basic.py       # happy path
.venv/bin/python test_edge_cases.py  # invalid URL, bogus ID, VA compilation
```

## What to Expect

- `test_basic.py` fetches "Today's Top Hits" playlist + a public album, dumps field coverage, writes full JSON to `playlist_response.json` / `album_response.json`.
- `test_edge_cases.py` exercises invalid URL, bogus ID, compilation album. Invalid/bogus cases should raise `ParsingError`.

## Investigation Trail

**1. Basic fetch.** Both URLs returned in <0.5s without auth. Playlist: 50/50 tracks, album: 18/18 tracks. Top-level fields: `name`, `duration_ms`, `track_count`/`total_tracks`, `tracks`, `images`, `owner`, `uri`, `id`, `type`.

**2. Per-track field audit — surprise: `id` is empty string.** Playlist tracks: `{id: '', name, uri, type, duration_ms, artists: [{name, id: '', uri: '', type}]}`. Album tracks: `{id: '', name, uri, type, track_number, duration_ms}` — no `artists` field per-track.

**3. URI salvage.** `uri` field is always `spotify:track:<22-char-id>`. Verified shape for all 50 + 18 tracks; `uri.split(':')[-1]` yields a usable `spotify_track_id`. Same pattern on artist-level `uri` field (also empty `id`, non-empty `uri`).

**4. Album artist gap.** Albums return a top-level `artists` array but no per-track artist. For single-artist albums, album-level artist is the correct value for every track. For various-artists compilations, this would lose per-track artist info. Track name often includes "(feat. X)" substrings but primary artist is missing. **Flag as known limitation.**

**5. Playlist ordering.** Playlist `tracks` array preserved display order (matches "Today's Top Hits" on the web). Album `track_numbers` are sequential 1..N. PROJECT.md's "newest-to-oldest incremental rescrape with 5-consecutive-match stop" is feasible.

**6. Edge cases.** Malformed / non-existent IDs raise `spotify_scraper.core.exceptions.ParsingError` cleanly. No silent empty data. VA compilation ID I picked was a guess and 404'd — limitation is structural (no per-track artists in album response) and can be confirmed against a verified VA album during real build.

**7. Not tested here (see 002):** pagination for large playlists (500+), rate limiting behavior across bursts.

## Results

**Verdict: VALIDATED ✓** — with field-mapping caveats.

**Evidence:**
- Real Spotify URLs returned populated data against live web player (2026-04-24).
- All PROJECT.md required fields obtainable:
  - `title` → `track.name`
  - `artist` → playlist: `track.artists[0].name`; album: `album.artists[0].name` (fallback, single-artist albums only)
  - `duration_ms` → `track.duration_ms` (integer ms)
  - `spotify_track_id` → `track.uri.split(':')[-1]` (22-char, unique within test sets)
- Ordering preserved; incremental rescrape heuristic from PROJECT.md is feasible.
- Errors are exception-based and distinguishable from empty results.

**Surprises:**
- `id` field is always empty; use `uri`. Undocumented.
- Album tracks omit `artists` entirely — must be derived from album-level `artists` array.
- Fast (<0.5s) and no auth for public content — major simplification vs Playwright + login.

**Known limitations / signals for the build:**
- Various-Artists compilation albums will lose per-track artist. Scope risk: PROJECT.md "Out of Scope" does not exempt VA compilations. **Decision needed during planning:** either (a) detect + error on VA albums, (b) accept album.artists[0] for all tracks (wrong for VA), or (c) add a per-track fetch fallback (`get_track_info` on each URI) which would cost N extra requests.
- Private/login-walled playlists are NOT covered. PROJECT.md active plan uses a saved login session — switching to `spotifyscraper` sacrifices that. Public-only scope is a breaking constraint vs current plan.
- Scraper breakage risk is unmitigated — no official SLA. If Spotify changes the `__NEXT_DATA__` shape, the library breaks until v-next release.
