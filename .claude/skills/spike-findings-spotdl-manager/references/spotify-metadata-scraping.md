# Spotify Metadata Scraping

## Requirements

Non-negotiable rules if the `spotifyscraper` library is adopted (from spikes 001 + 002):

- **Public playlists/albums only.** No login-walled playlist support exists. If the real build needs private playlists, this library cannot deliver — fall back to PROJECT.md's Playwright + saved-session path.
- **Derive `spotify_track_id` from `track.uri.split(":")[-1]`.** The library's `id` field is always empty string. The `uri` is always `spotify:track:<22-char-id>` and was consistent across every track tested.
- **Albums: per-track `artist` = `album.artists[0].name`.** The library omits per-track artists on album responses. This is correct for single-artist albums and wrong for Various-Artists compilations. Decision during build: either mark VA albums out-of-scope, detect + error, or issue N per-track `get_track_info` refetches.
- **Playlists > 100 tracks are silently truncated.** The library uses Spotify's `/embed/playlist/<id>` endpoint, which Spotify itself caps at 100. The returned `track_count` is also truncated — callers cannot detect truncation from library output alone. Any production use MUST check `len(tracks)` against a trusted source (e.g., Playwright probe of the canonical URL) or cap scope to albums + short playlists.

## How to Build It

### Install

```bash
pip install spotifyscraper    # Python 3.8+; last tested v2.1.5 (2025-06-12)
```

### Fetch playlist / album

```python
from spotify_scraper import SpotifyClient

client = SpotifyClient()
try:
    playlist = client.get_playlist_info("https://open.spotify.com/playlist/<id>")
    album = client.get_album_info("https://open.spotify.com/album/<id>")
finally:
    client.close()
```

### Normalize into PROJECT.md's track shape

```python
def uri_to_track_id(uri: str) -> str:
    # e.g. "spotify:track:6gkbtMtioHgtyGjrMel6ei" -> "6gkbtMtioHgtyGjrMel6ei"
    return uri.split(":")[-1]

def normalize_playlist_tracks(playlist: dict) -> list[dict]:
    return [
        {
            "spotify_track_id": uri_to_track_id(t["uri"]),
            "title": t["name"],
            "artist": t["artists"][0]["name"],  # playlist tracks carry artists
            "duration_ms": t["duration_ms"],
        }
        for t in playlist["tracks"]
    ]

def normalize_album_tracks(album: dict) -> list[dict]:
    fallback_artist = album["artists"][0]["name"]  # album-level only; wrong for VA comps
    return [
        {
            "spotify_track_id": uri_to_track_id(t["uri"]),
            "title": t["name"],
            "artist": fallback_artist,
            "duration_ms": t["duration_ms"],
            "track_number": t.get("track_number"),
        }
        for t in album["tracks"]
    ]
```

### Error paths

- Invalid URL / nonexistent playlist/album → `spotify_scraper.core.exceptions.ParsingError`. Catch, map to `playlist.sync.failed` with a specific reason.
- Network failure → underlying `requests.exceptions.*` propagates up; wrap with a retry policy if needed.

### Scale guard (mandatory)

```python
MAX_SUPPORTED = 100

def fetch_playlist_safe(client, url):
    data = client.get_playlist_info(url)
    if len(data["tracks"]) >= MAX_SUPPORTED:
        # Library returned exactly 100 — may be truncated, we can't tell.
        # Either verify size with a Playwright probe, or refuse.
        raise ValueError(
            f"Playlist returned {len(data['tracks'])} tracks — possible "
            "silent truncation at Spotify's embed cap. Use a fallback scraper."
        )
    return data
```

## What to Avoid

- **Don't use the library's `id` field directly.** It's always empty. Always go through `uri`.
- **Don't trust `track_count` for large playlists.** It equals `len(tracks)` and both lie when the playlist exceeds 100. Cross-check against the canonical playlist page or a Playwright probe.
- **Don't pass the non-embed URL hoping for more data.** `GET /playlist/<id>` returns only ~30 URIs as preload hints. Worse than embed. Spotify lazy-loads the rest via authenticated GraphQL.
- **Don't try to paginate via library kwargs.** `SpotifyClient` has no `offset`/`limit` — the extractor is single-request by design.
- **Don't assume per-track `artist` on album responses.** Only top-level `album.artists` is populated.
- **Don't rely on undocumented fields silently.** Document every field derived from `uri` or fallback (the library may change these in a minor release and break the app).

## Constraints

- **Hard cap:** 100 tracks per playlist. Blocker for long user-maintained playlists.
- **No authentication path:** anything login-walled (private playlists, market-locked content, lyrics) is unreachable without cookies — and cookies are only wired for the `get_track_info_with_lyrics` method.
- **Third-party scraper risk:** no SLA from Spotify. If Spotify changes the `__NEXT_DATA__` shape in the embed endpoint, the library breaks until a new release ships.
- **Python runtime dependency:** adopting this means shipping Python alongside Node in the Docker image (or a spawn-per-invocation pattern). Not a spike question — call during planning.
- **Version tested:** 2.1.5, released 2025-06-12. Claims Python 3.8+; verified on 3.14.4.
- **Performance:** <0.5s per fetch observed (single request, no JS execution). Docs recommend ≥0.5s between requests to be polite.

## Origin

Synthesized from spikes: 001, 002
Source files available in: `sources/001-spotifyscraper-feasibility/`, `sources/002-spotifyscraper-large-playlist/`
