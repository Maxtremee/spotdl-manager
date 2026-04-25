"""
Spotify playlist metadata scraper — stdin-reader bridge for Node↔Python IPC.

## IO Contract

Request (Node → Python stdin, single-line JSON):
    {"url": "https://open.spotify.com/playlist/<id>", "source_type": "playlist"}

Response envelope (Python → Node stdout, single JSON blob):
    On success:
        {
            "tracks": [
                {
                    "spotify_track_id": "6gkbtMtioHgtyGjrMel6ei",
                    "title": "Track title",
                    "artist": "Primary artist name",
                    "duration_ms": 214000,
                    "position": 0
                }
            ],
            "cover_art_url": "https://image-cdn-fa.spotifycdn.com/image/...",
            "error": null
        }

    On handled failure:
        {
            "tracks": null,
            "cover_art_url": null,
            "error": {"type": "invalid_url|not_found|parse_error|network_error", "message": "..."}
        }

## Exit Code Contract

- Exit 0: Always when an envelope is successfully emitted — including handled errors.
  Node's bridge (Plan 03) classifies failures by error.type in the envelope.
- Exit 2: Only on unhandled exceptions (no envelope emitted). Node classifies as
  python_crash. Traceback goes to stderr only, never to the stdout envelope.

## Scale Note

stdout is bounded by spotifyscraper's single-request design: one playlist → one JSON
response carrying ≤100 tracks (<100 KB total). No streaming or chunked response (T-2-06).
"""

import json
import sys
import traceback

import requests
from spotify_scraper import SpotifyClient
from spotify_scraper.core.exceptions import ParsingError


def _uri_to_track_id(uri: str) -> str:
    """Derive the Spotify track ID from the track URI.

    spike 001: track.id is always '' — use uri.split(':')[-1]
    URI format: 'spotify:track:<22-char-base62-id>'
    """
    return uri.split(":")[-1]  # spike 001: track.id is always '' — use uri.split(':')[-1]


def _largest_image_url(images: list) -> str | None:
    """Return the URL of the image with the largest width, or None for an empty list.

    Uses .get("width") or 0 to handle missing width keys defensively.
    """
    if not images:
        return None
    largest = max(images, key=lambda img: img.get("width") or 0)
    return largest.get("url")


def _normalize(playlist: dict) -> tuple[list[dict], str | None]:
    """Normalize the spotifyscraper playlist response into the Node envelope contract.

    Returns a tuple of (tracks, cover_art_url) where:
    - tracks: list of dicts with spotify_track_id, title, artist, duration_ms, position
    - cover_art_url: URL of the largest cover image, or None

    Skips any track entry where uri is falsy (defensive; spike showed this
    never happens on real playlists, but protects against edge cases).
    """
    raw_tracks = playlist.get("tracks") or []
    tracks = []
    position = 0

    for t in raw_tracks:
        uri = t.get("uri")
        if not uri:
            # Defensive skip: spike 001 showed uri is always populated for playlist tracks
            continue

        artists = t.get("artists") or []
        artist = artists[0].get("name", "") if artists else ""

        tracks.append(
            {
                "spotify_track_id": _uri_to_track_id(uri),
                "title": t.get("name") or "",
                "artist": artist,
                "duration_ms": int(t.get("duration_ms") or 0),
                "position": position,
            }
        )
        position += 1

    images = playlist.get("images") or []
    cover_art_url = _largest_image_url(images)

    return tracks, cover_art_url


def _emit(envelope: dict) -> None:
    """Write the JSON envelope to stdout and flush immediately."""
    sys.stdout.write(json.dumps(envelope))
    sys.stdout.flush()


def main() -> int:
    """Read a single JSON request from stdin and write a single JSON envelope to stdout.

    Returns:
        0 — on any emitted envelope (success or handled error)
        2 — on unhandled exception (no envelope emitted; traceback on stderr only)
    """
    # Read entire stdin (Node closes the pipe after writing the single-line request)
    raw = sys.stdin.read()

    # Parse the JSON request
    try:
        request = json.loads(raw)
    except Exception as e:
        _emit(
            {
                "tracks": None,
                "cover_art_url": None,
                "error": {"type": "invalid_url", "message": f"bad request: {e!r}"},
            }
        )
        return 0

    url = request.get("url", "")
    source_type = request.get("source_type", "")

    # Phase 2 only supports playlists; album support is Phase 4
    if source_type != "playlist":
        _emit(
            {
                "tracks": None,
                "cover_art_url": None,
                "error": {
                    "type": "invalid_url",
                    "message": f"unsupported source_type '{source_type}'; only 'playlist' is supported in Phase 2",
                },
            }
        )
        return 0

    client = SpotifyClient()
    try:
        data = client.get_playlist_info(url)
    except ParsingError as e:
        msg = str(e)
        # Map ParsingError to not_found vs parse_error based on message content
        error_type = (
            "not_found"
            if ("not found" in msg.lower() or "404" in msg)
            else "parse_error"
        )
        _emit(
            {
                "tracks": None,
                "cover_art_url": None,
                "error": {"type": error_type, "message": msg},
            }
        )
        return 0
    except requests.exceptions.RequestException as e:
        _emit(
            {
                "tracks": None,
                "cover_art_url": None,
                "error": {"type": "network_error", "message": str(e)},
            }
        )
        return 0
    except Exception as e:
        # Unhandled exception — write traceback to stderr only, no envelope emitted
        sys.stderr.write(f"UNEXPECTED: {type(e).__name__}: {e}\n")
        traceback.print_exc(file=sys.stderr)
        return 2
    finally:
        client.close()

    # Normalize the successful response
    tracks, cover_art_url = _normalize(data)

    _emit(
        {
            "tracks": tracks,
            "cover_art_url": cover_art_url,
            "error": None,
        }
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
