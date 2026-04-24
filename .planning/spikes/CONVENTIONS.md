# Spike Conventions

Patterns and stack choices established across spike sessions in this project. New spikes follow these unless the question requires otherwise.

## Stack

- **Language for scrape/metadata spikes:** Python 3.x with a per-spike venv (`.venv/`). Rationale: the ecosystem of Spotify scraper/metadata libraries is Python-heavy; reaching for Python is faster than porting or shelling out for throwaway experiments. If a finding graduates to the real build, integration into the Node app is a separate concern (not a spike question).
- **Node/TS spikes:** use root `pnpm` / project `package.json` when the question lives inside the app's runtime path.

## Structure

- One spike = one directory: `.planning/spikes/NNN-descriptive-name/`.
- Spike's own venv lives at `NNN-.../.venv/` (gitignored).
- Python spikes: `test_<aspect>.py` files at spike root. Multiple files per spike when investigation demands it (e.g., `test_basic.py` + `test_edge_cases.py`).
- Network responses saved as `*_response.json` (gitignored) so deep inspection can happen outside the spike run.
- Summary results that are small and informative (e.g., `scale_results.json`) may be committed as evidence.

## Patterns

- **Investigate, don't just run the happy path.** 001 surfaced empty-`id` and missing-album-artist fields only because field coverage was explicitly audited. 002 surfaced the 100-cap only because a control + scale tier was run side by side.
- **Verify library claims against the raw endpoint.** If a library's behavior looks suspicious, hit the underlying HTTP endpoint with `curl` and compare. 002's 100-cap was confirmed this way.
- **Read library source when behavior is unexplained.** `inspect.getsource(...)` on the extractor revealed the `/embed/` URL choice that imposed the cap.
- **Stop-cases matter.** Before declaring VALIDATED, probe at least one edge (bad URL, big input, rate-limit burst) that would kill the idea if it fails.

## Tools & Libraries

- `spotifyscraper==2.1.5` — HTTP-only Spotify metadata scraper. Fast (<0.5s), no auth, but hard-capped at 100 tracks/playlist and returns empty `id` (salvage via `uri.split(':')[-1]`). Albums omit per-track artists. See spikes 001 + 002.

## Gitignore conventions

`.gitignore` carries:
```
.planning/spikes/**/.venv/
.planning/spikes/**/__pycache__/
.planning/spikes/**/*_response.json
```
