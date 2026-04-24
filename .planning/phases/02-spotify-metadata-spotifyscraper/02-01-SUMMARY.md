---
phase: 02-spotify-metadata-spotifyscraper
plan: 01
subsystem: scraper-python-bridge
tags: [python, docker, scraper, bridge, stdio-json, spotifyscraper]

dependency_graph:
  requires: []
  provides:
    - scraper/scraper.py (Python stdin-reader bridge entry point)
    - scraper/requirements.txt (pinned spotifyscraper==2.1.5)
    - Dockerfile python3+venv layer at /app/scraper/.venv
    - Dockerfile.dev python3+venv layer at /app/scraper/.venv
  affects:
    - Dockerfile (Stage 2 apt-get, scraper COPY+venv blocks)
    - Dockerfile.dev (apt-get, scraper COPY+venv block)
    - .gitignore (scraper/.venv exclusion)
    - .dockerignore (scraper/.venv exclusion)

tech_stack:
  added:
    - python3 (system package, apt)
    - python3-venv (system package, apt)
    - spotifyscraper==2.1.5 (Python library, pinned)
  patterns:
    - stdin-JSON → stdout-JSON subprocess bridge
    - always-exit-0 on emitted envelope (including handled errors)
    - exit-2 only on unhandled exception (no envelope emitted)
    - uri.split(":")[-1] for spotify_track_id derivation (spike 001 landmine fix)
    - largest-image selection by max(width) for cover_art_url

key_files:
  created:
    - scraper/scraper.py
    - scraper/requirements.txt
    - scraper/.gitignore
  modified:
    - Dockerfile
    - Dockerfile.dev
    - .gitignore
    - .dockerignore

decisions:
  - "D-02 honored: IO contract is stdin-JSON → stdout-JSON, not CLI args"
  - "D-03 honored: Python code at scraper/ repo root, venv at scraper/.venv/ (gitignored)"
  - "D-04 honored: no host venv bootstrap; venv lives inside Docker image only"
  - "D-09 honored: four typed error enums (invalid_url, not_found, parse_error, network_error) + python_crash convention via exit-2"
  - "D-10 honored: no ValueError raised on len==100; truncation flag is Node-side concern (Plan 05)"
  - "T-2-07 mitigated: COPY --chown=node:node + chown -R node:node before USER node in prod Dockerfile"
  - "DEPLOY-01 compliance: no Chromium or Playwright in either Dockerfile"
  - "Comment text adjusted: removed literal word 'Chromium' from comments to satisfy grep-based acceptance criterion; meaning preserved as 'no browser engine required'"

metrics:
  duration_minutes: 3
  completed_date: "2026-04-24T11:53:55Z"
  tasks_completed: 3
  tasks_total: 3
  files_created: 3
  files_modified: 4
---

# Phase 02 Plan 01: Python scraper bridge with spotifyscraper venv baked into Docker image

**One-liner:** stdin-reader Python bridge normalizing spotifyscraper playlist response to Node envelope contract, with spotifyscraper==2.1.5 venv baked into both Docker images at /app/scraper/.venv.

## Tasks Completed

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Create Python scraper bridge script and requirements.txt | ad93d07 | scraper/scraper.py, scraper/requirements.txt, scraper/.gitignore |
| 2 | Add python3+venv install layer to Dockerfile and Dockerfile.dev | 3b616f9 | Dockerfile, Dockerfile.dev |
| 3 | Exclude scraper build artifacts from git and docker context | 9bab922 | .gitignore, .dockerignore |

## What Was Built

### scraper/scraper.py

Python 3.11 single-file stdin-reader bridge (210 lines). Reads a JSON request from stdin, calls `SpotifyClient.get_playlist_info(url)`, normalizes the response, and writes a single JSON envelope to stdout.

Key implementation details:
- `_uri_to_track_id(uri)` derives `spotify_track_id` via `uri.split(":")[-1]` — the library's `id` field is always empty (spike 001 finding)
- `_largest_image_url(images)` picks the image with max `width` for `cover_art_url`
- `_normalize(playlist)` builds the track list with `position` from enumerate index, skips falsy URIs defensively
- Four handled error types emitted as envelopes with exit 0: `invalid_url`, `not_found`, `parse_error`, `network_error`
- Unhandled exceptions write traceback to stderr only and exit 2 (no envelope — Node classifies as `python_crash`)
- Phase 2 only accepts `source_type == "playlist"`; non-playlist types get `invalid_url` envelope

### scraper/requirements.txt

Single line: `spotifyscraper==2.1.5` — exact pin per D-03, verified against PyPI on 2026-04-24.

### Dockerfile changes (Stage 2 only)

- Added `python3 python3-venv` to the Stage 2 apt-get install line
- Added COPY + venv build block before `USER node`:
  - `COPY --chown=node:node scraper ./scraper`
  - `RUN python3 -m venv /app/scraper/.venv && pip install ... && chown -R node:node /app/scraper`
- Header comment updated to reflect Phase 2 pivot

### Dockerfile.dev changes

- Added `python3 python3-venv` to the apt-get install line
- Added COPY + venv build block (no chown — dev image runs as root)
- Header comment updated to reflect Phase 2 pivot

### Ignore file changes

- `.gitignore`: Phase 2 scraper section added — `scraper/.venv/`, `scraper/__pycache__/`, `scraper/**/*.pyc`
- `.dockerignore`: Phase 2 scraper section added — same exclusions (not `scraper/` wholesale, so Dockerfile COPY still picks up `scraper.py` and `requirements.txt`)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Comment text adjusted to avoid grep false-positive**

- **Found during:** Task 2 acceptance criteria check
- **Issue:** Plan's acceptance criterion `! grep -qi 'chromium\|playwright' Dockerfile Dockerfile.dev` was failing because the plan's own suggested comment text `"no Chromium required"` contains the word "Chromium". The grep is case-insensitive.
- **Fix:** Changed comment text from `"spotifyscraper replaces spotdl — no Chromium required"` to `"spotifyscraper replaces spotdl — no browser engine required"`. Meaning is fully preserved; the word "Chromium" was removed only from comments.
- **Files modified:** Dockerfile, Dockerfile.dev
- **Commit:** 3b616f9

## Known Stubs

None — all artifacts are fully implemented and wired. The Python script is a complete implementation; the Docker layers install real packages; the ignore files are complete.

## Threat Flags

None — no new Node network endpoints, no new auth paths, no new file access patterns beyond what the plan's threat model covers. The T-2-07 (TOCTOU) mitigation is implemented as specified (chown before USER node).

## Self-Check: PASSED

- `scraper/scraper.py` exists: VERIFIED
- `scraper/requirements.txt` exists with `spotifyscraper==2.1.5`: VERIFIED
- `scraper/.gitignore` exists: VERIFIED
- `python3 -m venv /app/scraper/.venv` in Dockerfile: VERIFIED
- `python3 -m venv /app/scraper/.venv` in Dockerfile.dev: VERIFIED
- `COPY --chown=node:node scraper ./scraper` in Dockerfile: VERIFIED
- `chown -R node:node /app/scraper` in Dockerfile: VERIFIED
- `scraper/.venv/` in .gitignore: VERIFIED
- `scraper/.venv/` in .dockerignore: VERIFIED
- `scraper/` NOT wholesale excluded from .dockerignore: VERIFIED
- No chromium/playwright in either Dockerfile: VERIFIED
- Python syntax valid: VERIFIED
- Commits ad93d07, 3b616f9, 9bab922 exist: VERIFIED
