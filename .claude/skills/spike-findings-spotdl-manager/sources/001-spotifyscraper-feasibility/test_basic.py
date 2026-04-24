"""Spike 001 — does spotifyscraper work against Spotify *today*?

Runs the library against a public playlist + album URL and dumps
enough of the response to judge whether the required fields
(title, artist, duration_ms, spotify_track_id, ordering) are there.
"""

import json
import sys
import time

from spotify_scraper import SpotifyClient

# Public, stable URLs
PLAYLIST_URL = "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"  # Today's Top Hits
ALBUM_URL = "https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy"  # Global Warming — Pitbull (stable legacy album)


def summarize_tracks(tracks, label):
    print(f"\n=== {label}: {len(tracks)} tracks ===")
    if not tracks:
        print("  <empty>")
        return
    first = tracks[0]
    print(f"\n-- sample track keys: {sorted(first.keys())}")
    print("\n-- first 3 tracks:")
    for i, t in enumerate(tracks[:3]):
        artist = (
            t.get("artists", [{}])[0].get("name")
            if isinstance(t.get("artists"), list)
            else t.get("artist")
        )
        print(
            f"  [{i}] id={t.get('id')!r:40} "
            f"name={t.get('name')!r:40} "
            f"artist={artist!r:25} "
            f"duration_ms={t.get('duration_ms')!r}"
        )

    required = {"id", "name", "duration_ms"}
    missing = [k for k in required if k not in first]
    artists_ok = isinstance(first.get("artists"), list) and first["artists"] and first["artists"][0].get("name")
    print(f"\n-- required-field check: missing={missing} artists_ok={artists_ok}")


def run():
    client = SpotifyClient()
    try:
        t0 = time.time()
        print(f"fetching playlist: {PLAYLIST_URL}")
        playlist = client.get_playlist_info(PLAYLIST_URL)
        print(f"  took {time.time() - t0:.2f}s")
        print(f"  top-level keys: {sorted(playlist.keys())}")
        print(f"  playlist name: {playlist.get('name')!r}")
        summarize_tracks(playlist.get("tracks", []), "playlist.tracks")

        t0 = time.time()
        print(f"\nfetching album: {ALBUM_URL}")
        album = client.get_album_info(ALBUM_URL)
        print(f"  took {time.time() - t0:.2f}s")
        print(f"  top-level keys: {sorted(album.keys())}")
        print(f"  album name: {album.get('name')!r}")
        summarize_tracks(album.get("tracks", []), "album.tracks")

        # Save full responses for deeper inspection
        with open("playlist_response.json", "w") as f:
            json.dump(playlist, f, indent=2, default=str)
        with open("album_response.json", "w") as f:
            json.dump(album, f, indent=2, default=str)
        print("\nfull responses written to playlist_response.json / album_response.json")

    except Exception as e:
        print(f"ERROR: {type(e).__name__}: {e}", file=sys.stderr)
        raise
    finally:
        client.close()


if __name__ == "__main__":
    run()
