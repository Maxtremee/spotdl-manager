---
spike: 002
name: spotifyscraper-large-playlist
type: standard
validates: "Given a playlist with 500+ tracks, when scraped, then the full track list is returned (not silently truncated) in reasonable time"
verdict: INVALIDATED
related: [001]
tags: [scraping, python, pagination, blocker]
---

# Spike 002: spotifyscraper-large-playlist

## What This Validates

Given a public playlist with 500+ tracks, when `get_playlist_info` is called, then the full track list is returned (not silently truncated) in reasonable time.

## Research

Library docs don't mention pagination or `offset`/`limit` parameters. Spike 001 hit only 50-track playlists, so this is the first real scale probe. Hypothesis going in: either (a) the library paginates transparently, (b) exposes an offset param, or (c) is hard-capped.

Read `SpotifyClient` public surface — only single-call methods (`get_playlist_info(url)`), no iterator, no offset kwarg. Read `PlaylistExtractor.extract` source: it calls `convert_to_embed_url()` → `GET /embed/playlist/<id>` → parse `__NEXT_DATA__` → return.

## How to Run

```bash
cd .planning/spikes/002-spotifyscraper-large-playlist
python3 -m venv .venv
.venv/bin/pip install spotifyscraper
.venv/bin/python test_scale.py
```

## What to Expect

Probes 5 playlists of varying advertised sizes. For each: fetch, compare `len(tracks)` to reported `track_count`, flag truncation. Summary table written to stdout; raw results to `scale_results.json`.

## Investigation Trail

**1. Ran 5 playlists across size tiers.** Every result ≥ 100 tracks returned **exactly 100**:

| label | reported `track_count` | `len(tracks)` returned | unique URIs | elapsed |
|-------|------:|------:|------:|--------:|
| control-50 (Today's Top Hits) | 50 | 50 | 50 | 0.27s |
| rap-caviar | 50 | 50 | 50 | 0.55s |
| all-out-2010s | 100 | 100 | 100 | 0.51s |
| rock-classics | 100 | 100 | 100 | 0.42s |
| mega-user-playlist ("biggest playlist ever") | 100 | 100 | 100 | 0.52s |

"All Out 2010s", "Rock Classics", and any user mega-playlist holding 1000+ tracks all reporting exactly 100 was the tell. Not a coincidence.

**2. Traced the call path in library source.** `PlaylistExtractor.extract` calls `convert_to_embed_url()`, which rewrites any playlist URL to `https://open.spotify.com/embed/playlist/<id>`. The embed endpoint's `__NEXT_DATA__` blob carries only the first page of tracks — Spotify's web player lazy-loads more via authenticated GraphQL calls as the user scrolls.

**3. Verified the cap against the raw endpoint.** Hit the embed URL directly with curl and parsed `props.pageProps.state.data.entity.trackList`: exactly 100 entries. Even `track_count` in the response is capped — the library isn't hiding the rest, Spotify's embed HTML itself stops at 100.

**4. Probed the non-embed URL as fallback.** `GET /playlist/<id>` returns a 340KB HTML page with no `__NEXT_DATA__` script and only 30 unique `spotify:track:…` URIs (preload hints, not data). The main page lazy-loads the track list via authenticated GraphQL too. The non-embed path is not a recoverable source.

**5. No pagination API exists in the library.** `SpotifyClient` has no offset/limit kwargs; extractor is single-request. Extending the library would require re-implementing the authenticated GraphQL calls — which is exactly what PROJECT.md's Playwright-with-saved-session plan already does.

**6. Not tested** (unneeded after the cap was confirmed): rate-limit behavior over bursts, very-small-playlist (1-5 tracks) edge cases. Both are low-value given the 100-cap kill.

## Results

**Verdict: INVALIDATED ✗ for playlists > 100 tracks.**

Partial coverage:
- ✓ Playlists ≤ 100 tracks: full list returned correctly (confirmed up through 100)
- ✗ Playlists > 100 tracks: silently truncated at 100 — `track_count` field also lies, making the truncation invisible to callers
- ✓ Albums: unaffected — 001 got 18/18 on an 18-track album, and album URIs use a different endpoint pattern. Albums rarely exceed 100 tracks.

**Surprises:**
- The silent lie: `track_count` returned by the library matches the truncated list, not the true playlist size. A caller can't even detect "was this truncated" from the library's own output.
- The library uses the `/embed/` URL variant, not the canonical playlist URL — that choice is what imposes the cap, and it's baked into the extractor.

**Signal for the build:**
- For this project's use case (playlists of any size), spotifyscraper alone is insufficient.
- Escape hatches:
  1. **Hybrid**: spotifyscraper for albums + ≤100 playlists, Playwright fallback for >100 playlists. Keeps complexity.
  2. **Bypass**: drop spotifyscraper, stay with PROJECT.md's Playwright + saved session plan. Higher footprint (Chromium) but covers all sizes.
  3. **Contribute upstream**: implement paginated GraphQL fetch in spotifyscraper. Still needs session token → collapses back to Playwright-equivalent work.
- The "no Chromium, no login CLI, no session expiry" upside from spike 001 **does not survive** if we need any playlist >100 tracks.
