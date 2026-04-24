---
status: partial
phase: 02-spotify-metadata-spotifyscraper
source: [02-VERIFICATION.md, 02-06-PLAN.md]
started: 2026-04-24T14:50:00Z
updated: 2026-04-24T14:50:00Z
---

## Current Test

[awaiting human Docker smoke]

## Tests

### 1. Python venv imports spotifyscraper
expected: `docker exec -it <dev-container> sh -c "/app/scraper/.venv/bin/python -c 'import spotify_scraper; print(spotify_scraper.__version__)'"` prints `2.1.5`
result: [pending]

### 2. Gated integration test runs inside container
expected: `docker exec -it <dev-container> sh -c "SCRAPER_INTEGRATION=1 pnpm test -- integration"` — 2 tests pass (or 1 pass + 1 network_error early-return)
result: [pending]

### 3. UI — add playlist and click Sync-now
expected: Visit `http://localhost:3000`, Library → Add playlist → paste `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M` → set output dir `/data/music/test-phase-2` → submit → open detail page → click "Sync now" → toast "Sync started"
result: [pending]

### 4. tracks table populated with pending rows
expected: `docker exec -it <dev-container> sqlite3 /app/data/db.sqlite "SELECT count(*), state FROM tracks GROUP BY state;"` — ≥1 row with `state = pending`, count ≤ 100
result: [pending]

### 5. sources.cover_art_url populated (SCRAPE-07)
expected: `docker exec -it <dev-container> sqlite3 /app/data/db.sqlite "SELECT name, cover_art_url FROM sources;"` — `cover_art_url` is non-null `https://...` CDN URL
result: [pending]

### 6. invocations row records success + summary
expected: `docker exec -it <dev-container> sqlite3 /app/data/db.sqlite "SELECT status, summary FROM invocations ORDER BY started_at DESC LIMIT 1;"` — `status = success`, summary JSON contains `track_count: N, truncation_suspected: false`
result: [pending]

### 7. (Optional) Discord webhook renders extended fields
expected: If Discord webhook configured — completion message shows trackCount line; for ≥100-track playlist, "⚠️ possibly truncated" note appears; failure-path messages show `reason: \`not_found\`` enum
result: [pending]

## Summary

total: 7
passed: 0
issues: 0
pending: 7
skipped: 0
blocked: 0

## Gaps
