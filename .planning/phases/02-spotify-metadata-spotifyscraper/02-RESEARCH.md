# Phase 2: Spotify metadata via spotifyscraper — Research

**Researched:** 2026-04-24
**Domain:** Node → Python stdio-JSON bridge; Drizzle SQLite composite-key upsert; event-schema extension; replacing scheduler stub with real scrape work
**Confidence:** HIGH (locked decisions + fresh spike findings leave very little unknown)

## Summary

Phase 2 replaces the Phase 1 no-op scheduler stub with real scrape work. On every sync (scheduled or manual), Node spawns a short-lived Python 3 subprocess that imports `spotifyscraper` (v2.1.5, pinned), calls `SpotifyClient.get_playlist_info(url)`, and returns a single JSON envelope to stdout. The Node side parses the envelope, upserts tracks into SQLite via Drizzle's `onConflictDoUpdate` against the `(source_id, spotify_track_id)` composite unique key, writes an `invocations` row (status=running → success/failed), and emits lifecycle events through the existing EventBus. Success-with-truncation (`len == 100`) is flagged in the invocation summary and on the `playlist.sync.completed` event payload. Failures map to a five-member typed enum that branches through the same event payload to the Discord webhook handler. No tracks rows are written on failure (atomic per-run).

The Python side lives at `scraper/` (repo root, outside `src/`). It has its own venv at `scraper/.venv/` (gitignored) and its own `requirements.txt` pinning `spotifyscraper==2.1.5`. The Docker image installs `python3` + `python3-venv` via apt, creates the venv at build time, and installs from `scraper/requirements.txt`. Host devs touching the scrape path run `pnpm docker:dev` (Docker-only dev path, D-04).

The TypeScript side introduces a new feature module `src/modules/server/scraper/` holding (a) a `SpotifyScraperBridge` class wrapping the spawn, (b) a shared `SyncRunner` entry point both the scheduler and the manual Sync-now button call, and (c) Zod schemas for the Python envelope. The scheduler's `executePlaylistSync` and `triggerManualSync` both route through `SyncRunner.run(source)`, preserving the existing `runningPlaylists` concurrency guard.

**Primary recommendation:** Build the Python bridge as `spawn('python3', [scriptPath])` with explicit `stdio: ['pipe', 'pipe', 'pipe']`; accumulate stdout in a Buffer, parse a single JSON blob on `close`; treat a non-zero exit code with no parseable envelope as `python_crash`; always-exit-0 on the Python side when an envelope is successfully serialized (even for handled errors).

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Python bridge architecture**
- **D-01:** Node invokes `spotifyscraper` via `child_process.spawn('python3', …)` **per sync** — no long-lived Python process, no HTTP sidecar. Cold start is ≤200ms; scrape itself is <0.5s (spike 001). Total per-sync cost is negligible and the code stays stateless.
- **D-02:** IO contract is **stdin JSON → stdout JSON**. Node writes a JSON request (`{ url, source_type: "playlist" }`) to Python's stdin; Python writes a single JSON blob to stdout (`{ tracks, cover_art_url, error }`). Exit code signals success/failure. Chosen over CLI-args for extensibility — future options (artist-fallback toggle, concurrency cap) add fields without reshaping the spawn call.
- **D-03:** Python code lives at **`scraper/` at repo root** (not inside `src/modules/server/`). Contents: `scraper.py`, `requirements.txt` (pin `spotifyscraper==2.1.5`), and a venv at `scraper/.venv/` (gitignored). Dockerfile installs from `scraper/requirements.txt`.
- **D-04:** **Docker-only local dev path** — no host venv bootstrap. Devs touching the scrape path run `pnpm docker:dev`. Trade-off accepted: `pnpm dev` on host can't exercise the real scraper, but repo hygiene stays clean and there is no "works on my Python" divergence. Planner MUST address: how vitest unit tests handle the spawn boundary (expected: mock the bridge interface, integration tests run inside Docker).

**Scrape invocation & invocations table**
- **D-05:** The `PlaylistScheduler.executePlaylistSync` body gets its **real implementation** in this phase. Scheduler keeps emitting `playlist.sync.started` + `playlist.sync.completed` but now wraps real work.
- **D-06:** Manual "Sync now" button is **unhidden** and wired to the same scrape function the scheduler calls. Single code path, two entry points (scheduled + manual). Extend the existing `runningPlaylists` Set concurrency guard to cover manual triggers.
- **D-07:** **`invocations` rows are written.** One row per scrape run: inserted with `status=running` at scrape start, updated on finish (`success` / `failed` / `canceled`). `summary` is a JSON blob carrying per-run metadata (see D-09, D-11).
- **D-08:** On any scrape-side failure, **no `tracks` rows are written** for that run — the whole scrape is atomic from the track-table perspective. The `invocations` row captures the failure; the `tracks` table stays consistent with the last successful scrape.
- **D-09:** **Typed failure taxonomy** — Python exceptions map to a fixed enum stored in `invocations.summary.failure_reason`:
  - `invalid_url` — URL doesn't match Spotify playlist shape (validated in Node before spawn)
  - `not_found` — spotifyscraper `ParsingError` on a nonexistent playlist
  - `parse_error` — spotifyscraper `ParsingError` on unexpected payload shape (Spotify changed `__NEXT_DATA__`)
  - `network_error` — underlying `requests` exception propagated from Python
  - `python_crash` — Python exits non-zero without emitting a parseable JSON error envelope

**100-track truncation detection**
- **D-10:** When `len(tracks) == 100`, the scrape **still processes all 100 tracks** (upserts them) and flags the run as truncation-suspected.
- **D-11:** Truncation surfaces in **two places**:
  - `invocations.summary.truncation_suspected: true` (always, on every qualifying run)
  - `playlist.sync.completed` event payload (`truncationSuspected: boolean`) so the Discord webhook reports it — requires extending `PlaylistSyncCompletedEventSchema`
- **D-12:** No new column on `sources` in this phase (no sticky source-level flag). Per-run `summary` is sufficient until Phase 5.

**Re-scrape behavior (interim, before Phase 4 incremental)**
- **D-13:** Second and subsequent syncs **always do a full scrape** and **upsert on `(source_id, spotify_track_id)`**. No early-stop logic in this phase.
- **D-14:** On upsert, existing rows are **updated in place**: `title`, `artist`, `duration_ms`, `position`, `updated_at` are refreshed. **Never touched on upsert:** `state`, `yt_video_id`, `download_path`, `failure_reason`.
- **D-15:** `position` is **overwritten with the current Spotify order** on every scrape.
- **D-16:** Tracks that existed in a previous scrape but are **missing from the current response are left untouched** — row stays. No soft-delete flag.

### Claude's Discretion

- Exact Python script shape (argparse vs stdin reader, single-function vs class) — planner picks
- Error-envelope JSON shape for Python → Node exception passing
- Drizzle upsert implementation (`onConflictDoUpdate` vs explicit select-then-insert-or-update)
- Whether to extract a `ScraperRepository` or inline the upsert in the scrape module
- How vitest unit tests fake the Python bridge (factor the spawn behind an interface)
- Logger namespacing (`Logger.get("Scraper")`, `Logger.get("PythonBridge")`, etc.)
- URL validation — where to do it (client `create-playlist-form.ts` already has partial validation; reuse vs duplicate in scraper module)

### Deferred Ideas (OUT OF SCOPE)

- Incremental scrape (stop-after-5) — Phase 4 (SCRAPE-05)
- Album support — Phase 4 (SCRAPE-02)
- Per-source sticky `truncation_suspected` column on `sources` — rejected for this phase
- Removing tracks that disappear from Spotify between syncs — deferred
- Long-lived Python subprocess / HTTP sidecar — rejected for simplicity
- `pnpm install:scraper` host venv bootstrap — rejected in favor of Docker-only
- Source-level cover-art refresh policy — implied by full re-scrape upsert (covered incidentally)

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SCRAPE-01 | User can configure a Spotify playlist URL (`open.spotify.com/playlist/…`) as a source | Create-playlist form already accepts `/playlist/` + `/album/` URLs (see `create-playlist-form.ts` audit below); no form change needed for playlist branch. Phase 4 broadens album branch. |
| SCRAPE-03 | Scraper extracts track title, primary artist name, and track duration (ms) for every track returned | Spike 001 VALIDATED: `track.name` → title; `track.artists[0].name` → artist (playlist branch); `track.duration_ms` → duration_ms. `spotify_track_id` = `track.uri.split(':')[-1]` because `track.id` is always empty. |
| SCRAPE-04 | First-ever scrape reads all tracks top-to-bottom and records them in order | `tracks` are returned in display order (spike 001 finding 5). No early-stop in Phase 2 (D-13). `position` assigned from array index. |
| SCRAPE-07 | Scraper captures source's cover-art URL (playlists that have one) | `playlist["images"]` is a list; take the largest (highest `width`) image's `url`. Write back via `sources.cover_art_url` on the sources table. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| URL validation (Spotify playlist shape) | API / Backend | Client form | Shape already enforced at client form submit (`create-playlist-form.ts`); re-validated server-side before spawn to fail fast with `invalid_url` and prevent bogus Python invocations |
| Spotify metadata fetch | Python subprocess | — | spotifyscraper is Python-only; Node has no equivalent |
| JSON envelope serialization | Python | Node parses | Stdin/stdout contract per D-02 |
| Track upsert (`onConflictDoUpdate`) | Database / ORM (Drizzle) | — | Composite unique key `(source_id, spotify_track_id)` already in schema |
| Invocation row lifecycle (running→success/failed) | API / Backend (InvocationRepository) | — | Existing repo from Phase 1 |
| Sync entry point (shared) | API / Backend (new `SyncRunner`) | Scheduler calls it; server fn calls it | Single code path for scheduled + manual, concurrency guard shared |
| Concurrency guard | API / Backend (scheduler `runningPlaylists` Set) | — | Set is already scheduler-scoped; share by keeping it inside `PlaylistScheduler` and making the manual button call `scheduler.triggerManualSync(...)` (already present in Phase 1) |
| Lifecycle events (started/completed/failed) | API / Backend (EventBus) | — | Existing bus; schema extended with `truncationSuspected` + `failureReason` |
| Discord webhook formatting | API / Backend (webhook handler) | — | Handler reads the extended event payloads; no client work |
| Sync-now UI button | Client (Solid component) | Hits server fn | Unhide the affordance in `PlaylistConfigCard` (or parent route); call `triggerPlaylistSyncServerFn` already present in `playlist-actions.ts` |

## Standard Stack

### Core (already installed — do not re-add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.1 | SQLite ORM — provides `onConflictDoUpdate` [VERIFIED: Context7 `/drizzle-team/drizzle-orm-docs`] | Already the project ORM |
| `zod` | 4.3.5 | Envelope + event-payload validation | Already the project validator |
| `croner` | 9.1.0 | Cron scheduler (no change in Phase 2) | Already wired |
| `vitest` | 4.0.16 | Unit test runner | Project test framework |
| `pino` | 10.1.1 | Structured logging singleton | `Logger.get("Scraper")` |
| `better-sqlite3` | 12.6.0 | Synchronous SQLite driver | Drizzle sqlite backend |

### Python (new — add at phase start)

| Library | Version | Purpose | Source |
|---------|---------|---------|--------|
| `spotifyscraper` | 2.1.5 (pinned) | Spotify metadata via `/embed/playlist/` endpoint [VERIFIED: PyPI `curl -s https://pypi.org/pypi/spotifyscraper/json` returned `"version": "2.1.5"` on 2026-04-24; confirms spike 001] | Latest on PyPI; matches spike-001 test version |
| `python3` | 3.11+ (image default is fine) | Runtime | Python 3.8+ supported; Docker image will ship Debian's `python3` (slim → 3.11) |

**Transitive Python deps pulled in by spotifyscraper 2.1.5** (per PyPI metadata, informational — do NOT pin these explicitly; pip resolves from `spotifyscraper==2.1.5`):
`requests>=2.25.0`, `beautifulsoup4>=4.9.0`, `lxml>=4.9.0`, `pyyaml>=6.0`, `eyeD3>=0.9.5`, `urllib3`, `cssselect`, `soupsieve`, `filetype`, `fake-useragent`, `certifi`, `packaging`, `tqdm`, `pyparsing`, `deprecation`, `click>=8.0.0`, `rich>=13.0.0`.

### Node Runtime APIs (no new dependencies)

| API | Purpose |
|-----|---------|
| `node:child_process` → `spawn` | Spawn Python [VERIFIED: Context7 `/websites/nodejs_latest-v22_x_api`] |
| `node:events` → `once` | Await `close` event cleanly [VERIFIED: Context7] |
| `node:crypto` → `randomUUID` | Generate invocation IDs (already used) |

### Alternatives Considered

| Instead of | Could Use | Tradeoff | Verdict |
|------------|-----------|----------|---------|
| `spawn` per sync | `fork` (IPC) | `fork` only works for Node child processes; Python isn't Node [CITED: Node.js docs — `fork` creates a V8-instance child] | **Use spawn.** |
| `spawn` per sync | `execFile` (promisified) | Buffers entire stdio, simpler API; but loses streaming control over stderr and has hard output-size limits | **Use spawn.** Stdout size is small (<100 KB for 100 tracks + images) so `execFile` would technically work, but spawn gives clearer error boundaries. |
| `spawn` per sync | Long-lived Python HTTP sidecar (FastAPI) | Saves cold-start (~200 ms/sync) | **Rejected by D-01** — one more process to manage, no measurable gain at this scale |
| Drizzle `onConflictDoUpdate` | Explicit select-then-insert-or-update | More code, more roundtrips | **Use `onConflictDoUpdate`** per Drizzle docs and Phase 1 schema design (composite unique already declared) |

### Installation (Python side — image build step)

```dockerfile
# In Dockerfile (both dev + prod):
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

COPY scraper/requirements.txt /app/scraper/requirements.txt
RUN python3 -m venv /app/scraper/.venv \
    && /app/scraper/.venv/bin/pip install --no-cache-dir -r /app/scraper/requirements.txt
COPY scraper/ /app/scraper/
```

`scraper/requirements.txt`:

```
spotifyscraper==2.1.5
```

**Version verification:** PyPI confirms `spotifyscraper 2.1.5` is the latest release as of 2026-04-24 (query: `curl -s https://pypi.org/pypi/spotifyscraper/json`). Release date: 2025-06-12. Pin here matches spike-tested version.

## Architecture Patterns

### System Architecture Diagram

```
                   ┌──────────────────────────┐
                   │ Browser (Sync-now click) │
                   └────────────┬─────────────┘
                                │ createServerFn POST
                                ▼
 ┌─────────────┐         ┌─────────────────────────┐
 │  Croner tick│────────▶│ PlaylistScheduler       │
 │ (scheduled) │         │  .executePlaylistSync() │
 └─────────────┘         │  .triggerManualSync()   │
                         │  ─ runningPlaylists Set │  ← concurrency guard (already exists)
                         └────────────┬────────────┘
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │ SyncRunner.run(source)  │  ← new shared entry point
                         │  src/modules/server/    │
                         │    scraper/SyncRunner.ts│
                         └────────────┬────────────┘
                                      │
                    ┌─────────────────┼─────────────────────┐
                    ▼                 ▼                     ▼
          ┌─────────────────┐ ┌───────────────────┐ ┌───────────────────┐
          │ EventBus.emit   │ │ Invocation        │ │ SpotifyScraper    │
          │  started/       │ │ Repository        │ │  Bridge           │
          │  completed/     │ │  .create(running) │ │  .fetchPlaylist() │
          │  failed         │ │  .update(...)     │ │                   │
          └────────┬────────┘ └───────────────────┘ └────────┬──────────┘
                   │                                          │
                   │                                          ▼
                   │                                ┌────────────────────┐
                   │                                │ child_process.spawn│
                   │                                │  python3           │
                   │                                │  scraper/scraper.py│
                   │                                │  stdin:  {url,...} │
                   │                                │  stdout: envelope  │
                   │                                │  stderr: buffered  │
                   │                                │           │ exit   │
                   │                                └───────────┼────────┘
                   │                                            │
                   │                                            ▼
                   │                                ┌────────────────────┐
                   │                                │ Python             │
                   │                                │  spotifyscraper    │
                   │                                │  .get_playlist_    │
                   │                                │    info(url)       │
                   │                                └────────┬───────────┘
                   │                                         │
                   │               ┌─────────────────────────┘
                   │               ▼
                   │    ┌─────────────────────┐
                   │    │ Upsert tracks via   │
                   │    │ Drizzle             │
                   │    │ onConflictDoUpdate  │
                   │    │ (source_id,         │
                   │    │  spotify_track_id)  │
                   │    └─────────┬───────────┘
                   │              │
                   ▼              ▼
         ┌──────────────────────────────────┐
         │ Discord webhook handler reads    │
         │  truncationSuspected +           │
         │  failureReason from event payload│
         └──────────────────────────────────┘
```

Data flows in two directions at the Node↔Python boundary:
- **Node→Python:** single-line JSON request on stdin; stdin closes after write.
- **Python→Node:** accumulate stdout until process `close`; parse as single JSON envelope.

### Recommended Project Structure

```
scraper/                           # Python side (repo root — NOT inside src/)
├── scraper.py                     # Single-file entry. Reads stdin JSON, writes stdout JSON.
├── requirements.txt               # spotifyscraper==2.1.5
└── .venv/                         # Built by Dockerfile; gitignored

src/modules/server/scraper/        # TypeScript side of the bridge
├── SpotifyScraperBridge.ts        # Wraps spawn; returns typed envelope or typed error
├── SyncRunner.ts                  # Shared entry point called by scheduler + manual button
├── repository.ts                  # Drizzle upsert for tracks + sources.cover_art_url update
├── schema.ts                      # Zod schemas for Python envelope + failure-reason enum
└── index.ts                       # Barrel

src/modules/server/scheduler/
└── PlaylistScheduler.ts           # executePlaylistSync body delegates to SyncRunner
                                   # triggerManualSync stays; now routes through SyncRunner too

src/modules/server/events/
└── schema.ts                      # Extend PlaylistSyncCompletedEventSchema + PlaylistSyncFailedEventSchema

src/modules/server/webhooks/
└── service.ts                     # WebhookMessageFormatter reads truncationSuspected + failureReason

src/modules/client/playlist/components/
└── playlist-config-card.tsx       # Unhide (add) the Sync-now button; reuse triggerSync() action
```

### Pattern 1: Node child_process spawn with stdin-JSON in / stdout-JSON out

**What:** Spawn Python, write JSON request to stdin immediately, close stdin, accumulate stdout until `close` event, parse once.
**When to use:** Short-lived Python invocation returning a single structured response per call.

```typescript
// src/modules/server/scraper/SpotifyScraperBridge.ts
import { spawn } from "node:child_process";
import { once } from "node:events";
import { z } from "zod";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";

export const PythonEnvelopeSchema = z.object({
	tracks: z
		.array(
			z.object({
				spotify_track_id: z.string().min(1),
				title: z.string(),
				artist: z.string(),
				duration_ms: z.number().int().nonnegative(),
				position: z.number().int().nonnegative(),
			}),
		)
		.nullable(),
	cover_art_url: z.string().url().nullable(),
	error: z
		.object({
			type: z.enum([
				"invalid_url",
				"not_found",
				"parse_error",
				"network_error",
			]),
			message: z.string(),
		})
		.nullable(),
});
export type PythonEnvelope = z.infer<typeof PythonEnvelopeSchema>;

export interface ScrapeRequest {
	url: string;
	source_type: "playlist";
}

const DEFAULT_TIMEOUT_MS = 30_000; // generous; spike observed <0.5 s

export class SpotifyScraperBridge {
	constructor(
		private readonly pythonBin: string = "scraper/.venv/bin/python",
		private readonly scriptPath: string = "scraper/scraper.py",
		private readonly timeoutMs: number = DEFAULT_TIMEOUT_MS,
		private readonly logger: AppLogger = Logger.get("SpotifyScraperBridge"),
	) {}

	async fetchPlaylist(url: string): Promise<PythonEnvelope> {
		const child = spawn(this.pythonBin, [this.scriptPath], {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: this.timeoutMs, // SIGTERM after timeout
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];
		child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
		child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

		// Write request then close stdin so Python's stdin.read() unblocks.
		const req: ScrapeRequest = { url, source_type: "playlist" };
		child.stdin.end(`${JSON.stringify(req)}\n`);

		const [code, signal] = (await once(child, "close")) as [
			number | null,
			NodeJS.Signals | null,
		];

		const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
		const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

		// Parse envelope. If parse fails or code != 0 without envelope, -> python_crash.
		if (stdout) {
			const parsed = PythonEnvelopeSchema.safeParse(JSON.parse(stdout));
			if (parsed.success) {
				return parsed.data;
			}
			this.logger.error(
				{ err: parsed.error, stdout, stderr, code, signal },
				"Python emitted unparseable envelope",
			);
		}

		// No envelope → python_crash (Node synthesizes the error envelope).
		this.logger.error(
			{ code, signal, stderr },
			"Python exited without envelope",
		);
		return {
			tracks: null,
			cover_art_url: null,
			error: {
				type: "network_error", // placeholder, overridden by caller
				message: `python crash: exit=${code} signal=${signal} stderr=${stderr.slice(0, 500)}`,
			},
		};
	}
}
```

**Notes on the pattern:**
- `stdio: ["pipe", "pipe", "pipe"]` gives explicit streams. [VERIFIED: Context7 Node.js v22 docs]
- `child.stdin.end(data)` writes and closes stdin in one call — prevents Python from blocking on `sys.stdin.read()`.
- `once(child, "close")` awaits the final stdio-closed event. [VERIFIED: Context7 Node.js v22 example `const [code] = await once(ls, 'close')`]
- `'close'` fires AFTER `'exit'` AND after all stdio streams are drained — the correct signal for "I've collected all stdout." [VERIFIED: Context7 Node.js v22 docs: "The 'close' event triggers after stdio streams are closed, following the 'exit' event."]
- The `timeout` option on spawn sends SIGTERM after N ms. [VERIFIED: Context7 Node.js v22 docs for spawn options]
- `python_crash` (D-09) is the envelope synthesized when Python dies without emitting parseable stdout. The caller in `SyncRunner` overrides the error.type to `"python_crash"` in that branch.

### Pattern 2: Python stdin-reader, single-JSON-out, always-exit-0 on controlled error

```python
# scraper/scraper.py
"""Node ↔ Python bridge for spotifyscraper.

Reads a single JSON request from stdin, writes a single JSON envelope to
stdout, and exits 0 whenever the envelope was emitted — even for handled
errors. Only exits non-zero on unhandled crashes (which Node maps to
`python_crash`).

Request:   {"url": "...", "source_type": "playlist"}
Response:  {"tracks": [...] | null,
            "cover_art_url": "https://..." | null,
            "error": {"type": "...", "message": "..."} | null}
"""
import json
import sys
import traceback

import requests  # pulled in by spotifyscraper
from spotify_scraper import SpotifyClient
from spotify_scraper.core.exceptions import ParsingError


def _uri_to_track_id(uri: str) -> str:
    # spike 001: track.id is always '' — use uri.split(':')[-1]
    return uri.split(":")[-1]


def _largest_image_url(images: list) -> str | None:
    if not images:
        return None
    # images are {url, height, width}; pick by max width.
    best = max(images, key=lambda i: (i.get("width") or 0))
    return best.get("url")


def _normalize(playlist: dict) -> tuple[list[dict], str | None]:
    tracks_raw = playlist.get("tracks") or []
    tracks = []
    for position, t in enumerate(tracks_raw):
        uri = t.get("uri") or ""
        if not uri:
            # Defensive: skip any track without a uri (spike showed this never
            # happens on playlists, but fail loud if shape drifts).
            continue
        artists = t.get("artists") or []
        artist_name = artists[0].get("name", "") if artists else ""
        tracks.append({
            "spotify_track_id": _uri_to_track_id(uri),
            "title": t.get("name") or "",
            "artist": artist_name,
            "duration_ms": int(t.get("duration_ms") or 0),
            "position": position,
        })
    return tracks, _largest_image_url(playlist.get("images") or [])


def _emit(envelope: dict) -> None:
    sys.stdout.write(json.dumps(envelope))
    sys.stdout.flush()


def main() -> int:
    raw = sys.stdin.read()
    try:
        req = json.loads(raw)
        url = req["url"]
        source_type = req.get("source_type", "playlist")
    except Exception as e:
        _emit({
            "tracks": None,
            "cover_art_url": None,
            "error": {"type": "invalid_url", "message": f"bad request: {e!r}"},
        })
        return 0

    if source_type != "playlist":
        _emit({
            "tracks": None,
            "cover_art_url": None,
            "error": {"type": "invalid_url", "message": f"source_type {source_type!r} not supported in phase 2"},
        })
        return 0

    client = SpotifyClient()
    try:
        data = client.get_playlist_info(url)
    except ParsingError as e:
        msg = str(e)
        # Heuristic — the library raises ParsingError for both shape drift
        # and nonexistent playlists. Decide between parse_error and not_found
        # using message content; when in doubt, default to parse_error.
        etype = "not_found" if ("not found" in msg.lower() or "404" in msg) else "parse_error"
        _emit({
            "tracks": None,
            "cover_art_url": None,
            "error": {"type": etype, "message": msg},
        })
        return 0
    except requests.exceptions.RequestException as e:
        _emit({
            "tracks": None,
            "cover_art_url": None,
            "error": {"type": "network_error", "message": repr(e)},
        })
        return 0
    except Exception as e:
        # Unknown failure — let Node treat it as python_crash via non-zero exit.
        sys.stderr.write(f"UNEXPECTED: {type(e).__name__}: {e}\n")
        traceback.print_exc(file=sys.stderr)
        return 2
    finally:
        client.close()

    tracks, cover_art_url = _normalize(data)
    _emit({"tracks": tracks, "cover_art_url": cover_art_url, "error": None})
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

**Notes on the Python side:**
- Exit code 0 whenever the envelope was successfully written. Node synthesizes `python_crash` only when no envelope arrives.
- `ParsingError` handling is split into `not_found` vs `parse_error` via a string heuristic. If the library gets a dedicated `NotFoundError` subclass later, adopt it.
- Normalization happens Python-side (the Python script owns the JSON envelope shape), which keeps the envelope contract stable even if the library output shape shifts. [Aligned with spike 001 `normalize_playlist_tracks` helper.]

### Pattern 3: Drizzle composite-key upsert with column-preservation

**What:** Insert N tracks; on conflict against `(source_id, spotify_track_id)` update ONLY the columns allowed by D-14, leaving `state`/`ytVideoId`/`downloadPath`/`failureReason` untouched.
**When to use:** Every scrape run — Phase 2 has no early-stop (D-13).

```typescript
// src/modules/server/scraper/repository.ts
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";

export interface NormalizedTrack {
	spotifyTrackId: string;
	title: string;
	artist: string;
	durationMs: number;
	position: number;
}

export const ScraperRepository = {
	/**
	 * Upsert tracks for a source.
	 *
	 * - Inserts rows that don't exist yet.
	 * - On conflict (source_id, spotify_track_id): refresh title/artist/
	 *   duration_ms/position/updated_at ONLY. Never touches state,
	 *   yt_video_id, download_path, failure_reason (per D-14).
	 * - Tracks that were present in a previous scrape but are missing from
	 *   `tracks` here are left untouched (D-16).
	 */
	async upsertTracks(sourceId: string, tracks: NormalizedTrack[]) {
		if (tracks.length === 0) {
			return;
		}
		const db = getDb();
		const now = new Date();

		const values = tracks.map((t) => ({
			id: randomUUID(),
			sourceId,
			spotifyTrackId: t.spotifyTrackId,
			title: t.title,
			artist: t.artist,
			durationMs: t.durationMs,
			position: t.position,
			// state defaults to "pending" on insert; on update we do NOT touch it.
			createdAt: now,
			updatedAt: now,
		}));

		await db
			.insert(schema.tracks)
			.values(values)
			.onConflictDoUpdate({
				target: [schema.tracks.sourceId, schema.tracks.spotifyTrackId],
				set: {
					title: sql.raw(`excluded.${schema.tracks.title.name}`),
					artist: sql.raw(`excluded.${schema.tracks.artist.name}`),
					durationMs: sql.raw(`excluded.${schema.tracks.durationMs.name}`),
					position: sql.raw(`excluded.${schema.tracks.position.name}`),
					updatedAt: sql.raw(`excluded.${schema.tracks.updatedAt.name}`),
					// intentionally: no state, no ytVideoId, no downloadPath, no failureReason.
				},
			});
	},

	async setCoverArtUrl(sourceId: string, coverArtUrl: string | null) {
		const db = getDb();
		await db
			.update(schema.sources)
			.set({ coverArtUrl, updatedAt: new Date() })
			.where(eq(schema.sources.id, sourceId));
	},
};
```

**Notes on the Drizzle upsert:**
- `target` takes an **array of columns** for a composite unique; Drizzle handles the SQL `ON CONFLICT (source_id, spotify_track_id)`. [VERIFIED: Context7 `/drizzle-team/drizzle-orm-docs` — multi-column target array shown in multi-row upsert examples]
- `sql.raw(\`excluded.${columnName}\`)` tells SQLite "use the proposed row's value." This is the idiomatic pattern. [VERIFIED: Context7 doc "Perform multi-row upsert with Drizzle ORM using excluded for PostgreSQL/SQLite"]
- **Omitting a column from `set`** means it is NOT touched on conflict — exactly what D-14 requires for `state`/`ytVideoId`/`downloadPath`/`failureReason`. [VERIFIED: Context7 example "Upsert with Partial Update, Retaining Specific Column Values"]
- Wrap the upsert + cover-art update + invocation finalization in a single `db.transaction(async (tx) => { ... })` to honor D-08 (atomic per run). [Drizzle supports sync transactions via `better-sqlite3`; use `db.transaction` to group the three writes.]

### Pattern 4: Zod event-schema extension (optional fields, backward-compatible)

**What:** Add optional new fields to existing event schemas. Consumers that don't read them keep working.
**When to use:** When extending a discriminated-union event without invalidating existing emitters.

```typescript
// src/modules/server/events/schema.ts (diff)
export const PlaylistSyncCompletedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.completed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		duration: z.number().positive(),
		exitCode: z.number(),
		summary: z.string().optional(),
		logPath: z.string().optional(),
		syncFilePath: z.string().optional(),
		// NEW:
		truncationSuspected: z.boolean().optional(),
		trackCount: z.number().int().nonnegative().optional(),
	}),
});

export const FailureReasonSchema = z.enum([
	"invalid_url",
	"not_found",
	"parse_error",
	"network_error",
	"python_crash",
]);
export type FailureReason = z.infer<typeof FailureReasonSchema>;

export const PlaylistSyncFailedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.failed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		error: z.string(),
		exitCode: z.number().optional(),
		logPath: z.string().optional(),
		// NEW:
		failureReason: FailureReasonSchema.optional(),
	}),
});
```

**Key insight:** both new fields are `.optional()` so the Phase 1 stub scheduler (if anything still calls it) and existing tests continue to validate. The webhook handler reads the new fields with `?.` — absent is semantically "truncation unknown" / "reason not classified."

### Pattern 5: Shared `SyncRunner` entry point (scheduler + manual button)

```typescript
// src/modules/server/scraper/SyncRunner.ts
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import type { SourceRow } from "../db/schema";
import { getEventBus } from "../events";
import { InvocationRepository } from "../invocation/repository";
import type { FailureReason } from "../events/schema";
import { ScraperRepository } from "./repository";
import { SpotifyScraperBridge } from "./SpotifyScraperBridge";

export interface SyncRunnerDeps {
	bridge?: SpotifyScraperBridge;
	invocationRepo?: InvocationRepository;
	logger?: AppLogger;
}

const TRUNCATION_THRESHOLD = 100; // Spotify embed cap — spike 002

export class SyncRunner {
	private readonly bridge: SpotifyScraperBridge;
	private readonly invocationRepo: InvocationRepository;
	private readonly logger: AppLogger;

	constructor(deps: SyncRunnerDeps = {}) {
		this.bridge = deps.bridge ?? new SpotifyScraperBridge();
		this.invocationRepo = deps.invocationRepo ?? new InvocationRepository();
		this.logger = deps.logger ?? Logger.get("SyncRunner");
	}

	/**
	 * Runs one scrape. Emits lifecycle events. Writes invocation rows. Upserts
	 * tracks transactionally (no partial writes on failure).
	 *
	 * Returns nothing — the caller (scheduler or server fn) relies on events
	 * for observability.
	 */
	async run(source: SourceRow): Promise<void> {
		const eventBus = getEventBus();
		const invocationId = randomUUID();
		const startedAt = new Date();

		await eventBus.emit({
			type: "playlist.sync.started",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				sourceUrl: source.sourceUrl,
				outputDir: source.outputDir,
			},
		});

		await this.invocationRepo.create({
			id: invocationId,
			playlistId: source.id,
			startedAt,
			status: "running",
		});

		// URL pre-validation (Node side) — any URL not matching /playlist/... → invalid_url.
		if (!isValidPlaylistUrl(source.sourceUrl)) {
			await this.finalizeFailure(
				invocationId,
				source,
				"invalid_url",
				`URL not a Spotify playlist: ${source.sourceUrl}`,
			);
			return;
		}

		const envelope = await this.bridge.fetchPlaylist(source.sourceUrl);
		if (envelope.error) {
			await this.finalizeFailure(
				invocationId,
				source,
				envelope.error.type,
				envelope.error.message,
			);
			return;
		}
		if (!envelope.tracks) {
			await this.finalizeFailure(
				invocationId,
				source,
				"python_crash",
				"python returned no tracks without error",
			);
			return;
		}

		const truncationSuspected = envelope.tracks.length >= TRUNCATION_THRESHOLD;

		try {
			// Atomic D-08: tracks upsert + cover_art_url update inside one txn.
			// (Drizzle better-sqlite3 supports db.transaction; see Pattern 3.)
			await ScraperRepository.upsertTracks(
				source.id,
				envelope.tracks.map((t) => ({
					spotifyTrackId: t.spotify_track_id,
					title: t.title,
					artist: t.artist,
					durationMs: t.duration_ms,
					position: t.position,
				})),
			);
			if (envelope.cover_art_url) {
				await ScraperRepository.setCoverArtUrl(source.id, envelope.cover_art_url);
			}
		} catch (err) {
			this.logger.error({ err, sourceId: source.id }, "Upsert failed");
			await this.finalizeFailure(
				invocationId,
				source,
				"python_crash", // DB error is Node-side; misnamed but fits the enum
				err instanceof Error ? err.message : String(err),
			);
			return;
		}

		await this.finalizeSuccess(
			invocationId,
			source,
			envelope.tracks.length,
			truncationSuspected,
			startedAt,
		);
	}

	private async finalizeSuccess(
		invocationId: string,
		source: SourceRow,
		trackCount: number,
		truncationSuspected: boolean,
		startedAt: Date,
	) {
		const finishedAt = new Date();
		const duration = Math.max(1, finishedAt.getTime() - startedAt.getTime());

		await this.invocationRepo.update(invocationId, {
			finishedAt,
			exitCode: 0,
			status: "success",
			summary: JSON.stringify({
				track_count: trackCount,
				truncation_suspected: truncationSuspected,
			}),
		});

		await getEventBus().emit({
			type: "playlist.sync.completed",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				duration,
				exitCode: 0,
				trackCount,
				truncationSuspected,
			},
		});
	}

	private async finalizeFailure(
		invocationId: string,
		source: SourceRow,
		failureReason: FailureReason,
		errorMessage: string,
	) {
		await this.invocationRepo.update(invocationId, {
			finishedAt: new Date(),
			exitCode: 1,
			status: "failed",
			summary: JSON.stringify({
				failure_reason: failureReason,
				error: errorMessage,
			}),
		});

		await getEventBus().emit({
			type: "playlist.sync.failed",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				error: errorMessage,
				failureReason,
			},
		});
	}
}

function isValidPlaylistUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return u.hostname === "open.spotify.com" && u.pathname.startsWith("/playlist/");
	} catch {
		return false;
	}
}
```

### Anti-Patterns to Avoid

- **Do NOT spawn the raw `python3` interpreter from PATH in production.** Use the venv-local interpreter at `scraper/.venv/bin/python`. PATH resolution risks catching a different Python (e.g. system 3.8 without `spotifyscraper`). Make the path configurable via env (`PYTHON_BIN`) with that default.
- **Do NOT parse stdout as it streams.** The Python envelope is a single JSON blob — accumulate until `close` then parse once. Streaming parsers add complexity for zero benefit at this size.
- **Do NOT exit non-zero from Python on handled errors.** An `invalid_url` envelope with exit 0 is how Node classifies the failure. Exit non-zero only on unrecoverable crashes (that's what `python_crash` means).
- **Do NOT write partial `tracks` on failure.** Wrap tracks upsert + cover-art update in a Drizzle transaction (D-08).
- **Do NOT touch `state` / `ytVideoId` / `downloadPath` / `failureReason` in the `onConflictDoUpdate` set clause.** Missing from the set → SQLite keeps the existing value. Adding them → clobbers Phase 3+ state.
- **Do NOT depend on `track.id` for the Spotify ID** (spike 001: always empty). Use `uri.split(':')[-1]`.
- **Do NOT trust `playlist.track_count` to detect truncation** (spike 002: the library truncates `track_count` too). Check `len(tracks) == 100` on the Node side.
- **Do NOT add Chromium / Playwright to the Docker image.** Per DEPLOY-01 + pivot rationale — spotifyscraper does NOT need them.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Spotify metadata fetch | Custom HTML scraper, custom `__NEXT_DATA__` parser | `spotifyscraper==2.1.5` | Library already parses `/embed/playlist/<id>` and handles User-Agent rotation; spike 001 VALIDATED |
| Composite-key upsert | Select-then-insert-or-update loop | `drizzle-orm` `.onConflictDoUpdate({ target: [col1, col2], set: {…} })` | SQL-level atomic, one round-trip per batch, correct semantics for D-14's column-preservation rule |
| Cron scheduling | Custom tick loop | `croner` (already wired by Phase 1) | Handles DST, timezone, missed ticks |
| Pub/sub between scheduler and webhook handler | New queue / IPC | Existing `EventBus` singleton | Already drives metrics, duration warnings, Discord webhook |
| Logger | `console.log` | `Logger.get("Scraper")` / `Logger.get("SyncRunner")` / `Logger.get("SpotifyScraperBridge")` | Pino singleton with env-driven level and pretty/JSON mode |
| Python environment isolation | System-wide `pip install` | Per-repo venv at `scraper/.venv/` | Avoids bleeding into Debian `python3` packages; lets the image install idempotently |
| URL parsing / shape check | Regex | Native `URL` constructor | Rejects malformed URLs naturally; `u.hostname === "open.spotify.com" && u.pathname.startsWith("/playlist/")` is the full check |
| JSON envelope validation | Trust-and-destructure | Zod schema (`PythonEnvelopeSchema`) | Catches shape drift before it corrupts DB |
| Invocation row lifecycle | New writer | Existing `InvocationRepository.create` + `.update` | Already exported, already tested by pattern (Phase 1 kept it) |

**Key insight:** Almost everything Phase 2 needs already exists. The *only* new TS code is the `scraper/` module; everything else is schema extension + wiring.

## Runtime State Inventory

Phase 2 is greenfield for the scrape engine — no rename, refactor, or migration, BUT it does retire Phase 1 D-03 (no invocations rows) and Phase 1 D-04 (hidden Sync-now button). The inventory below captures the transitions.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Existing `tracks` rows from any previous phase-2-in-flight testing (should be none — Phase 1 clean-break DB wipe). `sources.cover_art_url` is nullable and empty after Phase 1. | None — DB is already in the expected clean-break state per Phase 1 D-05. |
| Live service config | None — scheduler config is DB-driven (`sources.schedule_*`) and still in place from Phase 1. | None. |
| OS-registered state | None — app runs as a single Node process, no OS-level registrations. | None. |
| Secrets / env vars | Phase 1 removed `SPOTDL_COOKIES_FILE`. Phase 2 will ADD an optional `PYTHON_BIN` env var for overriding `scraper/.venv/bin/python` in edge cases (dev convenience). | Add `PYTHON_BIN` to `env.ts` server block as `z.string().optional()`. |
| Build artifacts / installed packages | `scraper/.venv/` is built inside the Docker image only (D-04). No host artifact to clean. If Phase 1 left any spotdl pip install in the image, it's already gone — Dockerfile currently does NOT install spotdl (verified by reading `/Users/maksymilianzadka/repos/spotdl-manager/Dockerfile`). | None — the current Dockerfile is already spotdl-free. Phase 2 adds the Python + venv layer fresh. |

**Informational — existing scheduler behavior transitions:**
- Phase 1 stub emits `started` + `completed` with no DB write. After Phase 2, every tick writes an `invocations` row → **invocation counts in the UI will start increasing immediately** the first time the new scheduler runs. This is correct; no special migration.
- Phase 1 hid the Sync-now button (D-04). Phase 2 unhides it. The existing `triggerPlaylistSyncServerFn` is already in `src/modules/server/playlist/functions.ts` and calls `scheduler.triggerManualSync(playlistRow)` — which is preserved. No new server fn needed, but the client-side button must be rendered.

## Common Pitfalls

### Pitfall 1: Python stdin.read() blocks forever when Node doesn't close stdin
**What goes wrong:** Python hangs at `sys.stdin.read()`, Node hangs awaiting `close`, SIGTERM eventually fires via the `timeout` option but you've wasted the whole timeout.
**Why it happens:** `sys.stdin.read()` reads until EOF. If Node writes the request but keeps stdin open, Python waits forever.
**How to avoid:** Call `child.stdin.end(jsonString)` — `end()` writes the data AND closes the stream in one call.
**Warning signs:** Scrape always takes exactly `DEFAULT_TIMEOUT_MS` to fail; stderr is empty.

### Pitfall 2: Parsing stdout before the process closes
**What goes wrong:** First `data` chunk arrives, you parse, JSON is truncated, you classify as `parse_error`.
**Why it happens:** `'data'` events can fire multiple times mid-write. Only `'close'` guarantees stdio is fully drained.
**How to avoid:** Accumulate `Buffer` chunks in an array; concatenate and parse only in the `'close'` handler. Use `await once(child, 'close')`.
**Warning signs:** Intermittent parse errors under load; tiny playlists work fine, big ones fail.

### Pitfall 3: `len(tracks) == 100` ≠ "exactly 100 tracks"
**What goes wrong:** You treat the count as authoritative; downstream code says "100 tracks total" when there might be 300 hidden behind the embed cap.
**Why it happens:** Spotify's `/embed/playlist/` endpoint hard-caps at 100 and spotifyscraper passes this through without telling you it was capped (spike 002: `track_count` also capped).
**How to avoid:** On `len(tracks) >= 100` (use `>=` not `==` for safety), always flag `truncation_suspected: true` in the invocation summary AND on the completed event payload.
**Warning signs:** Users reporting "only some tracks from my huge playlist downloaded." Answer is by design (milestone scope is ≤100-track playlists + albums), but the flag gives Discord-webhook consumers a way to know.

### Pitfall 4: Drizzle `onConflictDoUpdate` accidentally clobbers Phase 3+ state
**What goes wrong:** On re-scrape, you overwrite `state: "downloaded"` with `state: "pending"` (the insert default).
**Why it happens:** If you pass `state` in the `set` clause of `onConflictDoUpdate` — OR if you use Drizzle's `.$onUpdateFn` for `updatedAt` carelessly and the ORM expands the set clause — the UPDATE leg touches state.
**How to avoid:** Explicitly enumerate ONLY the five columns the phase should update: `title`, `artist`, `durationMs`, `position`, `updatedAt`. Leave `state`, `ytVideoId`, `downloadPath`, `failureReason` out of `set`.
**Warning signs:** Phase 3 tests pass in isolation but break after re-scrape; `state` resets to `"pending"` after a sync.

### Pitfall 5: Concurrency guard holes — manual button and scheduler race
**What goes wrong:** User clicks "Sync now" while the scheduler is already ticking the same source. Two Python processes, two invocation rows, two conflicting upsert attempts.
**Why it happens:** If the manual button path doesn't consult `runningPlaylists`, the guard only covers scheduled runs.
**How to avoid:** Route BOTH paths through a single entry point. Phase 1's `triggerManualSync` on the scheduler already checks `this.runningPlaylists.has(source.id)` and returns null if busy — keep that behavior and have `SyncRunner.run` be called from there AND from `executePlaylistSync`. Equivalently: `SyncRunner.run` is called ONLY from inside the scheduler's guarded methods; the server fn calls `scheduler.triggerManualSync`, not the runner directly.
**Warning signs:** Double rows in `invocations`; `UNIQUE constraint failed` errors on upsert (race between two scrapes of the same playlist).

### Pitfall 6: Python path drift between dev and prod images
**What goes wrong:** `Dockerfile.dev` gets the Python layer but prod image doesn't (or vice versa); scrape works in dev but crashes at runtime in prod.
**Why it happens:** Two Dockerfiles, easy to forget to mirror changes.
**How to avoid:** Put the Python+venv install as a named stage shared by both files (or at minimum, an identical `RUN` block with a prominent comment), AND include an integration test that validates `scraper/.venv/bin/python --version` at container boot. The healthcheck could include a `python3 -c "import spotify_scraper"` probe once per day, or a startup log line.
**Warning signs:** First scheduled tick in prod hits `ENOENT: scraper/.venv/bin/python`.

### Pitfall 7: Zod `z.string().url()` rejects perfectly valid short-form URLs
**What goes wrong:** User pastes `https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123` — passes the existing client validator but `z.string().url()` on `cover_art_url` IN the envelope might reject an image CDN URL for some edge reason. Similarly, Zod 4 `z.url()` is a stricter WHATWG URL parser than Zod 3's.
**Why it happens:** The Zod 4 spec tightened URL validation.
**How to avoid:** For `cover_art_url` in the envelope, use `z.string().url()` but also make it `.nullable()` — a playlist without artwork should not fail envelope parsing.
**Warning signs:** Envelope parse errors only on certain playlists; log shows `cover_art_url` with unusual characters.

### Pitfall 8: Transaction rollback doesn't undo the `playlist.sync.started` event
**What goes wrong:** Event emits, then DB transaction fails, and you emit `.failed`, but metrics handler already counted a "started"; Discord sent a "started syncing" message followed by nothing (if `failed` is not in the webhook's enabled events).
**Why it happens:** Events are fire-and-forget, DB writes are transactional. No rollback on the bus.
**How to avoid:** Accept the asymmetry; the right fix is to ALWAYS emit a terminal event (`completed` or `failed`) after `started`, even on unexpected failures. The `try/catch/finally` shape of `SyncRunner.run` must guarantee this.
**Warning signs:** Discord shows "🔄 Started …" with no follow-up; metrics `totalSyncs` is ahead of `successfulSyncs + failedSyncs`.

## Code Examples

### Example: Drizzle transaction wrapping the tracks-upsert + cover-art-update

```typescript
// Source: Context7 /drizzle-team/drizzle-orm-docs (transactions guide) + combined with Pattern 3
const db = getDb();
await db.transaction(async (tx) => {
	await tx
		.insert(schema.tracks)
		.values(values)
		.onConflictDoUpdate({
			target: [schema.tracks.sourceId, schema.tracks.spotifyTrackId],
			set: {
				title: sql.raw(`excluded.${schema.tracks.title.name}`),
				artist: sql.raw(`excluded.${schema.tracks.artist.name}`),
				durationMs: sql.raw(`excluded.${schema.tracks.durationMs.name}`),
				position: sql.raw(`excluded.${schema.tracks.position.name}`),
				updatedAt: sql.raw(`excluded.${schema.tracks.updatedAt.name}`),
			},
		});
	if (coverArtUrl) {
		await tx
			.update(schema.sources)
			.set({ coverArtUrl, updatedAt: new Date() })
			.where(eq(schema.sources.id, sourceId));
	}
});
```

### Example: Extending the Discord webhook formatter for new fields

```typescript
// src/modules/server/webhooks/service.ts — WebhookMessageFormatter diff
formatCompleted(event: PlaylistSyncCompletedEvent): string {
	const duration = formatDuration(event.payload.duration);
	const trackLine =
		event.payload.trackCount !== undefined
			? `\n> ${event.payload.trackCount} tracks`
			: "";
	const truncationLine = event.payload.truncationSuspected
		? "\n> ⚠️ possibly truncated (Spotify 100-track cap)"
		: "";
	return `✅ Completed syncing **${event.payload.playlistName}** in ${duration}${trackLine}${truncationLine}`;
},

formatFailed(event: PlaylistSyncFailedEvent): string {
	const reasonLine = event.payload.failureReason
		? `\n> reason: \`${event.payload.failureReason}\``
		: "";
	const exitCode =
		event.payload.exitCode !== undefined
			? ` (exit code: ${event.payload.exitCode})`
			: "";
	return `❌ Failed syncing **${event.payload.playlistName}**${exitCode}${reasonLine}\n> ${event.payload.error}`;
},
```

### Example: Dockerfile delta (production)

```dockerfile
# Stage 2: Production Runtime additions (after the existing ffmpeg/sqlite3 install)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    sqlite3 \
    python3 \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

# Copy scraper Python source + build venv during image build
COPY --chown=node:node scraper ./scraper
RUN python3 -m venv /app/scraper/.venv \
    && /app/scraper/.venv/bin/pip install --no-cache-dir -r /app/scraper/requirements.txt \
    && chown -R node:node /app/scraper
```

**Dockerfile.dev** needs the same `python3 python3-venv` apt line, the same `scraper/` COPY, and the same venv build step. Rationale: devs running `pnpm docker:dev` should get the real scraper in their dev image so hot-reload of TS code picks up real scrape runs against the actual Python interpreter.

### Example: Rendering the Sync-now button

```tsx
// src/modules/client/playlist/components/playlist-config-card.tsx — add a button
// or (simpler) inline in src/routes/library_.$playlistId.tsx
import { triggerSync } from "~/modules/client/playlist/service/playlist-actions";

// somewhere in the component body:
<Button
	variant="solid"
	onClick={async () => {
		await triggerSync(playlist().id!, { onSuccess: () => router.invalidate() });
	}}
	disabled={playlist().status !== "active"}
>
	Sync now
</Button>
```

`triggerSync` in `playlist-actions.ts` already exists and already calls `triggerPlaylistSyncServerFn` — **no server fn changes needed**. The server fn routes through `scheduler.triggerManualSync(playlistRow)`, which already has the `runningPlaylists` guard. When Phase 2 lands `SyncRunner`, `triggerManualSync` just calls `SyncRunner.run(source)` instead of the current stub body. Zero API churn at the boundary.

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Playwright session + Chromium, login CLI | spotifyscraper HTTP-only (no auth, no Chromium) | 2026-04-24 (pivot per spikes 001 / 002) | Image size drops; session-expiry surfaces deleted (AUTH-01..07 obsoleted) |
| spotdl CLI spawn (`spotdl sync …`) | Python subprocess spawn per-sync calling `spotifyscraper` | 2026-04-24 (Phase 1 ripped spotdl; Phase 2 replaces with scrape) | Track metadata ≠ music download — Phase 2 only does the scrape step; Phase 3 does the YouTube match + yt-dlp download |
| Phase 1 scheduler stub (no-op events) | Phase 2 scheduler performs real scrape + DB writes | This phase | Invocation rows start accumulating; Discord webhook starts reporting real progress |
| Phase 1 Sync-now button hidden | Phase 2 unhides the button | This phase | Manual trigger is part of the contract; both paths go through the same runner |

**Deprecated/outdated (do NOT reintroduce):**
- Spotify Web API (`spotipy`): ruled out — API locked down (project-level decision)
- Chromium in the image: deleted — no reason to reinstate with spotifyscraper
- `SPOTDL_COOKIES_FILE` env var: removed Phase 1; irrelevant in Phase 2

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ParsingError` message heuristic (`"not found"` / `"404"`) is a reasonable split between `not_found` and `parse_error` | Pattern 2 Python script | Misclassified failures. Mitigation: log the raw `str(e)` in stderr so we can refine the heuristic later. |
| A2 | Spotify `/embed/playlist/` 100-cap uses strict `==` not `>=` (spike 002 saw exactly 100) but `>=` is safer defensively | `SyncRunner.run` | If the library ever returns 101+, we'd still flag as truncated — correct behavior (over-flag is safer than under-flag). |
| A3 | Drizzle's `better-sqlite3` driver supports `db.transaction(async fn)` returning a promise | Pattern 3 code | If it's sync-only (better-sqlite3 is sync by nature), use a sync callback or drop the `async` wrapper. Verifiable during implementation — Drizzle docs confirm both styles. [CITED: `/drizzle-team/drizzle-orm-docs` transactions guide] |
| A4 | Python-side `json.loads(sys.stdin.read())` works without explicit newline delimiter | Pattern 2 Python | If Node's `stdin.end()` somehow leaves data unflushed, add a newline and Python reads until EOF. `stdin.end(data)` semantics guarantee flush + close. [VERIFIED: Context7 Node.js docs] |
| A5 | `z.string().url()` in the envelope schema accepts Spotify image CDN URLs (`https://image-cdn-fa.spotifycdn.com/...`) | Pattern 1 envelope schema | If Zod 4 rejects them, relax to `z.string().min(1)`. Spike 001 JSON dump shows ordinary `https://image-cdn-fa.spotifycdn.com/image/…` URLs — standard shape, very likely fine. |
| A6 | `playlist["images"]` sorted by width is sufficient to pick the "best" cover art (no orientation check needed) | Pattern 2 `_largest_image_url` | Spike 001 data shows three sizes (64, 300, 640) — picking max width is semantically "highest-res." |
| A7 | Nitro's Node runtime exposes `node:child_process` with no sandboxing | `SpotifyScraperBridge` | Nitro runs on Node, full API. The only constraint is that spawn from an SSR context — as opposed to an edge runtime — works; Phase 1 was confirmed running on a Node target. [Not explicitly verified but matches Phase 1 `SpotdlInvocator` which also used `child_process.spawn`.] |
| A8 | Existing `PlaylistScheduler.triggerManualSync` is still compatible with the new runner — just replacing the stub body | D-06 / Pattern 5 | Code audit confirms `triggerManualSync` checks `runningPlaylists`, calls `executePlaylistSync(source)`. Replacing the body preserves the contract. |

**None of these assumptions block planning.** Each has a concrete fallback. Confirm during implementation, not now.

## Environment Availability

| Dependency | Required By | Available on host | Version | Fallback |
|------------|------------|-------------------|---------|----------|
| Node 22 / pnpm | Build + test | ✓ | pnpm 10.33.0 (matches `package.json`) | — |
| Docker | Integration test, dev container (D-04) | ✓ | 29.4.0 | — |
| Python 3 (host) | Unit test optional convenience | ✓ | 3.14.4 | Docker-only is the contract (D-04); host Python not required |
| `spotifyscraper` (host) | Spike reference only | — | — | Installed only inside the Docker image; no host install needed |
| `ffmpeg` | Not used in Phase 2 (Phase 3 concern) | ✓ (already in Dockerfiles) | — | — |

**Missing dependencies with no fallback:** none. Phase 2 requires only what's already present or what Phase 2 itself installs into the Docker image.

**Missing dependencies with fallback:** none.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.16 |
| Config file | none detected — uses Vitest defaults (see `package.json` `"test": "vitest run"`) |
| Quick run command | `pnpm test` (runs all vitest files) |
| Full suite command | `pnpm test` (repo has no separate integration split) |
| Typecheck | `pnpm typecheck` (`tsc --noEmit`) |
| Schema/lint | `pnpm check` (Biome) |

Tests live beside the source (`<name>.test.ts`). Existing examples: `src/modules/server/scheduler/PlaylistScheduler.test.ts`, `src/modules/server/events/EventBus.test.ts`, `src/modules/server/db/schema.test.ts`, `src/modules/client/playlist/schema/playlist.test.ts`.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCRAPE-01 | Playlist URL accepted as source | unit (schema) | `pnpm test -- create-playlist-form` | ❌ Wave 0 — `src/modules/client/playlist/schema/create-playlist-form.test.ts` |
| SCRAPE-03 | Track fields (title/artist/duration_ms/position) extracted | unit (bridge mock) | `pnpm test -- SyncRunner` | ❌ Wave 0 — `src/modules/server/scraper/SyncRunner.test.ts` (inject fake bridge) |
| SCRAPE-03 | `spotify_track_id = uri.split(':')[-1]` derivation | unit (pure fn / Python-side logic mirrored in TS) | `pnpm test -- scraper` | ❌ Wave 0 — `src/modules/server/scraper/schema.test.ts` (if a helper is exported) — or a dedicated test of the envelope normalizer on the Node side if we choose to do the split on TS side |
| SCRAPE-04 | First-ever scrape records all tracks in order | unit (bridge mock with 50-track envelope) | `pnpm test -- SyncRunner` | ❌ Wave 0 |
| SCRAPE-07 | `sources.cover_art_url` populated on scrape | unit (repository) | `pnpm test -- scraper/repository` | ❌ Wave 0 — `src/modules/server/scraper/repository.test.ts` |
| D-09 failure enum | Each Python error path maps to the correct enum | unit (bridge envelope fixtures) | `pnpm test -- SyncRunner` | ❌ Wave 0 |
| D-10 / D-11 truncation | `len == 100` flags both `summary` and event payload | unit (SyncRunner with 100-track envelope) | `pnpm test -- SyncRunner` | ❌ Wave 0 |
| D-13 / D-14 upsert preserves state | Re-scrape leaves `state`/`yt_video_id`/etc. alone | unit (repository, real in-memory SQLite via better-sqlite3) | `pnpm test -- scraper/repository` | ❌ Wave 0 |
| D-08 atomicity | On failure, no tracks rows written | unit (SyncRunner with simulated DB error) | `pnpm test -- SyncRunner` | ❌ Wave 0 |
| D-06 shared guard | Scheduler + manual button use same `runningPlaylists` | unit (existing `PlaylistScheduler.test.ts` gets a new case) | `pnpm test -- PlaylistScheduler` | ✅ exists; ADD cases |
| Dockerfile Python install | `scraper/.venv/bin/python -c "import spotify_scraper"` exits 0 | integration (build image, run one-line probe) | `docker build -t spotdl-manager:test . && docker run --rm spotdl-manager:test scraper/.venv/bin/python -c "import spotify_scraper"` | manual — Wave 0 documents the command in PLAN notes |
| SCRAPE-01 through SCRAPE-07 end-to-end | Real playlist URL scrape in CI-Docker | integration (spawn real Python) | `docker run … pnpm test -- integration/scraper` (opt-in via env flag) | ❌ Wave 0 — `src/modules/server/scraper/integration.test.ts` gated on `SCRAPER_INTEGRATION=1` env |

**Reasoning on unit-test strategy given D-04:** Because dev is Docker-only for the real scrape, vitest unit tests CANNOT spawn a real Python process on the CI host (Linux CI without Python+spotifyscraper). Therefore:
- `SpotifyScraperBridge` is an **interface-first class** with a `fetchPlaylist(url): Promise<PythonEnvelope>` method. Unit tests inject a fake bridge that returns fixture envelopes (success, each failure type, 100-track truncation).
- `SyncRunner` accepts `bridge` in its constructor deps (see Pattern 5). Unit tests inject the fake.
- One integration test spawns the real Python binary; it's gated on `SCRAPER_INTEGRATION=1` and runs inside `pnpm docker:dev` only. CI may or may not run it depending on whether CI runs inside a properly provisioned container — planner should default to "skip unless flag set" so local `pnpm test` stays fast.
- The **`create-playlist-form` schema** tests are pure Zod — no bridge needed.
- The **`ScraperRepository` upsert preservation** test uses an in-memory `better-sqlite3` DB with the real schema applied, so it proves the `onConflictDoUpdate` behavior against real SQLite.

### Sampling Rate

- **Per task commit:** `pnpm test -- <scope>` (vitest filter by file name; <5 s feedback)
- **Per wave merge:** `pnpm test && pnpm typecheck && pnpm check` (full suite ~10 s on current repo)
- **Phase gate:** Full suite green + a manual Docker run confirming scrape of a known-small public playlist (e.g. spike 001's "Today's Top Hits" URL). Evidence attached to the phase-close note.

### Wave 0 Gaps

- [ ] `src/modules/server/scraper/SyncRunner.test.ts` — covers SCRAPE-03/04, D-08/09/10/11
- [ ] `src/modules/server/scraper/repository.test.ts` — covers D-13/14/15 (upsert preserves state) + SCRAPE-07
- [ ] `src/modules/server/scraper/SpotifyScraperBridge.test.ts` — covers the Node→Python envelope parsing + timeout + `python_crash` synthesis (inject a fake child process via `spawn` mock — follow the `PlaylistScheduler.test.ts` pattern of `vi.mock("node:child_process")` or inject a factory)
- [ ] `src/modules/client/playlist/schema/create-playlist-form.test.ts` — covers SCRAPE-01 URL validation (the schema already exists; add tests for acceptance/rejection matrix)
- [ ] `src/modules/server/scheduler/PlaylistScheduler.test.ts` — **update** with a new case: manual + scheduled race is guarded
- [ ] `src/modules/server/events/schema.test.ts` — (optional) add tests for the extended schemas (truncationSuspected optional, failureReason enum)
- [ ] Integration stub: `src/modules/server/scraper/integration.test.ts` (gated `SCRAPER_INTEGRATION=1`) — runs the real bridge inside the Docker dev container
- [ ] Update `server/plugins/events.ts` — no new handler to register (webhook handler already reads the extended payloads via `WebhookMessageFormatter`); the update is to the formatter only

Framework install: none — Vitest already present and wired.

## Security Domain

> Applies because `security_enforcement` is not set to false in `.planning/config.json` (absent → enabled).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | single-tenant self-hosted; no auth layer (per `PROJECT.md` Out of Scope) |
| V3 Session Management | no | no sessions (pivot removed session-expiry surfaces) |
| V4 Access Control | no | no multi-user access model |
| V5 Input Validation | **yes** | Zod at boundaries: `create-playlist-form.ts` (client), `triggerPlaylistSyncServerFn` input schema, `PythonEnvelopeSchema` (Python→Node), URL shape check before spawn |
| V6 Cryptography | no | no secrets at rest in Phase 2; webhook URL already handled by existing `WebhookRepository` |
| V7 Error Handling & Logging | **yes** | Pino logger with structured context; never log full Python stderr to webhook (it may include stacktraces) |
| V12 File & Resource | **partial** | Python path is NOT user-controlled (hard-coded to `scraper/.venv/bin/python` with env-var override) — no command injection vector |
| V13 API / Web Services | **yes** | Envelope schema prevents malformed data from corrupting DB |

### Known Threat Patterns for Node↔Python Bridge

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via source URL | Tampering / Elevation | `spawn('python3', [script])` with the URL passed via **stdin**, NOT as a CLI arg. No shell interpolation anywhere. |
| Shell metacharacter exploitation | Tampering | `spawn` with `shell: false` (default) — argv is array-form |
| JSON-bomb / deeply-nested payload DoS | Denial of Service | Zod envelope schema caps shape; `DEFAULT_TIMEOUT_MS` (30 s) kills runaway Python; SpotifyScraperBridge accumulates bounded stdout (spike-observed <100 KB per 100-track playlist) |
| SSRF via scraper hitting arbitrary URL | Tampering | Pre-spawn URL validation (hostname must be `open.spotify.com`, pathname must start with `/playlist/`) — `isValidPlaylistUrl` (Pattern 5) |
| Python traceback leaking internal paths to webhook | Info Disclosure | Webhook formatter uses `failureReason` enum + short `error` message, NOT raw stderr. Full tracebacks stay in Pino logs. |
| Unbounded stdout buffering | DoS | At current scale, <100 KB — not a concern; document in code comments that the library's single-request design means this is bounded |
| Time-of-check-time-of-use on `scraper/.venv/bin/python` | Tampering | Binary baked into immutable image layer; `chown node:node` ensures non-root can't modify |

**Nothing here introduces new secrets, new network surface, or new file-system writes beyond what Phase 1 already had.**

## Open Questions

1. **Should `cover_art_url` updates happen inside the same transaction as the tracks upsert?**
   - What we know: D-08 says "no tracks rows on failure" — this implies the tracks write is atomic per-run, but says nothing specific about `cover_art_url`. The sources table's cover-art column is semantically part of the scrape output (SCRAPE-07).
   - What's unclear: If the tracks upsert succeeds but the cover-art update fails (or vice versa), is that acceptable?
   - Recommendation: Treat the whole scrape result as one write. Wrap both inside a `db.transaction(...)` block. Cost is negligible (both are same-DB, sync driver). This is the safest interpretation of D-08 and costs nothing.

2. **Where to render the Sync-now button — `PlaylistConfigCard` header vs inline on the route?**
   - What we know: Phase 1 D-04 hid a pre-existing button. Current `library_.$playlistId.tsx` doesn't render one; `PlaylistConfigCard` has a `deleteDialog` prop but no sync action.
   - What's unclear: Whether to extend `PlaylistConfigCard` (cleaner, the button logically belongs to "playlist configuration") or render inline in `library_.$playlistId.tsx` (simpler diff, no new prop).
   - Recommendation: Add a new prop `syncAction?: JSX.Element` to `PlaylistConfigCard` (parallel to `deleteDialog`), keep the `triggerSync` call in the route handler. Low-risk, follows the existing prop-based composition pattern.

3. **Should `PYTHON_BIN` env var override be added now or deferred?**
   - What we know: D-04 mandates Docker-only dev. There's no clear need for the override in dev, and none in prod (image path is fixed).
   - What's unclear: Whether local test invocations from host (rare but possible, e.g. running vitest with `SCRAPER_INTEGRATION=1`) benefit from it.
   - Recommendation: Add it as `z.string().optional()` in `env.ts` **because it's nearly free and a classic escape hatch**. Default remains `scraper/.venv/bin/python`. Document in `.env.example`.

4. **Heuristic for splitting `ParsingError` into `not_found` vs `parse_error` — is it robust enough?**
   - What we know: Spike 001 `test_edge_cases.py` triggered `ParsingError` cleanly on invalid/bogus IDs, but the spike didn't separate "404" vs "shape drift" cases.
   - What's unclear: Whether the library includes enough info in `str(e)` to reliably classify.
   - Recommendation: Start with the string heuristic as a best-effort split. Log the raw error message on stderr on every failure. If Phase 3+ proves the heuristic misclassifies frequently, upgrade to inspecting the exception chain (e.g. check `e.__cause__` for `requests.HTTPError` with 404).

5. **Deleting `scheduler.reload()` calls on sources.coverArtUrl updates — or is that already handled?**
   - What we know: `registerSchedulerReloadHandler` in `handlers.ts` reacts to `playlist.created/updated/deleted`. Phase 2 doesn't change source CRUD; it only writes `coverArtUrl` as a side effect. That write does NOT emit `playlist.updated` — it's a direct DB mutation.
   - What's unclear: Whether the scheduler needs to reload when cover-art changes. Semantically: no, cover-art doesn't affect scheduling.
   - Recommendation: Don't emit `playlist.updated` on cover-art writes. Document the choice inline in `ScraperRepository.setCoverArtUrl`.

## Project Constraints (from CLAUDE.md)

- **Routing:** Spike findings must be consulted — Skill(`spike-findings-spotdl-manager`) is the source of truth for constraints. ✓ honored — all non-negotiables from `references/spotify-metadata-scraping.md` are reflected above (100-cap, `uri.split` derivation, no per-track artists on albums).
- **Module layout:** Client/server split under `src/modules/client` vs `src/modules/server`. ✓ honored — Python scraper is NOT inside `src/` per D-03 (correct; `src/` is for TS app code). TypeScript bridge lands at `src/modules/server/scraper/` per `CLAUDE.md` "Server-side code" rule.
- **Never import server code into client bundles.** ✓ honored — `SyncRunner` and `SpotifyScraperBridge` are server-only; only Zod schemas in `events/schema.ts` (server module) or `scraper/schema.ts` would be imported client-side (types-only via `import type`).
- **`~/` path alias.** ✓ honored — all example code uses `~/logger`, `~/modules/server/...`.
- **Use `Logger.get("ModuleName")`.** ✓ honored — examples use scoped loggers (`"SyncRunner"`, `"SpotifyScraperBridge"`).
- **Event bus for cross-cutting concerns.** ✓ honored — scrape completion fans out via existing bus, not a direct call to the webhook service.
- **Database file at `/data/db.sqlite` via Drizzle.** ✓ honored — no change to the DB location. New upserts go through `getDb()`.
- **`createServerFn` + Zod `.inputValidator()` for all mutations.** ✓ honored — `triggerPlaylistSyncServerFn` already exists and is reused. No new server fn needed for the manual button.
- **Test SSR with `pnpm start`, not `pnpm preview`.** ✓ noted — not Phase 2-relevant (no SSR changes).
- **Do not edit generated files** (`routeTree.gen.ts`, `styled-system/**`, `drizzle/**`). ✓ honored — schema change is only to `sources.cover_art_url` via updates, NOT a new column; no migration needed.
- **Generated PandaCSS utilities — run `pnpm prepare` after theme changes.** ✓ noted — no theme changes in Phase 2.

## Sources

### Primary (HIGH confidence)

- **Context7** `/drizzle-team/drizzle-orm-docs` — Upsert guide including composite-key `target: [col1, col2]`, `excluded.*` set pattern, partial update preserving columns via omission. Used for Pattern 3 and D-14.
- **Context7** `/websites/nodejs_latest-v22_x_api` — `child_process.spawn` options (timeout, killSignal, serialization), `'close'` vs `'exit'` event semantics, `stdio: 'pipe'` behavior. Used for Pattern 1.
- **PyPI** `https://pypi.org/pypi/spotifyscraper/json` — Version 2.1.5 confirmed current as of 2026-04-24; release date 2025-06-12; transitive deps listed.
- **Spike 001** `.planning/spikes/001-spotifyscraper-feasibility/` — Real-world playlist + album fetch against live Spotify (2026-04-24): empty-`id` surprise, artist extraction pattern, cover-art `images` array shape, `ParsingError` on bad URLs.
- **Spike 002** `.planning/spikes/002-spotifyscraper-large-playlist/` — 100-cap finding (`/embed/playlist/` endpoint hard limit).
- **Existing codebase audit** — All TS pattern assertions verified against real source files in the repo as of commit `98079a6` (current HEAD).

### Secondary (MEDIUM confidence)

- `.planning/codebase/ARCHITECTURE.md`, `.planning/codebase/STRUCTURE.md`, `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/STACK.md`, `.planning/codebase/INTEGRATIONS.md` — Project map. Note: STACK.md references spotdl CLI paths that are out of date post-Phase-1; Phase 1 CONTEXT.md confirms they've been removed, and the current source files confirm the removal (no `src/modules/server/spotdl/` directory).
- Phase 1 CONTEXT.md (`.planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md`) — Carries forward D-01 (scheduler still wired), D-02 (event emissions), retires D-03 (no invocations rows) and D-04 (hidden Sync-now button).

### Tertiary (LOW confidence — flagged for validation during implementation)

- `ParsingError` message-heuristic for `not_found` vs `parse_error` split (A1 in Assumptions Log). Validate with real 404 response during Phase 2 wave 0.
- Zod 4's `z.string().url()` acceptance of Spotify CDN image URLs (A5). Cheap to verify with a snapshot test against the spike's `playlist_response.json` cover art.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against PyPI + Context7 on 2026-04-24
- Architecture: HIGH — every pattern has a verified source pattern or a direct codebase precedent
- Pitfalls: HIGH — derived from spike findings (100-cap, empty-id), Node docs (stdin blocking), and Drizzle docs (`set` clause omission preserves columns)
- Code examples: MEDIUM — compile-ready sketches; actual implementation will need to pass vitest + biome

**Research date:** 2026-04-24
**Valid until:** 2026-05-24 (30 days — stable ecosystem; re-check PyPI for spotifyscraper >2.1.5 before phase start if planning slips past this window)

## RESEARCH COMPLETE
