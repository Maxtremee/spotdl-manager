# Phase 3: Match + download slice (end-to-end MP3) — Research

**Researched:** 2026-04-25
**Domain:** YouTube resolution + audio extraction + ID3 tagging + bounded-concurrency orchestration in Node, glued to an event-driven pipeline
**Confidence:** HIGH overall — Context7 docs verified for all three new libraries; yt-dlp CLI behavior cross-checked against official wiki + GitHub issues; codebase patterns confirmed via direct read of Phase 2's bridge/runner/repository.

## Summary

Phase 3 plugs a new event-triggered runner (`DownloadRunner`) into the post-scrape seam Phase 2 already exposes: `playlist.sync.completed` fires → a new event handler awaits the runner → the runner reads `state IN ('pending', 'matched')` rows for the source, runs them through a `pLimit(N)` pool, and for each one issues two `yt-dlp` spawns (probe-then-download), embeds ID3 tags via `node-id3`, then transitions the track row to `downloaded` (or a typed failure terminal). The single architectural risk worth restating is the `runningPlaylists` lock lifetime: Phase 2's lock releases as soon as `SyncRunner.run` returns, which today is BEFORE the new download handler executes — Phase 3 must extend that lifetime end-to-end (D-06).

Three libraries are added: `yt-dlp` (Python CLI, installed into the existing Phase 2 venv), `node-id3` (zero-runtime-cost MP3 tag writer), and `p-limit` (the canonical Node concurrency limiter). All three are "boring" choices that the broader Node ecosystem converges on; no exotic alternatives are warranted.

The single most subtle finding from this research: **yt-dlp on a zero-results `ytsearch1:` exits cleanly (likely 0) with no stderr error message** — it just prints "Downloading 0 items" and finishes. The `DownloadRunner` cannot rely on exit code to detect "no match found"; it MUST check whether `--print` produced output, and treat empty-output-with-success as a typed `no_results` failure ([CITED: github.com/yt-dlp/yt-dlp/issues/8033]).

**Primary recommendation:** Mirror Phase 2's `SpotifyScraperBridge`/`SyncRunner`/`ScraperRepository` triad as `YtDlpBridge`/`DownloadRunner`/`DownloadRepository` in `src/modules/server/downloader/`. Wire the new download handler into the Nitro events plugin, extend `runningPlaylists` to span the handler chain by awaiting `eventBus.emit("playlist.sync.completed", ...)` inside `executePlaylistSync` (the bus already runs handlers via `Promise.allSettled` so `await emit` already waits — confirmed by reading EventBus.ts line 177). Add `album` (nullable) to `tracks` and `kind` (enum: `scrape | download`) to `invocations`; both are simple `ALTER TABLE ADD COLUMN` migrations that SQLite supports.

## User Constraints (from CONTEXT.md)

> Copied verbatim from `.planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md`. The planner MUST honor these.

### Locked Decisions

#### Pipeline shape — split runner via event

- **D-01:** A new **`DownloadRunner`** runs match+download. It is **not** inline in `SyncRunner`. The existing `SyncRunner` (Phase 2) keeps emitting `playlist.sync.completed` after a successful scrape; a new event handler subscribes to that event and kicks `DownloadRunner` for the same source. The handler lives next to other event handlers (`src/modules/server/events/handlers.ts` or a sibling file) and is registered in the events Nitro plugin.
- **D-02:** Per-track state flow is **`pending → matched → downloaded`**. After `ytsearch1` + duration gate passes, `yt_video_id` is persisted and `state=matched` BEFORE the download starts. After the file lands and is tagged, `state=downloaded`. If a later step crashes, the row stays at `matched` and a future retry skips re-search (MATCH-04 semantics).
- **D-03:** A track-level download failure **does not abort the run**. Per-track failure is recorded on the track row (`state=failed` with exit code + stderr tail in `failure_reason`); the `DownloadRunner` invocation finishes with `status=success` and a `summary` JSON that carries counters (`total`, `downloaded`, `matched_only`, `skipped_low_confidence`, `failed`). The scrape invocation status is not affected.
- **D-04:** **Manual "Sync now" button triggers the full pipeline.** It calls the existing `SyncRunner` server function unchanged — the `playlist.sync.completed` handler does the rest. No separate manual "download only" affordance in Phase 3. UI progress affordance for long runs is Claude's discretion / Phase 5 territory.
- **D-05:** **Two invocation rows per sync.** The scrape writes one row (Phase 2 contract, summary carries `trackCount` + `truncationSuspected`). `DownloadRunner` writes a second row keyed to the same source with download counters in its `summary`. The `invocations` table gains a discriminator so consumers can tell them apart — implementation choice between a new `kind` column (e.g. `enum('scrape', 'download')`) and a `summary.kind` JSON marker is **Claude's discretion**, but a column is preferred for index-friendly queries (Phase 5 UI will filter).
- **D-06:** **Concurrency lock spans both phases.** `PlaylistScheduler.runningPlaylists` (the existing `Set<sourceId>`) is taken when scrape starts and released only after `DownloadRunner` terminates (success, fail, or no-op when zero pending+matched rows exist). The lock survives the scrape→download handoff. Implication: the scheduler / manual button cannot fire a second pipeline on the same source while a download is mid-flight, even on a 30-min batch. Acceptable trade-off for v1.
- **D-07:** `DownloadRunner` reads **all `state IN ('pending', 'matched')`** rows for the source and runs the parallel-N pool over them. It does **not** retry `failed` or `skipped_low_confidence` rows in Phase 3 — TRACK-05 auto-retry is Phase 5 and will extend the row selection (or add a separate trigger). `matched` is included so an interrupted prior run resumes without re-searching.

#### yt-dlp invocation — Node spawn, two-call probe-then-download

- **D-08:** **Probe-then-download.** Call 1: `yt-dlp --print 'id|duration' --skip-download ytsearch1:'<artist> <title>'` returns video id + duration in seconds without media bytes. Apply ±N tolerance gate (default 3s, configurable per MATCH-02). Call 2 (only when probe passes): `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 -o '<path>' 'https://www.youtube.com/watch?v=<id>'`. Rejects never download bytes; accepted tracks pay one extra short spawn vs a single-call. Search-term escaping (apostrophes, parens, unicode in titles) is **Claude's discretion** — `argv[]` form spawn already handles literal strings safely, but query-string sanitization for the YouTube search itself may need a planner-level note.
- **D-09:** **`YtDlpBridge` runs in Node**, not Python. Lives at `src/modules/server/downloader/YtDlpBridge.ts` and mirrors the `SpotifyScraperBridge` shape (argv-form `child_process.spawn`, `shell: false`, structured stdout/stderr parsing, typed envelope/error). Python runtime stays exclusively for `spotifyscraper`. Concurrency coordination lives where it's easiest — Node.
- **D-10:** **`YT_DLP_BIN` env var, PATH fallback.** Mirrors Phase 2's `PYTHON_BIN` pattern. Default invocation shape is `'yt-dlp'` (resolved via `PATH`); `YT_DLP_BIN` overrides for Docker (e.g. `/usr/local/bin/yt-dlp`) or dev shells. The Dockerfile installs a pinned yt-dlp version — pinning mechanism (apt vs `pip install yt-dlp==X.Y.Z` into the existing scraper venv vs bundled binary download) is **Claude's discretion** during planning; planner should choose whichever keeps the image diff smallest while leaving room for periodic version bumps.
- **D-11:** **Concurrency via `p-limit`.** `DownloadRunner` constructs `pLimit(N)` per run, where N is read from `global_settings.match.parallel` (or equivalent settings key — Claude's discretion on key naming) at the start of the run. Changing the setting takes effect on the **next** sync, not mid-batch. p-limit is an existing-ecosystem dep with zero transitive deps. Per-source vs cross-source pool distinction is moot in single-user scope; the source-level lock (D-06) already prevents two downloads on the same source.

#### Tagging — node-id3 post-step

- **D-12:** **Tagging is a separate Node step after yt-dlp produces a clean MP3.** yt-dlp writes the file with `--extract-audio --audio-format mp3 --audio-quality 0` and **without** `--add-metadata` / `--embed-thumbnail` — YouTube-derived metadata never enters the file. After the spawn returns success, Node opens the MP3 with `node-id3` and writes `TIT2` (title), `TPE1` (artist), `TALB` (album, when set; see D-13), and `APIC` (cover art, when available; see D-14). All values come from the Spotify scrape (`tracks.title`, `tracks.artist`, `tracks.album`, `source.cover_art_url`).
- **D-13:** **`tracks` table gains a nullable `album` column** (schema migration in this phase). Population rule:
    - **Album sources** (Phase 4 onwards): `album = source.name` at scrape time. Phase 3 lays the column groundwork; the actual album-source population logic ships in Phase 4.
    - **Playlist sources** (Phase 3 reality): `album` stays **`null`**. No per-track refetch via `get_track_info` — that would mean 100 extra HTTP calls per playlist sync, breaks the auth-free single-request scrape pattern, and the spike findings explicitly mark per-track album refetch as a v2 concern.
    - **TALB frame is omitted entirely when `album IS NULL`.** Players show no album grouping for playlist tracks — accepted v1 trade-off. Phase 5's UI doesn't need to display album either.
- **D-14:** **Cover art is fetched per track** from `source.cover_art_url` and embedded as the `APIC` frame. User explicitly chose per-track fetch over batch-fetch caching: keeps each `DownloadRunner` work unit self-contained with no cross-track state, no in-memory buffer to manage, no cache invalidation. Cost is N redundant HTTP calls per sync (~1–20KB image × 100 tracks); acceptable. If `source.cover_art_url IS NULL`, skip APIC silently — no error, no placeholder.
- **D-15:** **`yt-dlp -o` writes directly to the final path; node-id3 mutates in place; existing files are skipped.** No temp-file + atomic-rename in v1. yt-dlp writes `data/music/<source-slug>/<artist> - <title>.mp3`; on its own success, node-id3 opens that exact path and writes ID3v2 frames. Before issuing the probe call, `DownloadRunner` checks if the target path already exists for the track — if it does, the track transitions to `downloaded` without invoking yt-dlp at all (idempotent re-runs). This deliberately leaves "forced re-download" semantics to Phase 5's manual retry button (TRACK-04), which will need to delete the file before re-running. Source slug + filename sanitization rule is **Claude's discretion** — recommended baseline: lowercase, replace whitespace with `-`, strip filesystem-unsafe chars (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`), normalize unicode; planner should pick a slug helper (e.g. `slugify` lib or hand-rolled) that's deterministic across runs.

#### Settings / configuration

- **D-16:** **Tolerance and concurrency live in `global_settings` as JSON-serialized rows.** Recommended key shape: `match` row with `{ tolerance_seconds: number, parallel: 2|3|4 }`. Defaults: `tolerance_seconds=3`, `parallel=3` (per PROJECT.md key decisions). Settings UI shape (new section vs extend existing) is **Claude's discretion / Phase 5 may extend**; minimum Phase 3 ships with a server-side default that works without UI exposure.

### Claude's Discretion

- Exact discriminator on `invocations` (column vs `summary` JSON marker; if column, naming + enum values)
- Filename + slug sanitization rule (slugify lib choice vs hand-rolled regex; cross-platform char strip set)
- yt-dlp version-pinning mechanism (apt vs pip-into-venv vs binary download)
- Search-term escaping for tricky titles (apostrophes, parens, unicode); whether to normalize quotes ahead of `ytsearch1:`
- Settings UI surface for the new `match` row (deferrable to Phase 5)
- Stderr tail length cap stored in `failure_reason` (recommended ~500 chars)
- yt-dlp output template: literal `-o '<absolute path>'` vs `--paths home:<dir> -o '<filename>'`
- Error envelope shape for `YtDlpBridge` (mirror `SpotifyScraperBridge`'s typed enum: `not_found`, `no_results`, `download_error`, `ytdlp_crash`, `ffmpeg_error` — exact set is planner's call)
- Where the cover-art HTTP fetch lives (utility module vs inline in `DownloadRunner`)
- Exact `global_settings` key name for the match section (e.g. `match`, `download`, `match_settings`)
- Logger namespacing (`Logger.get("DownloadRunner")`, `Logger.get("YtDlpBridge")`, `Logger.get("Tagger")` — mirror Phase 2 pattern)
- Whether `DownloadRunner` test surface mocks the `YtDlpBridge` interface (matches Phase 2's mocked-spawn pattern) or runs gated integration tests behind `DOWNLOADER_INTEGRATION=1`

### Deferred Ideas (OUT OF SCOPE — do not plan)

- **Auto-retry of `failed` / `skipped_low_confidence` tracks on subsequent syncs** — explicitly Phase 5 (TRACK-05). Phase 3's `DownloadRunner` only processes `pending` + `matched` rows. Phase 5 will extend the row selection or add a separate retry trigger.
- **Per-track manual retry button + UI badges** — Phase 5 (TRACK-03, TRACK-04). Phase 3 ships zero per-track UI.
- **Forced re-download for already-downloaded tracks** — Phase 5 (TRACK-04). Phase 3 skips re-downloading if the file already exists at the target path.
- **Per-track album from spotifyscraper `get_track_info` refetch** — explicit v2 (FMT2/META2). Cost is 100 extra HTTP calls per playlist sync; rejected for v1.
- **Match-review UI for ambiguous low-confidence tracks** — explicit v2 (MATCH2-01). Strict ±3s gate + retry is the v1 answer.
- **Reject-bad-terms list (live/cover/remix) as a secondary gate** — explicit v2 (MATCH2-02).
- **yt-dlp cookies passthrough for age-gated content** — explicit v2 (YTAUTH2-01).
- **User-configurable output-path templates** — explicit v2 (LAY2-01). v1 ships `<artist> - <title>.mp3` only.
- **Atomic temp-file + rename write semantics** — rejected for v1 in favor of "yt-dlp writes final path; idempotent skip-if-exists." Revisit only if mid-write crashes prove problematic in practice.
- **Cross-source download pool / global concurrency cap** — single-user single-pipeline scope makes this moot.
- **Settings UI for `match.tolerance_seconds` + `match.parallel`** — server-side defaults ship in Phase 3; UI surface deferrable to Phase 5.
- **Cover-art on-disk cache (`data/music/<slug>/.cover.jpg`)** — rejected; per-track fetch was the explicit choice.
- **Discord webhook payload extension for download summary** — not blocked but not specced; Claude's discretion whether to extend in Phase 3 or Phase 5.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| MATCH-01 | Resolver calls `yt-dlp ytsearch1:"<artist> <title>"` for each track needing resolution | Standard Stack §yt-dlp; Code Examples §Probe call; Common Pitfalls #1 (no_results detection); Common Pitfalls #2 (search-term escaping) |
| MATCH-02 | Accept match when YouTube duration is within ±3s of Spotify duration; tolerance configurable | Architecture §Settings snapshot pattern; Code Examples §Duration gate; D-16 lock |
| MATCH-03 | Out-of-tolerance → `skipped_low_confidence`, delta in `failure_reason` | Code Examples §Duration gate; State Transition table |
| MATCH-04 | Persist `yt_video_id`; reuse on retry; never re-search a `matched` row | D-02 + D-07 lock the read predicate; Architecture §State Transitions |
| DOWNLOAD-01 | yt-dlp downloads resolved video; ffmpeg extracts to MP3 | Standard Stack §yt-dlp; Common Pitfalls #3 (ffmpeg dependency); Code Examples §Download call |
| DOWNLOAD-02 | ID3 tags: title, artist, album, cover art | Standard Stack §node-id3; Code Examples §Tagging step; D-13/D-14 locks |
| DOWNLOAD-03 | Output at `data/music/<source-slug>/<artist> - <title>.mp3`, sanitized | Architecture §Filesystem layout; Common Pitfalls #4 (filename sanitization); Don't Hand-Roll §slug |
| DOWNLOAD-04 | Default 3 parallel; configurable 2–4 | Standard Stack §p-limit; D-11 + D-16 locks |
| DOWNLOAD-05 | Failures: exit code + stderr tail in `failure_reason` | Code Examples §Error envelope; Architecture §Failure taxonomy mirror; D-03 lock |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| YouTube resolution (ytsearch1 probe) | Server (Node child_process) | — | yt-dlp is a CLI binary; spawn lives in Node only. Mirrors Phase 2's bridge tier. |
| Duration gate (±N seconds) | Server (DownloadRunner) | — | Pure logic on returned probe data; server-side because the source data lives there. |
| MP3 download + audio extraction | Server (Node child_process) → ffmpeg | — | yt-dlp + ffmpeg post-processor pipeline; binary tier on the host. |
| ID3 tagging | Server (Node, node-id3) | — | Post-process step on the file the server just wrote. |
| Cover-art fetch | Server (Node fetch) | — | HTTP call from Node; cover URL came from Spotify scrape (server-only data). |
| Concurrency control | Server (p-limit per run) | — | Per-run pool, lives inside DownloadRunner. |
| State transitions (pending→matched→downloaded) | Server (DB / Drizzle) | — | DB writes only; no client involvement. |
| Per-track UI badges | — | — | OUT OF SCOPE for Phase 3 (Phase 5 / TRACK-03). |
| Manual "Sync now" trigger | Client → Server fn | Server | Existing Phase 2 button; unchanged in Phase 3. |
| Event-driven runner kick | Server (EventBus handler) | — | `playlist.sync.completed` → `DownloadRunner.run`; EventBus is server-only. |

## Standard Stack

### Core (new dependencies for Phase 3)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `yt-dlp` (Python CLI) | `2026.3.17` (PyPI) | YouTube search + download + audio extraction | The successor to `youtube-dl`; the only well-maintained tool in this category. Spotdl-style apps universally use it. [VERIFIED: pypi.org/project/yt-dlp/2026.3.17/, libraries.io] |
| `ffmpeg` (system binary) | OS package (already in Dockerfile.dev + Dockerfile, line 38) | Audio extraction backing yt-dlp's `--extract-audio` | yt-dlp delegates audio extraction to ffmpeg; no Node alternative exists. [VERIFIED: yt-dlp README — "Strongly recommended ... required for ... post-processing"] |
| `node-id3` | `0.2.9` (npm) | ID3v2 tag writing for MP3 (`TIT2`/`TPE1`/`TALB`/`APIC`) | Most-downloaded zero-runtime-dep ID3 library on npm; sync + async APIs; supports inline `Buffer` for cover art. [VERIFIED: npm view node-id3 — published 2025-04-03] |
| `p-limit` | `7.3.0` (npm) | Bounded-concurrency promise pool | Sindre Sorhus's canonical limiter; the de-facto standard for "run N async ops at a time." [VERIFIED: npm view p-limit — published 2026-02-03] |

**Verified package facts:**
- `node-id3@0.2.9`: dependencies = `iconv-lite ^0.6.2`. CommonJS-style require + ESM-friendly import both work. Sync API returns `true | Error`; async API takes a callback. [VERIFIED: npm view; CITED: github.com/zazama/node-id3 README via Context7]
- `p-limit@7.3.0`: `type: "module"` (ESM-only), `engines.node: ">=20"`. Single dependency: `yocto-queue ^1.2.1` (also a tiny Sindre package). The CONTEXT D-11 line "no transitive deps" is slightly off — there is **one** transitive dep (`yocto-queue`), but it's a single-file zero-dep queue. Worth flagging in plan but not a blocker. [VERIFIED: npm view p-limit — type, engines, dependencies]
- The repo is already ESM-native (`"type": "module"` in `package.json`), so importing p-limit as `import pLimit from "p-limit"` works directly — no `require()` interop needed.

### Supporting (already in repo, reused)

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:child_process` | built-in | Spawn yt-dlp | Already used by `SpotifyScraperBridge`; copy the argv-form + `shell: false` pattern. |
| `node:fs/promises` | built-in | mkdir / access (skip-if-exists) | Lazy-create `data/music/<slug>/` and check existing files. |
| `node:fetch` (global, undici) | built-in (Node 22) | Cover-art HTTP GET | Repo already uses global `fetch` extensively (`webhooks/service.ts`, `webhooks/functions.ts`). No need for `undici` direct import. [VERIFIED: 5 existing fetch() callsites in src/modules/server] |
| `drizzle-orm` 0.45.1 | already installed | DB updates on track rows | Plain `update().set().where()` — no upsert needed (rows already exist from scrape). |
| `zod` 4.3.5 | already installed | Validate yt-dlp probe envelope + match-settings JSON | Mirror Phase 2's `PythonEnvelopeSchema` pattern. |
| `croner` 9.1.0 | already installed | Scheduler — unchanged | Phase 3 only extends `runningPlaylists` lifecycle, not scheduler logic. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `yt-dlp` CLI | `youtube-dl-exec@3.1.5` (Node wrapper) | Adds an abstraction layer that hides the CLI; we already have a clean `SpotifyScraperBridge` pattern that works directly with spawn. Wrapper buys nothing for our use case. [VERIFIED: npm view youtube-dl-exec] |
| `node-id3` | `music-metadata` (read-only) + `id3-writer` (less maintained) | `node-id3` is the only library that does both read and write with active maintenance + a recent release (2025-04-03). |
| `p-limit` | `p-queue` (priority + pause/resume) | `p-queue` is heavier — we don't need priorities, retry, or pause/resume. The simple `pLimit(N)(fn)` API is exactly the shape we need. |
| `slugify` (npm) | `@sindresorhus/slugify` 3.0.0 | Both are fine; `@sindresorhus/slugify` does Unicode normalization + transliteration out of the box but has more deps. `slugify@1.6.9` is one file, zero deps, enough for our needs. **Recommended:** `slugify@1.6.9` (smaller, ESM/CJS friendly). |
| Hand-rolled regex sanitization | a library | Hand-rolled is acceptable per CONTEXT but error-prone for cross-platform Windows reserved names (`CON`, `PRN`, `AUX`, etc.). **Recommended: `slugify` for the source folder slug + a small regex pass for the per-track filename** (slugify does too much — keeping artist/title legible matters). |

**Installation:**
```bash
pnpm add node-id3 p-limit slugify
# yt-dlp via the existing scraper venv (recommended):
# In Dockerfile + Dockerfile.dev, append to the existing pip install line:
#   /app/scraper/.venv/bin/pip install --no-cache-dir -r /app/scraper/requirements.txt yt-dlp==2026.3.17
# Plus add `yt-dlp==2026.3.17` to scraper/requirements.txt
```

**Version verification** (run before locking versions in plans):
```bash
npm view node-id3 version    # Last verified: 0.2.9 (2025-04-03)
npm view p-limit version     # Last verified: 7.3.0 (2026-02-03)
npm view slugify version     # Last verified: 1.6.9
# yt-dlp version (PyPI):
pip index versions yt-dlp    # Or check pypi.org/project/yt-dlp directly. 2026.3.17 verified.
```

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────┐
│ Manual Sync-now button   │      ┌──────────────────────────────────┐
│ (existing client UI)     │─────►│ triggerPlaylistSyncServerFn      │
└──────────────────────────┘      │ (existing Phase 2 server fn)     │
                                  └──────────────┬───────────────────┘
                                                 │
┌──────────────────────────┐                     ▼
│ croner schedule tick     │      ┌──────────────────────────────────┐
│ (existing scheduler)     │─────►│ PlaylistScheduler                │
└──────────────────────────┘      │ .executePlaylistSync(source)     │
                                  │   adds to runningPlaylists Set   │  ◄── lock starts here
                                  └──────────────┬───────────────────┘
                                                 │
                                                 ▼
                                  ┌──────────────────────────────────┐
                                  │ SyncRunner.run(source)           │
                                  │  (Phase 2 — UNCHANGED)           │
                                  │  • emit playlist.sync.started    │
                                  │  • create invocation row (kind=  │
                                  │    scrape)                       │
                                  │  • SpotifyScraperBridge.fetch    │
                                  │  • upsert tracks (state=pending) │
                                  │  • emit playlist.sync.completed  │ ◄── seam: Phase 3 plugs in here
                                  └──────────────┬───────────────────┘
                                                 │
                                                 ▼
                          ┌──────────────────────────────────────────┐
                          │ EventBus.emit("playlist.sync.completed") │
                          │ awaits Promise.allSettled on handlers    │
                          └──────────────┬───────────────────────────┘
                                         │
                       ┌─────────────────┴─────────────────┐
                       │                                   │
                       ▼                                   ▼
        ┌──────────────────────────┐    ┌──────────────────────────────┐
        │ Existing handlers        │    │ NEW: download-trigger handler│
        │ (metrics, webhook, log)  │    │ (Phase 3)                    │
        └──────────────────────────┘    │ awaits DownloadRunner.run    │
                                        └──────────────┬───────────────┘
                                                       │
                                                       ▼
                                       ┌──────────────────────────────┐
                                       │ DownloadRunner.run(sourceId) │
                                       │  (Phase 3 — NEW)             │
                                       │                              │
                                       │  1. Read match settings      │
                                       │     (snapshot tolerance + N) │
                                       │  2. Open invocation row      │
                                       │     (kind=download, running) │
                                       │  3. SELECT tracks WHERE      │
                                       │     state IN (pending,       │
                                       │     matched) AND source_id=? │
                                       │  4. pLimit(N) over rows      │
                                       │     each task:               │
                                       │      a. skip-if-exists check │
                                       │      b. probe (state=pending)│
                                       │         OR skip (state=      │
                                       │         matched, has video)  │
                                       │      c. duration gate        │
                                       │      d. UPDATE state=matched,│
                                       │         yt_video_id          │
                                       │      e. mkdir slug dir       │
                                       │      f. download (yt-dlp)    │
                                       │      g. fetch cover art      │
                                       │      h. node-id3.write tags  │
                                       │      i. UPDATE state=        │
                                       │         downloaded, path     │
                                       │  5. Update invocation row    │
                                       │     (status=success, summary │
                                       │     counters)                │
                                       └──────────────────────────────┘
                                                       │
                                                       ▼ (handler returns)
                                  ┌──────────────────────────────────┐
                                  │ EventBus.emit() resolves         │ ◄── lock released here (D-06)
                                  │ executePlaylistSync's await      │
                                  │ unwinds; runningPlaylists.delete │
                                  └──────────────────────────────────┘

External processes invoked via child_process.spawn (per work unit):
   ┌──────────────────────────────┐  ┌─────────────────────────────┐
   │ yt-dlp --print 'id|duration' │  │ yt-dlp -f bestaudio         │
   │   --skip-download            │  │   --extract-audio           │
   │   ytsearch1:'<artist><title>'│  │   --audio-format mp3        │
   │ (probe — milliseconds)       │  │   -o '<final-path>'         │
   │ Captures stdout id + dur     │  │   'https://www.youtube.com/ │
   └──────────────────────────────┘  │    watch?v=<id>'            │
                                     │ (download — seconds)        │
                                     │ Internally calls ffmpeg     │
                                     └─────────────────────────────┘
```

### Component Responsibilities

| File | New / Touch | Responsibility |
|------|-------------|----------------|
| `src/modules/server/db/schema.ts` | TOUCH | Add `album: text('album')` (nullable) to `tracks`; add `kind: text('kind', { enum: ['scrape', 'download'] }).default('scrape')` to `invocations`. |
| `drizzle/0001_*.sql` | NEW (auto-gen via `pnpm db:generate`) | Drizzle migration adding the two columns. |
| `src/modules/server/downloader/YtDlpBridge.ts` | NEW | argv-form spawn wrapper. Two methods: `probe(query)` → `{ videoId, durationSeconds } | error` ; `download(videoId, outputPath)` → `void | error`. Mirrors `SpotifyScraperBridge` shape. |
| `src/modules/server/downloader/schema.ts` | NEW | Zod schemas: probe envelope, error taxonomy enum, match settings shape. |
| `src/modules/server/downloader/DownloadRunner.ts` | NEW | Per-source orchestrator: settings snapshot, invocation row, p-limit pool, per-track state machine. Does NOT spawn directly — uses `YtDlpBridge`. |
| `src/modules/server/downloader/repository.ts` | NEW | Drizzle queries: select pending+matched tracks for source, update single track state, settings get/save. |
| `src/modules/server/downloader/tagger.ts` | NEW | `node-id3` wrapper. Single function: `embedTags(filepath, { title, artist, album?, coverArtBuffer? })`. Uses sync API; throws on failure. |
| `src/modules/server/downloader/cover-art.ts` | NEW | HTTP fetch helper. Single function: `fetchCoverArt(url)` → `{ buffer, mime } | null`. Logs and returns null on 404/network error. |
| `src/modules/server/downloader/slug.ts` | NEW | `sourceSlug(name)` + `safeFilename(artist, title)`. Deterministic + cross-platform-safe. |
| `src/modules/server/downloader/handler.ts` | NEW | `registerDownloadHandler()` — subscribes to `playlist.sync.completed`, awaits `DownloadRunner.run`. |
| `src/modules/server/scheduler/PlaylistScheduler.ts` | TOUCH (D-06) | Verify `executePlaylistSync` `await`s the entire emit chain so lock spans both runners. Reading EventBus.ts: `emit()` already does `await Promise.allSettled(promises)` — so as long as the handler is registered + returns a promise, the lock automatically spans. **No code change should be needed in scheduler — just verify the chain.** Plan should add a focused unit test for "lock held across handler chain." |
| `src/modules/server/events/handlers.ts` OR `src/modules/server/downloader/handler.ts` | NEW | The new handler. CONTEXT says either location works; **recommended: `downloader/handler.ts`** (keeps Phase 3 code co-located, and `handlers.ts` is generic-utility-handlers, not feature-specific). |
| `server/plugins/events.ts` | TOUCH | Register the new handler alongside `registerDiscordWebhookHandler` etc. |
| `src/modules/server/db/seed.ts` | TOUCH | Add a default `match` row to `global_settings` (`{ tolerance_seconds: 3, parallel: 3 }`). |
| `Dockerfile`, `Dockerfile.dev` | TOUCH | Add `yt-dlp` to the existing scraper venv install line; ensure `ffmpeg` is in apt list (Dockerfile already has it; Dockerfile.dev already has it). |
| `scraper/requirements.txt` | TOUCH | Add `yt-dlp==2026.3.17` (or planner-chosen pinned version). |
| `package.json` | TOUCH | Add `node-id3`, `p-limit`, `slugify` to dependencies. |
| `.gitignore` | NO CHANGE | `data/` is already excluded — covers `data/music/`. [VERIFIED via .gitignore read] |

### Recommended Project Structure

```
src/modules/server/downloader/          # NEW — sibling to scraper/
├── YtDlpBridge.ts                      # CLI spawn wrapper (mirror SpotifyScraperBridge)
├── DownloadRunner.ts                   # Per-source orchestration
├── repository.ts                       # Track-row updates + settings reads
├── handler.ts                          # EventBus subscription
├── schema.ts                           # Zod schemas + error enum + match settings
├── tagger.ts                           # node-id3 wrapper
├── cover-art.ts                        # HTTP fetch helper
├── slug.ts                             # Filename + folder slug helpers
├── YtDlpBridge.test.ts                 # Unit (mocked spawn)
├── DownloadRunner.test.ts              # Unit (mocked bridge + repo + fs)
├── repository.test.ts                  # Unit (Drizzle in-memory or mocked)
├── tagger.test.ts                      # Unit (real fixture MP3)
├── slug.test.ts                        # Unit (pure)
└── integration.test.ts                 # Gated DOWNLOADER_INTEGRATION=1
```

### Pattern 1: Bridge — argv-form spawn with typed envelope

**What:** Mirror `SpotifyScraperBridge` exactly. Spawn yt-dlp with `argv[]` (no shell), accumulate stdout/stderr buffers, await `close` event, return a typed `Result<Envelope, Error>`.

**When to use:** Always. This is the only correct way to invoke external CLIs from Node — the `shell: false` default prevents argv injection; argv-form prevents URL/title escaping bugs; awaiting `close` (not `exit`) ensures stdout drained.

**Example (verified pattern from SpotifyScraperBridge.ts:67-93):**
```typescript
// Source: src/modules/server/scraper/SpotifyScraperBridge.ts (Phase 2)
const child = spawn(this.ytDlpBin, [
    "--print", "id",
    "--print", "duration",
    "--skip-download",
    "--no-warnings",
    "-q",  // quiet — suppress non-error stderr
    `ytsearch1:${query}`,  // argv form — no shell escaping needed
], { stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });

const stdoutChunks: Buffer[] = [];
const stderrChunks: Buffer[] = [];
child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));

const [code] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
```

### Pattern 2: --print field separation — use multiple --print flags, NOT a literal pipe template

**What:** yt-dlp's `--print 'id|duration'` is **a single output template** — `id|duration` is treated as one template line where `id` and `duration` are template fields, but the literal `|` between them is just a literal pipe character in the output. So the output is `<id>|<seconds>\n`. This works but is fragile.

**Why preferred multi-print:** Each `--print id` and `--print duration` produces its own line. So `--print id --print duration` produces two lines: `<id>\n<seconds>\n` — easier to parse, no escaping risk if a future template field contains a literal pipe.

**Recommendation:** Use **two `--print` flags** for forward-compat. Parse the output by splitting on `\n` and taking the first two non-empty lines. [CITED: yt-dlp README via Context7 — "Field name or output template ... separated by ':'" + WebFetch on Debian manpage confirming each --print produces a separate line]

**Verified flag semantics:**
- `--print FIELD` (or template) — implies `--quiet` and `--simulate` (so no download). [CITED: WebFetch on yt-dlp(1) manpage]
- `--skip-download` (alias `--no-download`) — write related files (subs, etc.) but no media. With `--print`, this is redundant but harmless. **Use both for clarity.**
- `-q / --quiet` — suppresses default progress output. Combined with `--print`, leaves only the printed fields on stdout.
- `--no-warnings` — suppress warnings (non-fatal alerts). Recommended for probe step.
- `--no-playlist` — for the download call only, ensures a single video URL is treated as a single video. (Not needed when passing `https://www.youtube.com/watch?v=<id>` directly, but harmless.)

### Pattern 3: probe-then-download (D-08)

**What:** Two yt-dlp spawns per track. First spawn extracts metadata only (no bytes). If duration matches, second spawn downloads + extracts audio.

**When to use:** Always for v1. Saves bandwidth on rejected tracks (duration mismatch, no_results) which is a non-trivial fraction with strict ±3s gates.

**Example:**
```typescript
// PROBE call (no download)
const probe = await spawn(YT_DLP_BIN, [
    "--print", "id",
    "--print", "duration",
    "--skip-download",
    "--no-warnings",
    "-q",
    `ytsearch1:${artist} ${title}`,
]);
// stdout: "<videoId>\n<durationSeconds>\n"
// stdout: "" + exit 0 = no_results (KEY: must check empty stdout, not exit code)

// DOWNLOAD call (only if probe passed gate)
const dl = await spawn(YT_DLP_BIN, [
    "-f", "bestaudio",
    "--extract-audio",
    "--audio-format", "mp3",
    "--audio-quality", "0",  // 0 = best (VBR ~245 kbps)
    "--no-warnings",
    "-q",
    "-o", absolutePath,        // -o with absolute path bypasses --paths
    `https://www.youtube.com/watch?v=${videoId}`,
]);
// On success: file exists at absolutePath, exit code 0
// On failure: stderr has the error, exit code != 0
```

### Pattern 4: Settings snapshot at run start (D-11, D-16)

**What:** Read `global_settings.match` once at `DownloadRunner.run` start. Cache `tolerance_seconds` + `parallel` in local consts for the entire run. Mid-run setting changes do not apply.

**Example (verified shape from WebhookRepository pattern):**
```typescript
// Source pattern: src/modules/server/webhooks/repository.ts:17-34 (Phase 2 verified)
const MATCH_SETTINGS_KEY = "match" as const;
const MatchSettingsSchema = z.object({
    tolerance_seconds: z.number().int().min(0).max(60).default(3),
    parallel: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});

async getMatchSettings(): Promise<MatchSettings> {
    const [row] = await getDb()
        .select()
        .from(schema.globalSettings)
        .where(eq(schema.globalSettings.key, MATCH_SETTINGS_KEY));
    if (!row) { return MatchSettingsSchema.parse({}); }  // defaults
    try {
        return MatchSettingsSchema.parse(JSON.parse(row.value));
    } catch {
        return MatchSettingsSchema.parse({});
    }
}
```

### Pattern 5: p-limit fan-out — single pool per run

**What:** Construct `pLimit(N)` once at run start. Wrap each per-track unit in `limit(() => processTrack(track))`. `Promise.allSettled` over the wrapped promises, then aggregate counters from the settled results.

**Example (verified from p-limit Context7):**
```typescript
// Source: github.com/sindresorhus/p-limit README via Context7
import pLimit from "p-limit";

async run(sourceId: string) {
    const settings = await this.repo.getMatchSettings();
    const limit = pLimit(settings.parallel);
    const tracks = await this.repo.getTracksToProcess(sourceId);  // pending + matched

    const results = await Promise.allSettled(
        tracks.map((t) => limit(() => this.processTrack(t, settings.tolerance_seconds))),
    );

    const counters = results.reduce((acc, r) => { /* tally by state */ }, INIT);
    await this.invocationRepo.update(invocationId, {
        status: "success",
        summary: JSON.stringify(counters),
    });
}
```

### Pattern 6: Track state machine — write at every transition

**What:** Three explicit DB writes per accepted track, mirroring D-02:
1. After probe + duration gate passes: `UPDATE tracks SET state='matched', yt_video_id=?, updated_at=NOW() WHERE id=?`
2. After yt-dlp + node-id3 succeed: `UPDATE tracks SET state='downloaded', download_path=?, updated_at=NOW() WHERE id=?`
3. On any failure: `UPDATE tracks SET state='failed' (or 'skipped_low_confidence'), failure_reason=?, updated_at=NOW() WHERE id=?`

If the runner crashes between (1) and (2), the next run picks up `state='matched'` rows and skips the probe call (D-07 + MATCH-04). This is the safety property that justifies the three-write pattern over a single end-of-task write.

### Pattern 7: idempotent skip-if-exists check (D-15)

**What:** Before issuing the probe call for a `pending` track, check if the target file already exists on disk. If so, transition to `downloaded` directly — no spawn, no HTTP, no tagger.

**Why:** Idempotent re-runs after a server restart. Phase 5's manual retry (TRACK-04) handles the "force re-download" case by deleting the file first.

```typescript
import { access } from "node:fs/promises";

async processTrack(track, toleranceSeconds) {
    const targetPath = path.join(MUSIC_ROOT, sourceSlug, safeFilename(track.artist, track.title));
    try {
        await access(targetPath);
        // File exists; skip everything, mark downloaded
        await this.repo.markDownloaded(track.id, targetPath);
        return { status: "skipped_exists" };
    } catch {
        // ENOENT — proceed with probe + download
    }
    // ...
}
```

### Anti-Patterns to Avoid

- **Spawning yt-dlp in shell mode (`shell: true`).** Opens command-injection risk if any field is even tangentially user-controlled. Argv-form spawn (default `shell: false`) is the only correct invocation. [CITED: Phase 2 SpotifyScraperBridge security comment lines 12-15]
- **Detecting "no results" from yt-dlp by exit code alone.** yt-dlp exits 0 on zero-results-from-search; only `--print` empty stdout signals no_results. See Common Pitfall #1.
- **Treating `.part` files as completed downloads.** yt-dlp writes to `<final>.part` during download and renames on success. The skip-if-exists check must `access(targetPath)`, not the `.part` filename. See Common Pitfall #5.
- **Hand-rolling concurrency with `Promise.all + chunk`.** Loses fairness; if any chunk takes longer than another, the pool starves. Always use `p-limit`. See Don't Hand-Roll table.
- **Writing tags via yt-dlp's `--add-metadata` / `--embed-thumbnail`.** This embeds *YouTube* metadata, not Spotify metadata — defeats the whole point. Always tag in a separate node-id3 step using Spotify-sourced fields (D-12).
- **Reusing `outputDir` from the source row as the output dir for downloads.** REQUIREMENTS.md DOWNLOAD-03 + CONTEXT D-15 say `data/music/<source-slug>/...`. The user-set `outputDir` is **effectively ignored** in v1. See Open Question #2 — this is a planner-level call but the safer interpretation is "compute the v1 path from `data/music/` + slug at write time."

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Bounded concurrency over a list of async tasks | `for..of` chunks + `Promise.all` | `p-limit` | Hand-rolled chunking starves the pool when individual tasks have varying durations. p-limit's queue keeps N workers busy at all times. The codebase has zero existing concurrency primitives — adding p-limit is a clean, single-purpose dep. |
| Writing ID3v2.3/2.4 frames | Buffer/byte-level frame builder | `node-id3` | ID3v2 frame layout (sync-safe length encoding, text encoding bytes, APIC picture-type byte, MIME-type strings) has many edge cases. node-id3 handles them all. [CITED: node-id3 README via Context7] |
| Slug + filename sanitization for cross-platform safety | Inline regex in DownloadRunner | `slugify` (for source folder) + a small regex helper (for "Artist - Title" filename) | Windows reserves names like `CON`, `PRN`, `NUL`, `AUX`, `COM1-9`, `LPT1-9`. Cross-platform unsafe chars: `/ \ : * ? " < > |`. Length limits per-segment (255 bytes). Roll-your-own gets one of these wrong; existing libs don't. |
| MP3 tag reading (verification in tests) | parsing ID3 frames manually | `node-id3` (read API) | Same library handles read + write. Tests can verify `read(file).title === expected`. |
| Cover-art HTTP fetch with retry/timeout | hand-rolled fetch + setTimeout | global `fetch` (Node 22 built-in undici) with `AbortSignal.timeout(N)` | Node 22 has good built-in HTTP. Don't add `axios` or `got`. The codebase already uses global fetch in 5 places (verified). |
| ytsearch1 result parsing | regex on yt-dlp output | `--print id` + `--print duration` flags | yt-dlp can emit specific fields directly — no need to parse human-readable output. |
| Process timeout / kill | manual `setTimeout(child.kill, ...)` | `child_process.spawn`'s `timeout` option | Node's spawn already supports timeout natively. Phase 2's `SpotifyScraperBridge` uses it. |

**Key insight:** Every problem this phase faces has a battle-tested 1-purpose Node library or a Phase 2 pattern to copy. The DownloadRunner code itself should be plumbing, not algorithms.

## Runtime State Inventory

> Phase 3 is greenfield-on-greenfield: it adds new code but doesn't rename, refactor, or migrate existing runtime state from prior phases. There is no on-disk artifact, registered task, or external service config that contains a string about to be renamed. **This section is included for completeness and to document the lack of state traps.**

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 3 adds new code paths writing to existing tables (`tracks`, `invocations`, `global_settings`). The new `album` column on `tracks` is nullable; old (Phase 2) rows will simply read `album=NULL`. The new `kind` column on `invocations` defaults to `'scrape'` (so existing rows stay correctly classified) — verify this default in the migration. | Verify Drizzle migration sets `kind` default to `'scrape'` for existing rows. |
| Live service config | None — no n8n / Datadog / external service holds Phase-3-specific names. Discord webhook URL is in the DB (`global_settings.discord_webhook`), unaffected. | None. |
| OS-registered state | None — croner is in-process, Nitro hooks are in-process. No systemd / Task Scheduler / launchd entries. | None. |
| Secrets and env vars | One new env var: `YT_DLP_BIN` (optional, defaults to `'yt-dlp'` on PATH). Existing `PYTHON_BIN` from Phase 2 stays. No secrets affected. | Add `YT_DLP_BIN` validation to `src/env.ts` (mirror `PYTHON_BIN` shape). |
| Build artifacts / installed packages | `scraper/.venv/` will be a re-baked artifact in the Docker image once `yt-dlp==X.Y.Z` is added to `scraper/requirements.txt`. Existing dev containers will need a rebuild. | Note in plan: dev users must run `pnpm docker:dev` which rebuilds the venv layer. Or — easier — bake the yt-dlp install into a separate apt-installed binary path. **Planner picks per D-10.** |

**The canonical question answer:** *After every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?* — **Nothing**. Phase 3 only adds code; the rename surface is empty.

## Common Pitfalls

### Pitfall 1: yt-dlp `ytsearch1:` zero-results does NOT signal via exit code

**What goes wrong:** `DownloadRunner` issues a probe call for "Some Obscure Artist - Track That Doesn't Exist On YouTube". yt-dlp returns exit 0, empty stdout, and an info-level stderr message like `[youtube:search] Playlist <query>: Downloading 0 items`. If the bridge maps "exit 0" to "success", it then dereferences a `null` videoId and crashes.

**Why it happens:** yt-dlp treats "search for N results, found 0" as a successful empty-list result, not an error. There's no flag to make it fail on zero results.

**How to avoid:** The probe envelope MUST check `stdout.trim() === ""` after a 0-exit and treat empty as a typed `no_results` failure. The track gets `state='failed'` with `failure_reason='no_results'` and the run continues.

**Warning signs:** During testing, deliberately probe a query like `ytsearch1:'qwerasdfzxcv impossible nonsense 12345'` and verify the bridge returns `no_results`, not a crash.

[CITED: github.com/yt-dlp/yt-dlp/issues/8033 — issue thread describes exactly this behavior]

### Pitfall 2: search-term escaping for unicode + special characters

**What goes wrong:** A track with title like `Don't Stop Me Now` (curly apostrophe) or `(Live) — Acoustic Version` becomes `ytsearch1:Queen Don’t Stop Me Now` in argv. yt-dlp's `argv` parser handles this fine (no shell injection risk because `shell: false`), but YouTube's search may not match a curly-quote query against a straight-quote video title.

**Why it happens:** Spotify titles are user-supplied and contain mixed unicode. YouTube's search index is mostly normalized but not guaranteed.

**How to avoid:** Pre-normalize the query string before passing to argv:
- Replace curly quotes (`U+2018`, `U+2019`, `U+201C`, `U+201D`) with straight equivalents.
- Strip parenthesized parts containing keywords like `(Live)`, `(Acoustic)`, `(Remix)` — but **NOT in v1** (deferred to MATCH2-02 v2 reject-list). For Phase 3, just normalize quotes.
- Use Unicode `NFC` normalization for accented characters (`café` vs `café`).

**Warning signs:** A small percentage of tracks failing `no_results` despite obviously existing on YouTube. Track title contains `'`, `"`, or non-ASCII chars.

**Code reference:**
```typescript
function normalizeQuery(s: string): string {
    return s
        .normalize("NFC")
        .replaceAll(/[‘’]/g, "'")
        .replaceAll(/[“”]/g, '"');
}
```

### Pitfall 3: ffmpeg missing → cryptic yt-dlp failure

**What goes wrong:** yt-dlp's download call exits with code 1 and stderr `ERROR: Postprocessing: ffprobe and ffmpeg not found. Please install or provide the path using --ffmpeg-location`. Generic "exit 1" gets stored in `failure_reason`; the user can't tell whether the issue is missing ffmpeg or a per-video error.

**Why it happens:** yt-dlp delegates audio extraction to ffmpeg. If ffmpeg is not on PATH, the postprocessor silently can't extract.

**How to avoid:**
- The Dockerfile must install `ffmpeg` via apt (already done at line 38 of `Dockerfile`, line 6 of `Dockerfile.dev`).
- `DownloadRunner.run` should pre-flight check: `await fsAccess(execPath('ffmpeg'))` or run a one-off `ffmpeg -version` spawn at startup. If not found, the runner's invocation row finishes `failed` with a clear `summary.failure_reason='ffmpeg_missing'` instead of mass-failing every track.
- Better: `YtDlpBridge.checkPrerequisites()` runs once at construction and caches the result.

**Warning signs:** Every track in a sync fails with the same exit code and stderr starting with `ERROR: Postprocessing`.

[VERIFIED: yt-dlp README via WebFetch — "Strongly recommended ... Required for ... post-processing"]

### Pitfall 4: filename sanitization gets reserved names wrong on Windows

**What goes wrong:** A track titled `Aux Cable Blues` by `CON Artist` gets sanitized to `CON Artist - Aux Cable Blues.mp3`. On Windows, `CON` is a reserved device name — the file write throws `EINVAL`. Even on Linux/Mac the file works, but the user hosts the music library on a Windows-mapped network drive, and explorer chokes.

**Why it happens:** Windows reserves: `CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9` (case-insensitive, with or without extension). Plus chars `< > : " / \ | ? *` and trailing dots/spaces.

**How to avoid:** Recommended sanitization order:
1. Replace each unsafe char with `_`: `[<>:"/\\|?*\x00-\x1F]` → `_`
2. Trim trailing dots and spaces (Windows strips them silently).
3. If basename matches `/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i`, prepend `_`.
4. Cap total length at 200 chars to leave headroom for path prefix.

**Warning signs:** Tracks fail to write on Windows-shared filesystems; success on Linux container, fail on host SMB mount.

**Recommendation for slug helper:**
```typescript
// src/modules/server/downloader/slug.ts
import slugify from "slugify";

const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

export function sourceSlug(name: string): string {
    return slugify(name, { lower: true, strict: true, trim: true }) || "untitled";
}

export function safeFilename(artist: string, title: string): string {
    const raw = `${artist} - ${title}`;
    let safe = raw.replace(UNSAFE_CHARS, "_").trim().replace(/\.+$/, "");
    if (WINDOWS_RESERVED.test(safe)) { safe = `_${safe}`; }
    return safe.slice(0, 200) + ".mp3";
}
```

### Pitfall 5: yt-dlp `.part` files mistaken for completed downloads

**What goes wrong:** yt-dlp crashes mid-download (network drop, killed). A `Artist - Title.mp3.part` file is left on disk. On retry, the skip-if-exists check looks for `Artist - Title.mp3` (the final name), correctly doesn't find it, and re-downloads. That's fine — but the orphan `.part` file accumulates.

**Why it happens:** yt-dlp writes the partial file as `<final>.part` and renames atomically on completion. If the process is killed or crashes, the `.part` file is orphaned.

**How to avoid:**
- The skip-if-exists check uses the **final** filename (without `.part`) — correct as written in CONTEXT D-15.
- Add a one-line "stale .part cleanup" pass at run start: `glob('data/music/**/*.part').forEach(unlink)`. Optional polish, not required for v1.

**Warning signs:** `data/music/<slug>/` accumulates `*.part` files over many failed runs.

[VERIFIED: WebSearch confirmed `.part` extension and atomic rename behavior]

### Pitfall 6: EventBus handler-await semantics already do what we need (D-06 simplification)

**What goes wrong:** Planner assumes EventBus.emit is fire-and-forget and writes complex callback machinery to make `runningPlaylists` lock survive the handoff. This is unnecessary overhead.

**Why it happens:** "Event bus = fire and forget" is a common assumption. But this codebase's bus is `await Promise.allSettled(...)` (verified at `src/modules/server/events/EventBus.ts:177`).

**How to avoid:** Read the source. `EventBus.emit` returns `Promise<void>` that resolves only **after** all handlers settle. Therefore:
- `SyncRunner.run` awaits `eventBus.emit("playlist.sync.completed", ...)` (already does — line 247-258).
- The new download handler is registered via `bus.on("playlist.sync.completed", async (event) => { await new DownloadRunner(...).run(event.payload.playlistId); })`.
- `PlaylistScheduler.executePlaylistSync` already awaits `this.syncRunner.run(source)` (line 94). Since `run` awaits emit, which awaits all handlers, the lock is automatically held until the download handler returns.

**Result:** D-06 is satisfied with **zero scheduler changes** — just register the handler. The plan should include a focused unit test that exercises this end-to-end-await chain.

**Warning signs:** Plan tries to add a "release callback" passed from scheduler to runner. This is overcomplicated.

[VERIFIED: src/modules/server/events/EventBus.ts:177 — `await Promise.allSettled(promises);`]

### Pitfall 7: SQLite ALTER TABLE limitations for the `kind` column default

**What goes wrong:** Drizzle generates `ALTER TABLE invocations ADD COLUMN kind TEXT DEFAULT 'scrape' NOT NULL`. SQLite supports this — but only because we're adding a column with a DEFAULT. A column without a default would require recreating the table. A column with a non-constant default (`CURRENT_TIMESTAMP` etc.) also requires special handling.

**Why it happens:** SQLite's `ALTER TABLE` is more limited than other RDBMSes — only `ADD COLUMN`, `RENAME COLUMN`, `RENAME TO`, `DROP COLUMN` (3.35+).

**How to avoid:**
- Both new columns (`tracks.album`, `invocations.kind`) are simple: `album` is nullable (no default needed); `kind` has a constant default (`'scrape'`). Both are `ADD COLUMN` operations that SQLite supports natively. **No migration gotchas expected.**
- After running `pnpm db:generate`, the planner should review the generated SQL to confirm it's a plain `ADD COLUMN` and not a table-recreate (which Drizzle does sometimes for SQLite when column constraints can't be added in-place).
- If Drizzle generates a recreate, accept it — clean-break DB approach (Phase 1 D-05) means data loss isn't a concern.

**Warning signs:** Generated migration file has `CREATE TABLE __new_invocations` + `INSERT INTO __new_invocations SELECT * FROM invocations` + `DROP TABLE invocations` + `ALTER TABLE __new_invocations RENAME TO invocations`. This means Drizzle decided to recreate. Functional but slower.

### Pitfall 8: cover-art fetch failure must NOT abort the track

**What goes wrong:** The cover-art HTTP fetch returns 404 (CDN URL expired) or times out. The current track's tagging step throws; the track is marked `failed` with a misleading reason; the user thinks yt-dlp failed.

**Why it happens:** Per D-14, cover art is best-effort. But naive code treats fetch errors as fatal.

**How to avoid:** `cover-art.ts` returns `Buffer | null` — never throws for HTTP errors. Only logs a warning. The `tagger` skips the APIC frame when `coverArtBuffer === null`. Tests must include "cover-art 404 → track still completes with title/artist tagged."

```typescript
// cover-art.ts
export async function fetchCoverArt(url: string | null, logger: AppLogger): Promise<{ buffer: Buffer; mime: string } | null> {
    if (!url) return null;
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) {
            logger.warn({ url, status: res.status }, "cover-art fetch non-2xx — skipping APIC");
            return null;
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        const mime = res.headers.get("content-type") ?? "image/jpeg";
        return { buffer, mime };
    } catch (err) {
        logger.warn({ url, err }, "cover-art fetch failed — skipping APIC");
        return null;
    }
}
```

### Pitfall 9: node-id3 image field shape — use object, not bare path

**What goes wrong:** node-id3 supports both `APIC: "./path/to.jpg"` (string = filepath, library reads it) AND `image: { mime, type, description, imageBuffer }` (object form for inline buffer). Mixing shapes silently produces an empty APIC frame.

**Why it happens:** The node-id3 README documents both, in different examples.

**How to avoid:** Use the **object form** with `imageBuffer` since we have a Buffer in memory (just fetched):
```typescript
const tags: NodeID3.Tags = {
    title: track.title,
    artist: track.artist,
    ...(track.album ? { album: track.album } : {}),
    ...(coverArt ? {
        image: {
            mime: coverArt.mime,            // "image/jpeg" or "image/png"
            type: { id: 3 },                // 3 = front cover (id3.org)
            description: "Cover",
            imageBuffer: coverArt.buffer,
        },
    } : {}),
};
const result = NodeID3.write(tags, filepath);
if (result !== true) {
    throw new Error(`node-id3 write failed: ${result instanceof Error ? result.message : "unknown"}`);
}
```

[CITED: node-id3 README via Context7 — "image: { mime, type, description, imageBuffer }"]

### Pitfall 10: node-id3 sync API returns `true | Error` (not throws)

**What goes wrong:** Code wraps `NodeID3.write(tags, filepath)` in try/catch expecting throws. Errors are returned, not thrown — try/catch never fires; the `false`/`Error` return is dropped.

**Why it happens:** node-id3 follows an older Node convention: sync API returns `true` or an `Error` instance.

**How to avoid:** Always check the return value:
```typescript
const result = NodeID3.write(tags, filepath);
if (result instanceof Error) { throw result; }
if (result !== true) { throw new Error("node-id3 write returned falsy"); }
```

[CITED: node-id3 README via Context7 — "Returns true/Error"]

## Code Examples

Verified patterns from official sources + Phase 2 codebase.

### YtDlpBridge.probe — argv-form spawn with empty-stdout no_results detection

```typescript
// Source pattern: src/modules/server/scraper/SpotifyScraperBridge.ts
// Adapted for yt-dlp + handles "exit 0 + empty stdout = no_results" pitfall.

import { spawn } from "node:child_process";
import { once } from "node:events";

interface ProbeOk {
    ok: true;
    videoId: string;
    durationSeconds: number;
}
interface ProbeError {
    ok: false;
    type: "no_results" | "ytdlp_crash" | "network_error" | "download_error";
    message: string;
}

async probe(query: string): Promise<ProbeOk | ProbeError> {
    const child = spawn(this.ytDlpBin, [
        "--print", "id",
        "--print", "duration",
        "--skip-download",
        "--no-warnings",
        "-q",
        `ytsearch1:${query}`,
    ], { stdio: ["pipe", "pipe", "pipe"], timeout: 30_000 });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    child.stdout.on("data", (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.stdin.end();  // No input expected

    const [code] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
    const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();

    if (code !== 0) {
        return { ok: false, type: "ytdlp_crash", message: `exit=${code} ${stderr.slice(0, 500)}` };
    }
    // PITFALL #1: exit 0 + empty stdout = no_results
    if (stdout === "") {
        return { ok: false, type: "no_results", message: `ytsearch1: returned no results for ${query}` };
    }

    const lines = stdout.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) {
        return { ok: false, type: "ytdlp_crash", message: `unexpected probe output: ${stdout.slice(0, 200)}` };
    }
    const [videoId, durationStr] = lines;
    const durationSeconds = Number.parseInt(durationStr, 10);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
        return { ok: false, type: "ytdlp_crash", message: `invalid duration: ${durationStr}` };
    }
    return { ok: true, videoId, durationSeconds };
}
```

### YtDlpBridge.download — extract MP3 to absolute path

```typescript
async download(videoId: string, outputPath: string): Promise<{ ok: true } | ProbeError> {
    const child = spawn(this.ytDlpBin, [
        "-f", "bestaudio",
        "--extract-audio",
        "--audio-format", "mp3",
        "--audio-quality", "0",
        "--no-warnings",
        "-q",
        "-o", outputPath,
        `https://www.youtube.com/watch?v=${videoId}`,
    ], { stdio: ["pipe", "pipe", "pipe"], timeout: 300_000 /* 5 min */ });

    const stderrChunks: Buffer[] = [];
    child.stderr.on("data", (c: Buffer) => stderrChunks.push(c));
    child.stdin.end();

    const [code] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
    if (code !== 0) {
        const stderr = Buffer.concat(stderrChunks).toString("utf8").trim();
        // Heuristic: detect ffmpeg-missing for clearer diagnostic
        const type = /ffmpeg|ffprobe/i.test(stderr) ? "download_error" : "download_error";
        return { ok: false, type, message: `exit=${code} ${stderr.slice(0, 500)}` };
    }
    return { ok: true };
}
```

### Duration gate (MATCH-02 + MATCH-03)

```typescript
// In DownloadRunner.processTrack
const probe = await this.bridge.probe(`${track.artist} ${track.title}`);
if (!probe.ok) {
    if (probe.type === "no_results") {
        await this.repo.markFailed(track.id, "no_results");
    } else {
        await this.repo.markFailed(track.id, `${probe.type}: ${probe.message.slice(0, 500)}`);
    }
    return { state: "failed" };
}

const spotifyDurationSec = Math.round(track.durationMs / 1000);
const delta = Math.abs(probe.durationSeconds - spotifyDurationSec);
if (delta > toleranceSeconds) {
    await this.repo.markSkippedLowConfidence(track.id, probe.videoId, delta, spotifyDurationSec, probe.durationSeconds);
    return { state: "skipped_low_confidence" };
}

await this.repo.markMatched(track.id, probe.videoId);
// ... proceed to download
```

### Tagger (node-id3 with object-form image)

```typescript
// src/modules/server/downloader/tagger.ts
import NodeID3 from "node-id3";

interface TagInput {
    title: string;
    artist: string;
    album?: string | null;
    coverArt?: { buffer: Buffer; mime: string } | null;
}

export function embedTags(filepath: string, tags: TagInput): void {
    const id3Tags: NodeID3.Tags = {
        title: tags.title,
        artist: tags.artist,
        ...(tags.album ? { album: tags.album } : {}),
        ...(tags.coverArt ? {
            image: {
                mime: tags.coverArt.mime,
                type: { id: 3 },  // 3 = front cover per id3.org
                description: "Cover",
                imageBuffer: tags.coverArt.buffer,
            },
        } : {}),
    };
    const result = NodeID3.write(id3Tags, filepath);
    if (result instanceof Error) { throw result; }
    if (result !== true) { throw new Error("node-id3 write returned non-true"); }
}
```

### DownloadRunner skeleton (full state machine)

```typescript
// src/modules/server/downloader/DownloadRunner.ts (skeleton — planner refines)
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import { InvocationRepository } from "../invocation/repository";
import { fetchCoverArt } from "./cover-art";
import { DownloadRepository } from "./repository";
import { sourceSlug, safeFilename } from "./slug";
import { embedTags } from "./tagger";
import { YtDlpBridge } from "./YtDlpBridge";

const MUSIC_ROOT = "data/music";

export class DownloadRunner {
    constructor(
        private readonly bridge: YtDlpBridge = new YtDlpBridge(),
        private readonly repo: DownloadRepository = new DownloadRepository(),
        private readonly invocationRepo: InvocationRepository = new InvocationRepository(),
        private readonly logger: AppLogger = Logger.get("DownloadRunner"),
    ) {}

    async run(sourceId: string): Promise<void> {
        const invocationId = randomUUID();
        const startedAt = new Date();
        const source = await this.repo.getSource(sourceId);
        if (!source) { return; /* defensive */ }

        const tracks = await this.repo.getTracksToProcess(sourceId);  // pending + matched
        if (tracks.length === 0) {
            this.logger.info({ sourceId }, "DownloadRunner: zero tracks to process — exit cleanly");
            return;
        }

        await this.invocationRepo.create({
            id: invocationId,
            playlistId: sourceId,
            startedAt,
            status: "running",
            // kind: "download" — once the kind column lands
        });

        const settings = await this.repo.getMatchSettings();
        const limit = pLimit(settings.parallel);
        const slug = sourceSlug(source.name);
        const dir = path.resolve(MUSIC_ROOT, slug);
        await fs.mkdir(dir, { recursive: true });

        const results = await Promise.allSettled(
            tracks.map((t) => limit(() => this.processTrack(t, source, dir, settings.tolerance_seconds))),
        );

        const counters = this.countResults(results);
        await this.invocationRepo.update(invocationId, {
            finishedAt: new Date(),
            exitCode: 0,
            status: "success",
            summary: JSON.stringify(counters),
        });
    }

    private async processTrack(track, source, dir, toleranceSeconds) {
        const filename = safeFilename(track.artist, track.title);
        const targetPath = path.join(dir, filename);

        // Skip-if-exists (D-15)
        try {
            await fs.access(targetPath);
            await this.repo.markDownloaded(track.id, targetPath);
            return "skipped_exists";
        } catch { /* ENOENT — proceed */ }

        // Probe (skip if already matched)
        let videoId: string;
        if (track.state === "matched" && track.ytVideoId) {
            videoId = track.ytVideoId;
        } else {
            const probe = await this.bridge.probe(`${track.artist} ${track.title}`);
            if (!probe.ok) { await this.repo.markFailed(track.id, `${probe.type}: ${probe.message.slice(0,500)}`); return "failed"; }
            const spotifyDurationSec = Math.round(track.durationMs / 1000);
            const delta = Math.abs(probe.durationSeconds - spotifyDurationSec);
            if (delta > toleranceSeconds) {
                await this.repo.markSkippedLowConfidence(track.id, probe.videoId, delta);
                return "skipped_low_confidence";
            }
            videoId = probe.videoId;
            await this.repo.markMatched(track.id, videoId);
        }

        // Download
        const dl = await this.bridge.download(videoId, targetPath);
        if (!dl.ok) { await this.repo.markFailed(track.id, `${dl.type}: ${dl.message.slice(0,500)}`); return "failed"; }

        // Tag
        const coverArt = await fetchCoverArt(source.coverArtUrl, this.logger);
        try {
            embedTags(targetPath, { title: track.title, artist: track.artist, album: track.album, coverArt });
        } catch (err) {
            // Tag failure is non-fatal for the file (it's there) but we record it
            this.logger.warn({ err, trackId: track.id }, "tagging failed — file kept; track marked downloaded");
        }

        await this.repo.markDownloaded(track.id, targetPath);
        return "downloaded";
    }

    private countResults(results: PromiseSettledResult<string>[]) {
        const counters = { total: results.length, downloaded: 0, matched_only: 0, skipped_low_confidence: 0, failed: 0, skipped_exists: 0 };
        for (const r of results) {
            if (r.status === "fulfilled") {
                if (r.value === "downloaded" || r.value === "skipped_exists") { counters.downloaded++; }
                if (r.value === "skipped_low_confidence") { counters.skipped_low_confidence++; }
                if (r.value === "failed") { counters.failed++; }
            } else {
                counters.failed++;
            }
        }
        return counters;
    }
}
```

### Event handler registration

```typescript
// src/modules/server/downloader/handler.ts
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import { getEventBus } from "../events";
import type { PlaylistSyncCompletedEvent } from "../events/schema";
import { DownloadRunner } from "./DownloadRunner";

export function registerDownloadHandler(
    logger: AppLogger = Logger.get("DownloadHandler"),
): () => void {
    const bus = getEventBus();
    const runner = new DownloadRunner();

    return bus.on("playlist.sync.completed", async (event: PlaylistSyncCompletedEvent) => {
        try {
            await runner.run(event.payload.playlistId);
        } catch (err) {
            // Pitfall #6: handler-internal try/catch — don't break the bus chain
            logger.error({ err, sourceId: event.payload.playlistId }, "DownloadRunner crashed — see logs");
        }
    });
}
```

```typescript
// server/plugins/events.ts (add this line in the same shape as registerDiscordWebhookHandler)
import { registerDownloadHandler } from "../../src/modules/server/downloader/handler";
// ...
registerDownloadHandler(eventHandlerLogger);
pluginLogger.info("Download handler registered");
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `youtube-dl` (Python) | `yt-dlp` (Python fork) | yt-dlp diverged ~2021 with rapid feature pace; youtube-dl is largely unmaintained | We pick yt-dlp; matches every modern audio-grabber tool. |
| `spotdl` CLI wrapper | direct `yt-dlp` + Spotify scraper | This phase | We control the matching logic + skip the broken spotdl metadata path. |
| ID3 frame buffer hand-rolling | `node-id3` library | Always, since ID3v2 layout is byte-precise | Standard for any Node MP3 tag work. |
| Naive `Promise.all` for concurrency | `p-limit` bounded pool | Established Node pattern since ~2018 | Avoids YouTube rate-limit (default cap of 5 per PROJECT.md). |
| Single yt-dlp call (download + extract) | Two-call probe-then-download (D-08) | This phase, for bandwidth on rejects | Saves bytes on `skipped_low_confidence` rejects; pays one extra short spawn for accepted tracks. |

**Deprecated/outdated:**
- `youtube-dl` (parent project): mostly unmaintained as of 2024+; yt-dlp is the active fork.
- `node-id3`'s `tag` filepath form (e.g. `APIC: "./cover.jpg"`): works but reads from disk; for our case we have the buffer in memory — use the object form with `imageBuffer`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | yt-dlp's `ytsearch1:` exits with code 0 (not non-zero) when zero results match the query | Pitfalls #1; Code Examples §probe | If yt-dlp actually exits non-zero, our `no_results` detection logic still works (it falls through to the `code !== 0` branch) — just the typed `failure_reason` would be `ytdlp_crash` instead of `no_results`. Quality issue, not functional. **Verifiable in 5 minutes**: run `yt-dlp --print id --skip-download "ytsearch1:asdfasdfasdfqwertyimpossible123"` and check `$?`. |
| A2 | The `data/music/<source-slug>/<artist> - <title>.mp3` path layout supersedes the user's `outputDir` field on `sources` for v1 | Architecture §Filesystem layout; Pitfalls 4 | If the user expected the configured `outputDir` to be honored, files will land in the wrong place. **Open Question #2 needs resolution before planning.** |
| A3 | Drizzle's `db:push` for adding `album` (nullable) + `kind` (with default) columns will be a simple `ALTER TABLE ADD COLUMN` (not a table recreate) | Pitfalls #7 | If Drizzle decides to recreate, downloaders still work — just slower migration. Clean-break DB approach (Phase 1 D-05) means data loss isn't a concern. |
| A4 | `--audio-quality 0` produces VBR ~245 kbps MP3 from yt-dlp+ffmpeg audio extraction | Code Examples §download | If quality is lower than expected, users may complain. Spike validates only after a real run. Phase 3 acceptance criterion #5 (one tagged MP3 on disk) will catch this in manual smoke. |
| A5 | Cover-art URLs from spotifyscraper return `Content-Type: image/jpeg` (not `image/png`) most of the time | Pitfalls #8; Code Examples §cover-art | If wrong, the `mime` we pass to node-id3 is wrong but APIC frame still works in most players. Check `Content-Type` header at fetch time and pass through. |
| A6 | The `playlist.sync.completed` event's `playlistId` field carries the source ID (not a separate playlist concept) | Architecture §System Diagram; Code Examples §handler | Verified: yes — event schema lines 27-36 + Phase 2 SyncRunner line 96-101 confirm `playlistId: source.id`. Not actually an assumption. Resolved. |
| A7 | The existing `--print 'id|duration'` literal pipe-template idea (mentioned in CONTEXT D-08) parses correctly. Recommendation: use **two `--print` flags** instead | Standard Stack §Pattern 2 | Both work; multi-flag is safer. Planner picks. |
| A8 | The new download handler returns a `Promise` that the EventBus awaits, which the SyncRunner's emit awaits, which executePlaylistSync awaits — making D-06 a no-op for the scheduler | Pitfalls #6 | Verified by reading `EventBus.ts:177` (Promise.allSettled) and `SyncRunner.ts:247` (await emit). Resolved. |

**Calibration note:** A1, A2, A3, A4, A5, A7 are real assumptions worth pinging the user on. A6 and A8 were `[ASSUMED]` in the heat of writing but verified by code-read; promoted to facts.

## Open Questions (RESOLVED)

> All five questions resolved during plan-checker iteration 1 (2026-04-25). Resolutions are reflected in the plan files; recorded here for audit.

1. **Does `outputDir` on `sources` still mean anything in v1, or is it shadowed by `data/music/<source-slug>/`?**
   - What we know: REQUIREMENTS.md DOWNLOAD-03 + CONTEXT D-15 specify `data/music/<source-slug>/...`. The existing `outputDir` field on `sources` is freeform user input (e.g., `process.cwd()/downloads/daily-mix` from seed.ts). The field is part of `PlaylistSyncStartedEvent.payload.outputDir` (events/schema.ts:34), but no Phase 3 code consumes it.
   - What's unclear: is `outputDir` deprecated for v1, kept for future LAY2-01 (user-configurable templates), or supposed to be the source slug?
   - **RESOLVED:** `outputDir` is kept as a UI/data field but NOT used by Phase 3's filesystem layout. Phase 3 derives `data/music/<sourceSlug>` independently via `MUSIC_ROOT="data/music"` constant in plan 03-04. Field stays for forward-compat with LAY2-01 but the file write path ignores it.

2. **Should the new download-trigger handler live in `src/modules/server/events/handlers.ts` or `src/modules/server/downloader/handler.ts`?**
   - What we know: CONTEXT explicitly says either is OK. handlers.ts is generic-utility-handlers (logging, metrics, scheduler reload, log cleanup); the Discord webhook handler lives in its own feature module (`src/modules/server/webhooks/handler.ts`).
   - What's unclear: just convention.
   - **RESOLVED:** Handler lives at `src/modules/server/downloader/handler.ts` — mirrors the Discord webhook pattern. Keeps Phase 3 code co-located. Locked by plan 03-04 Task 4.

3. **Should Phase 3 extend the Discord webhook formatter to surface download-summary counts, or defer to Phase 5?**
   - What we know: CONTEXT lists this as Claude's discretion in the deferred section. The current webhook handler reads `playlist.sync.completed` events — but that event is emitted by the SCRAPE only (right when scrape finishes). The download finalization writes a separate `invocations` row but does NOT emit a new event in the current design.
   - What's unclear: whether to emit a new event type (e.g. `playlist.download.completed`) or to skip webhook integration in v1.
   - **RESOLVED:** Emit a new event type `playlist.download.completed` with the download counters payload (locked by plan 03-04 Task 1 — `PlaylistDownloadCompletedEventSchema` added to `src/modules/server/events/schema.ts`). Webhook formatter extension to render the new event is deferred to Phase 5; for Phase 3, the bus carries the data and downstream handlers can subscribe.

4. **Pinning yt-dlp via apt vs pip-into-venv vs binary?**
   - What we know: D-10 leaves this to Claude. The repo already has a Python venv (`scraper/.venv/`) with spotifyscraper installed.
   - What's unclear: which is smallest image diff + easiest periodic bump.
   - **RESOLVED:** `yt-dlp==2026.3.17` added to `scraper/requirements.txt` (locked by plan 03-01). Reuses existing venv; one-line change in two Dockerfiles; binary lands at `/app/scraper/.venv/bin/yt-dlp`. `YT_DLP_BIN` env var resolves to this path in docker-compose; PATH fallback handles host dev.

5. **Is "tag failure should leave track in `downloaded` state vs `failed` state" the right trade-off?**
   - What we know: The skeleton above marks `downloaded` even when tagging fails (file is on disk; ID3 frames missing). This is a defensible choice but not specified in CONTEXT.
   - What's unclear: User's preference. If tag failure → `failed`, the file becomes orphaned (D-15 skip-if-exists will skip it next time, never re-tagging).
   - **RESOLVED:** Tag failure → `state=downloaded` with a logged warning (locked by plan 03-04 Task 3). The file is on disk and playable; missing ID3 is a quality issue, not a data-loss issue. The user can manually retry via Phase 5's TRACK-04 button to re-tag.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `yt-dlp` | MATCH-01..04, DOWNLOAD-01,05 | ✗ on host (verified `yt-dlp not found` via `which yt-dlp`) | — | Install via Docker image (Dockerfile Phase 3 update); host devs use `pnpm docker:dev`. Mirrors Phase 2's docker-only-dev (D-04 from Phase 2). |
| `ffmpeg` | DOWNLOAD-01 (yt-dlp postprocessor) | ✓ on host (`/opt/homebrew/bin/ffmpeg`); ✓ in production Dockerfile (line 38); ✓ in Dockerfile.dev (line 6) | host: not checked; container: pinned via apt | None needed. |
| `python3` (for yt-dlp via pip) | yt-dlp itself | ✓ in containers (Phase 2 Dockerfile lines 41 + 12) | 3.11 in slim base | Already there. |
| `node-id3` | DOWNLOAD-02 | ✗ not yet installed | — | `pnpm add node-id3` |
| `p-limit` | DOWNLOAD-04 | ✗ not yet installed | — | `pnpm add p-limit` |
| `slugify` | DOWNLOAD-03 | ✗ not yet installed | — | `pnpm add slugify` |
| Node 22 (for global fetch + AbortSignal.timeout) | cover-art.ts | ✓ Dockerfile uses `node:22-slim` (verified line 5) | 22.x | None needed. |
| Internet access during run | Cover-art fetch (D-14) + yt-dlp YouTube + spotifyscraper | required at runtime, not buildtime | — | Phase 3 best-effort: cover-art failure is logged + skipped (Pitfall #8); yt-dlp failure is per-track (D-03); spotifyscraper failure is Phase 2's concern. |
| `data/music/` writable | DOWNLOAD-03 file write | depends on container volume mount | — | docker-compose already mounts `data/`; `data/music/` will be created by `fs.mkdir({ recursive: true })` on first run. |

**Missing dependencies with no fallback:** None — all gaps are filled by package installs / Dockerfile updates.

**Missing dependencies with fallback:** All host-dev work uses Docker (mirrors Phase 2 D-04).

## Validation Architecture

> nyquist_validation is enabled (config.json: `workflow.nyquist_validation: true`).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.16 (already installed) |
| Config file | none — picked up from `vite.config.ts` |
| Quick run command | `pnpm test` (runs all unit tests; gated integration tests skip without `DOWNLOADER_INTEGRATION=1`) |
| Full suite command | `DOWNLOADER_INTEGRATION=1 SCRAPER_INTEGRATION=1 pnpm test` (run inside Docker dev container — see `.planning/codebase/TESTING.md`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| MATCH-01 | yt-dlp called with `ytsearch1:"<artist> <title>"` argv shape | unit (mocked spawn) | `pnpm test -- YtDlpBridge` | ❌ Wave 0 |
| MATCH-01 (no_results edge) | empty stdout + exit 0 → typed `no_results` | unit (mocked spawn) | `pnpm test -- YtDlpBridge` | ❌ Wave 0 |
| MATCH-02 | duration within ±tolerance → state=matched + yt_video_id persisted | unit (mocked bridge + repo) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| MATCH-02 (settings) | tolerance read from `global_settings.match` at run start | unit (mocked repo) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| MATCH-03 | duration outside tolerance → state=skipped_low_confidence + delta in failure_reason | unit (mocked bridge + repo) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| MATCH-04 | matched-state row skips re-search; reuses existing yt_video_id | unit (mocked bridge + repo) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| DOWNLOAD-01 | yt-dlp -f bestaudio --extract-audio --audio-format mp3 argv shape | unit (mocked spawn) | `pnpm test -- YtDlpBridge` | ❌ Wave 0 |
| DOWNLOAD-01 (e2e) | real yt-dlp produces a valid MP3 | gated integration | `DOWNLOADER_INTEGRATION=1 pnpm test -- integration` | ❌ Wave 0 |
| DOWNLOAD-02 | TIT2/TPE1/TALB/APIC frames written | unit (real fixture MP3 + node-id3 read) | `pnpm test -- tagger` | ❌ Wave 0 |
| DOWNLOAD-02 (album=null) | TALB omitted when track.album is null | unit | `pnpm test -- tagger` | ❌ Wave 0 |
| DOWNLOAD-02 (cover 404) | tag step succeeds with title/artist when cover-art fetch fails | unit (mocked fetch) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| DOWNLOAD-03 | output path is `data/music/<slug>/<artist> - <title>.mp3` | unit (slug + filename helpers) | `pnpm test -- slug` | ❌ Wave 0 |
| DOWNLOAD-03 (Windows reserved) | filenames containing CON/PRN/etc are prefixed | unit | `pnpm test -- slug` | ❌ Wave 0 |
| DOWNLOAD-04 | parallel=N read from settings; pLimit(N) used | unit (mocked + spied) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| DOWNLOAD-04 (default) | default settings JSON is `{tolerance_seconds:3, parallel:3}` | unit | `pnpm test -- repository` | ❌ Wave 0 |
| DOWNLOAD-05 | exit code + stderr tail captured in failure_reason | unit (mocked spawn) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| D-06 (lock spans both phases) | runningPlaylists held across `playlist.sync.completed` handler chain | unit (real EventBus) | `pnpm test -- PlaylistScheduler` | EXISTS, needs new test case |
| D-15 (skip-if-exists) | already-downloaded file → state=downloaded, no spawn | unit (mocked fs + bridge) | `pnpm test -- DownloadRunner` | ❌ Wave 0 |
| Success Criterion #5 | one real tagged MP3 lands on disk for a known-good track | manual smoke | `pnpm docker:dev` + click Sync-now in UI on seed playlist; verify `data/music/<slug>/*.mp3` exists + has tags | manual-only — documented in plan |

### Sampling Rate

- **Per task commit:** `pnpm test` (unit suite only, ~5s — gated integration skips)
- **Per wave merge:** `pnpm test` + `pnpm typecheck` + `pnpm check`
- **Phase gate (`/gsd-verify-work`):** All of the above + `DOWNLOADER_INTEGRATION=1 pnpm test` inside Docker (real yt-dlp + ffmpeg) + manual smoke (Success Criterion #5)

### Wave 0 Gaps

- [ ] `src/modules/server/downloader/YtDlpBridge.test.ts` — covers MATCH-01, DOWNLOAD-01, no_results edge
- [ ] `src/modules/server/downloader/DownloadRunner.test.ts` — covers MATCH-02, MATCH-03, MATCH-04, DOWNLOAD-04, DOWNLOAD-05, D-15
- [ ] `src/modules/server/downloader/repository.test.ts` — covers DOWNLOAD-04 default settings; track-state transitions
- [ ] `src/modules/server/downloader/tagger.test.ts` — covers DOWNLOAD-02 (with a small fixture MP3 file at `src/modules/server/downloader/__fixtures__/silent.mp3` — see Don't Hand-Roll: use a 1-second silent stub generated via ffmpeg + checked into git)
- [ ] `src/modules/server/downloader/slug.test.ts` — covers DOWNLOAD-03
- [ ] `src/modules/server/downloader/integration.test.ts` — gated DOWNLOADER_INTEGRATION=1; hits real yt-dlp on a known-good public-domain track URL (recommended: a Big Buck Bunny audio extraction or a CC-BY-licensed test track URL — planner picks the URL during Wave 0)
- [ ] `src/modules/server/scheduler/PlaylistScheduler.test.ts` — extend with D-06 lock-spans-handler-chain test (file exists, add a `describe` block)

## Security Domain

> `security_enforcement` not explicitly set in `.planning/config.json`; treat as enabled per default policy.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-tenant self-hosted; no auth surface |
| V3 Session Management | no | No sessions |
| V4 Access Control | no | No multi-user model |
| V5 Input Validation | yes | Zod schemas for the match-settings JSON; URL validation on YouTube watch URL constructed from videoId; sanitization of artist/title for filenames + ytsearch query |
| V6 Cryptography | no | No crypto operations new to this phase |
| V7 Error Handling & Logging | yes | Structured Pino logging with scoped loggers; `failure_reason` truncation to 500 chars to avoid log-flood DOS |
| V12 Files & Resources | yes | File path construction must escape `..`; output paths must be absolute and rooted under `data/music/`; .part file cleanup |
| V14 Configuration | yes | YT_DLP_BIN + PATH fallback shape mirrors PYTHON_BIN; .env validation via `src/env.ts` |

### Known Threat Patterns for {Node + child_process + filesystem}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Command injection via shell=true + interpolated query string | Tampering / Elevation | argv-form spawn with `shell: false` (Node default); query string flows as a single argv element, never interpolated. Phase 2 SpotifyScraperBridge already follows this pattern (lines 12-15 comment block). |
| Path traversal in `outputPath` (e.g. artist=`../../../etc/passwd`) | Tampering | `path.resolve` against `MUSIC_ROOT`; verify resolved path `startsWith(MUSIC_ROOT)`; sanitize artist + title via `safeFilename` BEFORE joining. |
| Argument injection via title containing `--option=value` | Tampering | Argv-form spawn; the entire ytsearch1 string is one argv element. yt-dlp does not parse argv values for sub-options (verified by reading the `--print` doc). |
| Long stderr causing memory bloat | DoS | `failure_reason` capped at 500 chars (CONTEXT discretion suggests ~500); stderr buffer accumulated in memory but bounded by 30s timeout. Phase 2 sets the precedent at `STDERR_SLICE_LIMIT = 500`. |
| Cover-art SSRF via Spotify CDN URL hijack | Information Disclosure | Cover-art URL comes from spotifyscraper which validated against Spotify hostnames at scrape time. Phase 3 fetches without re-validating — acceptable for v1 because the only source is the Spotify scraper and the URL is trusted. **Add a hostname allowlist in cover-art.ts as a defense-in-depth: only `*.scdn.co`, `*.spotifycdn.com`** — recommended but not required. |
| ZIP-slip-style filename collision | Tampering | Sanitization handles `/` and `\`; unique filename per track (`<artist> - <title>`). Two tracks with identical sanitized names overwrite — accepted v1 behavior; could detect in Phase 5 by appending `[<spotify_track_id>]` suffix. |
| ffmpeg unavailability → mass-fail surface | DoS | Pre-flight check at `DownloadRunner.run` start (Pitfall #3); fail fast with clear `summary.failure_reason='ffmpeg_missing'`. |

## Project Constraints (from CLAUDE.md)

The following directives from `./CLAUDE.md` shape Phase 3 implementation. Plans MUST honor these; the plan-checker will verify compliance.

- **Module structure:** Server-only code under `src/modules/server/`; never import server code into client bundles. Phase 3's downloader module lives at `src/modules/server/downloader/`.
- **Path alias:** Use `~/` for cross-module imports (`~/logger`, `~/env`, `~/modules/server/db`).
- **Logger:** Module-scoped: `Logger.get("DownloadRunner")`, `Logger.get("YtDlpBridge")`, `Logger.get("Tagger")`. Pass structured object first, message second: `logger.info({ trackId }, "matched")`.
- **Server functions:** `createServerFn` + Zod `.inputValidator()`. (Phase 3 may not need new server fns; manual Sync-now uses Phase 2's existing path.)
- **EventBus:** Use `getEventBus()` singleton; `bus.on(eventType, handler)` returns unsubscribe. Subscribe + return unsubscribe per `registerXxxHandler` pattern.
- **Generated files:** Never edit `src/routeTree.gen.ts`, `styled-system/**`, `drizzle/<n>.sql` directly — regenerate via `pnpm db:generate`.
- **Testing:** Vitest, co-located as `<name>.test.ts`. After schema changes: `pnpm db:generate` then `pnpm db:push`.
- **Functional Solid components only** (no Phase 3 client work expected).
- **Biome:** tabs, double quotes, trailing commas, block statements (`if (cond) { ... }` not `if (cond) ...`).
- **TypeScript:** strict; `verbatimModuleSyntax` requires explicit `import type {...}`.
- **Spike findings:** read SKILL.md and the album-source artist fallback rule (irrelevant to Phase 3 — Phase 3 only handles playlist sources where `artists[0].name` already populates correctly per Phase 2).

## Sources

### Primary (HIGH confidence)
- **Context7** `/yt-dlp/yt-dlp` — output templates, error handling, --print + --skip-download semantics, audio-format flags, ytsearchN prefix
- **Context7** `/zazama/node-id3` — read/write/update API, image object form with `imageBuffer`, supported tag fields list
- **Context7** `/sindresorhus/p-limit` — basic usage with `pLimit(n)`, ESM import shape
- **Codebase reads (verified line by line):**
  - `src/modules/server/scraper/SpotifyScraperBridge.ts` (lines 1-136) — argv-form spawn pattern + envelope synthesis
  - `src/modules/server/scraper/SyncRunner.ts` (lines 86-219) — emit/finalize lifecycle pattern
  - `src/modules/server/scraper/repository.ts` — Drizzle upsert + transaction pattern
  - `src/modules/server/events/EventBus.ts` (line 177 critical) — `await Promise.allSettled(promises)` confirms handler-await semantics
  - `src/modules/server/scheduler/PlaylistScheduler.ts` (lines 84-106) — runningPlaylists guard wrapping syncRunner.run
  - `src/modules/server/db/schema.ts` (line 60-98) — current tracks shape; lines 109-128 invocations shape
  - `src/modules/server/webhooks/repository.ts` (lines 17-60) — global_settings JSON-row pattern
  - `src/modules/server/events/schema.ts` — PlaylistSyncCompletedEventSchema with sourceId
  - `Dockerfile` line 38 + `Dockerfile.dev` line 6 — ffmpeg already installed
  - `package.json` — confirms `"type": "module"`, ESM-native; node-id3/p-limit/slugify NOT yet present
  - `.gitignore` line 14 — `data` already excluded; covers `data/music/`
- **npm registry** (`npm view`) — verified versions and dependencies for node-id3 (0.2.9), p-limit (7.3.0, ESM-only, `engines.node: ">=20"`, single dep `yocto-queue`), slugify (1.6.9)
- **PyPI** — yt-dlp 2026.3.17 latest stable [VERIFIED via WebSearch]

### Secondary (MEDIUM confidence)
- **WebFetch** on github.com/yt-dlp/yt-dlp/issues/8033 — confirms yt-dlp ytsearch zero-results behavior (clean exit, "Downloading 0 items")
- **WebFetch** on Debian manpage trixie/yt-dlp.1 — confirms `--print` template flag, `-q`, `--no-warnings`, `--no-playlist` semantics
- **WebFetch** on yt-dlp README — confirms `--paths` ignored when `-o` is absolute path; ffmpeg "strongly recommended"

### Tertiary (LOW confidence)
- **WebSearch** about yt-dlp `.part` files — confirmed via search results that yt-dlp uses `.part` extension during download and atomic-renames on success. Not verified against source code; reasonable certainty given consistency across multiple unrelated forum/issue posts.
- **WebSearch** about yt-dlp exit codes — issue #4262 confirms there is **no formal documentation** of exit codes; standard convention (0=ok, non-zero=error) is the only safe assumption. The DownloadRunner should treat non-zero as `download_error` generically.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version and behavior verified via npm + Context7 + codebase reads
- Architecture: HIGH — Phase 2 patterns are the template; D-06 lock semantics verified by reading EventBus.ts source
- Pitfalls: MEDIUM — most are documented (ffmpeg, sanitization, ALTER TABLE), one (yt-dlp empty-stdout no_results) is from a single GitHub issue thread that strongly matches the documented behavior
- Validation Architecture: HIGH — Vitest patterns mirror Phase 2's already-passing tests; gated-integration convention is established

**Research date:** 2026-04-25
**Valid until:** 2026-05-25 (30 days — yt-dlp moves fast on PyPI but the CLI surface we use is stable)
