"""Spike 002 — does spotifyscraper return full track lists for large playlists?

Tests multiple public playlists across size tiers. If len(tracks) matches
track_count reported by the library, pagination works. If len(tracks) is
silently capped, pagination is missing — killer for our use case.
"""

import json
import sys
import time

from spotify_scraper import SpotifyClient

# Public editorial and user playlists of varying sizes.
# Editorial playlists (37i9 prefix) have stable URLs.
# RapCaviar and the "All Out" decade playlists typically hold 50-200 tracks.
# User "mega-playlists" on Spotify regularly exceed 1,000 tracks.
CASES = [
    # Editorial 50-track playlist — control (same as spike 001 baseline)
    ("control-50", "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"),
    # Editorial mid-size
    ("rap-caviar", "https://open.spotify.com/playlist/37i9dQZF1DX0XUsuxWHRQd"),
    # Editorial — "All Out 2010s" historically 150+
    ("all-out-2010s", "https://open.spotify.com/playlist/37i9dQZF1DX5Ejj0EkURtP"),
    # Editorial — "Today's Top Hits" variants kept for fallback
    ("rock-classics", "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U"),
    # Large user playlist — "The Longest Playlist on Spotify" (public, reportedly 10K+ tracks)
    # ID sourced from multiple public "biggest Spotify playlists" articles (2024-2025).
    ("mega-user-playlist", "https://open.spotify.com/playlist/4rnleEAOdmFAbRcNCgZMpY"),
]


def test_one(client, label, url):
    print(f"\n=== {label}: {url}")
    t0 = time.time()
    try:
        p = client.get_playlist_info(url)
    except Exception as e:
        print(f"  ERROR: {type(e).__name__}: {e}")
        return {"label": label, "error": str(e)}
    elapsed = time.time() - t0

    tracks = p.get("tracks", [])
    track_count = p.get("track_count")
    uris = [t.get("uri") for t in tracks if t.get("uri")]
    unique_uris = len(set(uris))

    result = {
        "label": label,
        "name": p.get("name"),
        "track_count_reported": track_count,
        "len_tracks_returned": len(tracks),
        "unique_uris": unique_uris,
        "elapsed_s": round(elapsed, 2),
        "truncated": track_count is not None and len(tracks) < track_count,
    }
    print(f"  name={result['name']!r}")
    print(f"  reported track_count={track_count}  len(tracks)={len(tracks)}  unique_uris={unique_uris}")
    print(f"  took {elapsed:.2f}s")
    if result["truncated"]:
        gap = track_count - len(tracks)
        print(f"  ⚠ TRUNCATED: missing {gap} tracks ({gap/track_count:.0%})")
    return result


def run():
    client = SpotifyClient()
    results = []
    try:
        for label, url in CASES:
            results.append(test_one(client, label, url))
            # Respect the docs' rate-limit advice
            time.sleep(0.5)
    finally:
        client.close()

    print("\n\n=== SUMMARY ===")
    print(f"{'label':25} {'reported':>10} {'returned':>10} {'unique':>8} {'elapsed_s':>10} {'truncated':>10}")
    for r in results:
        if "error" in r:
            print(f"{r['label']:25} ERROR: {r['error']}")
            continue
        print(
            f"{r['label']:25} "
            f"{str(r['track_count_reported']):>10} "
            f"{r['len_tracks_returned']:>10} "
            f"{r['unique_uris']:>8} "
            f"{r['elapsed_s']:>10} "
            f"{str(r['truncated']):>10}"
        )

    with open("scale_results.json", "w") as f:
        json.dump(results, f, indent=2, default=str)
    print("\nfull results written to scale_results.json")


if __name__ == "__main__":
    run()
