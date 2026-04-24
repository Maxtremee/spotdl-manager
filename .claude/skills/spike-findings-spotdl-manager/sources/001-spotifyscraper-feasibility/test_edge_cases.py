"""Spike 001 edge cases — private playlist, invalid URL, compilation album."""

import sys
import traceback

from spotify_scraper import SpotifyClient

CASES = [
    (
        "invalid-url-format",
        "playlist",
        "https://open.spotify.com/playlist/NOT_A_VALID_ID",
    ),
    (
        "bogus-playlist-id",
        "playlist",
        "https://open.spotify.com/playlist/0000000000000000000000",
    ),
    (
        # VA compilation — "NOW That's What I Call Music! Vol. 75" style
        # Using a widely-available compilation: "NOW 100 Hits Christmas"
        "compilation-various-artists",
        "album",
        "https://open.spotify.com/album/1aRY58MdsGTuLvQycS6cFi",  # Various Artists compilation
    ),
]


def run():
    client = SpotifyClient()
    try:
        for label, kind, url in CASES:
            print(f"\n=== {label} ({kind}): {url}")
            try:
                data = (
                    client.get_playlist_info(url)
                    if kind == "playlist"
                    else client.get_album_info(url)
                )
                print(f"  name={data.get('name')!r} tracks={len(data.get('tracks', []))}")
                if data.get("tracks"):
                    first = data["tracks"][0]
                    print(f"  first track keys: {sorted(first.keys())}")
                    artist = (
                        first.get("artists", [{}])[0].get("name")
                        if isinstance(first.get("artists"), list) and first.get("artists")
                        else None
                    )
                    print(f"  [0] name={first.get('name')!r} artist={artist!r}")
                    if kind == "album":
                        # Sample artists across tracks — is it per-track or only top-level?
                        print(f"  album top-level artists: {[a.get('name') for a in data.get('artists', [])]}")
                        per_track = [t.get('artists') for t in data['tracks'][:5]]
                        print(f"  per-track artists field (first 5): {per_track}")
            except Exception as e:
                print(f"  ERROR: {type(e).__name__}: {e}")
                traceback.print_exc(limit=2)
    finally:
        client.close()


if __name__ == "__main__":
    run()
