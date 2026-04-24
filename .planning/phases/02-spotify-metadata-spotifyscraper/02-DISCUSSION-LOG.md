# Phase 2: Spotify metadata via spotifyscraper - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-24
**Phase:** 02-spotify-metadata-spotifyscraper
**Areas discussed:** Python bridge architecture, Scrape invocation & invocations table, 100-track truncation detection, Re-scrape behavior before Phase 4

---

## Python bridge architecture

| Option | Description | Selected |
|--------|-------------|----------|
| Subprocess per sync | `child_process.spawn('python3', …)` on each sync; cold start <200ms; stateless | ✓ |
| Long-lived Python stdio subprocess | One `python3` process at server startup; zero cold start; stateful, crash-recovery complexity | |
| HTTP sidecar (FastAPI) | Separate Python HTTP service on localhost; cleanest isolation; two processes, two ports | |

**User's choice:** Subprocess per sync (Recommended)
**Notes:** Stateless bridge preferred; cold-start cost negligible at this scale.

| Option | Description | Selected |
|--------|-------------|----------|
| CLI args + stdout JSON | `python scraper.py <url>` → stdout JSON; exit code for status | |
| stdin JSON → stdout JSON | JSON request on stdin, JSON response on stdout; more extensible | ✓ |
| You decide | Claude picks during planning | |

**User's choice:** stdin JSON → stdout JSON
**Notes:** Extensibility preferred over minimal ceremony; future option-passing (fallback toggles, timeouts) doesn't reshape the spawn call.

| Option | Description | Selected |
|--------|-------------|----------|
| `scraper/` at repo root | Top-level dir with `scraper.py`, `requirements.txt`, `.venv/` (gitignored) | ✓ |
| `src/modules/server/scraper/` | Python colocated with the TS module that spawns them | |
| `python/spotifyscraper-bridge/` | Namespaced for future multi-Python components | |

**User's choice:** `scraper/` at repo root (Recommended)
**Notes:** Clear language-boundary separation.

| Option | Description | Selected |
|--------|-------------|----------|
| `pnpm install:scraper` script | Bootstraps `scraper/.venv` locally; Node side invokes venv python | |
| System pip install (no venv) | Document `pip install -r scraper/requirements.txt`; pollutes system Python | |
| Docker-only (no local dev path) | Python never runs on host; devs use `pnpm docker:dev` for scrape work | ✓ |

**User's choice:** Docker-only (no local dev path)
**Notes:** Deliberate trade-off — repo hygiene over host-dev convenience. Planner must address vitest integration-test strategy given this.

---

## Scrape invocation & invocations table

| Option | Description | Selected |
|--------|-------------|----------|
| Full scrape pipeline inline | Scheduler tick body replaced with real scrape | ✓ |
| Keep scheduler stubbed, add separate scrape trigger | Scheduler stays event-only; on-demand server fn does scrape | |
| Both — scheduler calls same fn as manual button | Single `runSync(source)` function, two entry points | |

**User's choice:** Full scrape pipeline inline (Recommended)
**Notes:** Combined with the manual-button choice below, this effectively means one shared scrape function invoked from both scheduler and manual trigger.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — one row per scrape run | `invocations` row written at scrape start, updated on finish | ✓ |
| No — stay event-only until Phase 3 | Scrape emits events but no DB row | |

**User's choice:** Yes — one row per scrape run (Recommended)
**Notes:** Phase 1 D-03 deferred until a real engine existed — Phase 2 is it.

| Option | Description | Selected |
|--------|-------------|----------|
| Yes — unhide + wire to scrape | Phase 1 D-04 retired; button wired to shared scrape fn | ✓ |
| Keep hidden until Phase 3 | Only scheduled ticks trigger scrape | |
| Yes but disabled if scrape in progress | Concurrency-guarded button | |

**User's choice:** Yes — unhide + wire to scrape (Recommended)
**Notes:** Planner should extend the existing `runningPlaylists` Set guard to cover manual triggers too.

| Option | Description | Selected |
|--------|-------------|----------|
| Typed failure reasons on invocation | Enum: `invalid_url`, `not_found`, `parse_error`, `network_error`, `python_crash` | ✓ |
| Generic `scrape_failed` + stderr tail | Single failure bucket with last N lines of stderr | |

**User's choice:** Typed failure reasons on invocation (Recommended)
**Notes:** Phase 5 retry UI and Discord webhook branch on the reason; free-text would push classification cost downstream.

---

## 100-track truncation detection

| Option | Description | Selected |
|--------|-------------|----------|
| Warn on 100 + process anyway | All 100 tracks insert; `truncation_suspected` flag on invocation | ✓ |
| Hard-fail on 100 | Scrape aborts; no tracks inserted | |
| Silent accept | No detection logic | |
| You decide | Claude picks | |

**User's choice:** Warn on 100 + process anyway (Recommended)
**Notes:** The 100 returned tracks are real data; discarding them over *maybe-truncated* concern is worse than a flag.

| Option | Description | Selected |
|--------|-------------|----------|
| Invocation summary field | `invocations.summary.truncation_suspected: true` | ✓ |
| Discord webhook (reuse `playlist.sync.completed`) | New field on completed event payload | ✓ |
| Source-level sticky flag | New column on `sources` table | |
| Server log only (pino warn) | No user-facing surface | |

**User's choice:** Invocation summary field + Discord webhook (multi-select)
**Notes:** Event schema change: `PlaylistSyncCompletedEventSchema` gains optional `truncationSuspected: boolean`. Source-level sticky flag rejected — per-run summary is enough until Phase 5 per-source UI exists.

---

## Re-scrape behavior before Phase 4

| Option | Description | Selected |
|--------|-------------|----------|
| Full re-scrape + upsert on (source_id, spotify_track_id) | Every sync scrapes all, upserts all | ✓ |
| No-op if source has tracks | First sync populates; later syncs short-circuit | |
| Full replace (delete + re-insert) | Destructive; loses Phase 3 state | |
| Fail if tracks exist | Second sync errors until Phase 4 | |

**User's choice:** Full re-scrape + upsert (Recommended)
**Notes:** Behavior is correct in Phase 2; Phase 4 later adds the early-stop-after-5 optimization. Never touches `state`/`yt_video_id`/`download_path`/`failure_reason` on upsert — those are Phase 3's domain.

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite with current position | Reflects current Spotify order; `position` not a stable identifier | ✓ |
| Preserve original position from first insert | Stable across re-syncs; drifts from actual Spotify order | |

**User's choice:** Overwrite with current position (Recommended)
**Notes:** Unique key is `(source_id, spotify_track_id)`; `position` is informational.

| Option | Description | Selected |
|--------|-------------|----------|
| Leave untouched | Row stays, any MP3 stays on disk | ✓ |
| Mark with `removed_from_source` flag | Needs new column or state | |
| Delete the row (and later the file) | Aggressive; loses downloads | |

**User's choice:** Leave untouched (Recommended)
**Notes:** Drift tolerated; Phase 4 may revisit when incremental logic lands.

---

## Claude's Discretion

- Python script shape (argparse vs stdin reader, single-function vs class)
- Error-envelope JSON shape for Python → Node exception passing
- Drizzle upsert implementation (`onConflictDoUpdate` vs select-then-insert-or-update)
- Whether to extract a `ScraperRepository` or inline upsert in the scrape module
- Vitest strategy for the Python bridge boundary (factor spawn behind an interface, mock in unit tests)
- Logger namespacing (`Logger.get("Scraper")`, `Logger.get("PythonBridge")`)
- URL validation placement (reuse client-side regex vs re-validate server-side on spawn)

## Deferred Ideas

- Incremental scrape (stop-after-5) — Phase 4 (SCRAPE-05)
- Album support — Phase 4 (SCRAPE-02)
- Per-source sticky `truncation_suspected` column — rejected for this phase
- Track-removal tracking — deferred
- Long-lived Python subprocess / HTTP sidecar — rejected for simplicity
- `pnpm install:scraper` host-venv bootstrap — rejected in favor of Docker-only
- Source-level cover-art refresh policy — implied by full re-scrape upsert; no migration for already-downloaded MP3s
