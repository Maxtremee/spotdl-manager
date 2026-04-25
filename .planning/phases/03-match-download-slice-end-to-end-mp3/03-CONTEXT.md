# Phase 3: Match + download slice (end-to-end MP3) - Context

**Gathered:** 2026-04-25
**Status:** Ready for planning

<domain>
## Phase Boundary

Pending track rows produced by Phase 2 are resolved on YouTube via `yt-dlp ytsearch1:"<artist> <title>"` under the strict ±3s duration gate, downloaded as MP3, tagged with Spotify-sourced ID3 frames, and persisted to `data/music/<source-slug>/<artist> - <title>.mp3`. This is the first phase where the app does its job end-to-end. Album scraping (with its own track upserts) is Phase 4. Per-track UI badges + manual retry buttons are Phase 5. Auto-retry of `failed`/`skipped_low_confidence` rows on subsequent syncs is Phase 5.

</domain>

<decisions>
## Implementation Decisions

### Pipeline shape — split runner via event

- **D-01:** A new **`DownloadRunner`** runs match+download. It is **not** inline in `SyncRunner`. The existing `SyncRunner` (Phase 2) keeps emitting `playlist.sync.completed` after a successful scrape; a new event handler subscribes to that event and kicks `DownloadRunner` for the same source. The handler lives next to other event handlers (`src/modules/server/events/handlers.ts` or a sibling file) and is registered in the events Nitro plugin.
- **D-02:** Per-track state flow is **`pending → matched → downloaded`**. After `ytsearch1` + duration gate passes, `yt_video_id` is persisted and `state=matched` BEFORE the download starts. After the file lands and is tagged, `state=downloaded`. If a later step crashes, the row stays at `matched` and a future retry skips re-search (MATCH-04 semantics).
- **D-03:** A track-level download failure **does not abort the run**. Per-track failure is recorded on the track row (`state=failed` with exit code + stderr tail in `failure_reason`); the `DownloadRunner` invocation finishes with `status=success` and a `summary` JSON that carries counters (`total`, `downloaded`, `matched_only`, `skipped_low_confidence`, `failed`). The scrape invocation status is not affected.
- **D-04:** **Manual "Sync now" button triggers the full pipeline.** It calls the existing `SyncRunner` server function unchanged — the `playlist.sync.completed` handler does the rest. No separate manual "download only" affordance in Phase 3. UI progress affordance for long runs is Claude's discretion / Phase 5 territory.
- **D-05:** **Two invocation rows per sync.** The scrape writes one row (Phase 2 contract, summary carries `trackCount` + `truncationSuspected`). `DownloadRunner` writes a second row keyed to the same source with download counters in its `summary`. The `invocations` table gains a discriminator so consumers can tell them apart — implementation choice between a new `kind` column (e.g. `enum('scrape', 'download')`) and a `summary.kind` JSON marker is **Claude's discretion**, but a column is preferred for index-friendly queries (Phase 5 UI will filter).
- **D-06:** **Concurrency lock spans both phases.** `PlaylistScheduler.runningPlaylists` (the existing `Set<sourceId>`) is taken when scrape starts and released only after `DownloadRunner` terminates (success, fail, or no-op when zero pending+matched rows exist). The lock survives the scrape→download handoff. Implication: the scheduler / manual button cannot fire a second pipeline on the same source while a download is mid-flight, even on a 30-min batch. Acceptable trade-off for v1.
- **D-07:** `DownloadRunner` reads **all `state IN ('pending', 'matched')`** rows for the source and runs the parallel-N pool over them. It does **not** retry `failed` or `skipped_low_confidence` rows in Phase 3 — TRACK-05 auto-retry is Phase 5 and will extend the row selection (or add a separate trigger). `matched` is included so an interrupted prior run resumes without re-searching.

### yt-dlp invocation — Node spawn, two-call probe-then-download

- **D-08:** **Probe-then-download.** Call 1: `yt-dlp --print 'id|duration' --skip-download ytsearch1:'<artist> <title>'` returns video id + duration in seconds without media bytes. Apply ±N tolerance gate (default 3s, configurable per MATCH-02). Call 2 (only when probe passes): `yt-dlp -f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 -o '<path>' 'https://www.youtube.com/watch?v=<id>'`. Rejects never download bytes; accepted tracks pay one extra short spawn vs a single-call. Search-term escaping (apostrophes, parens, unicode in titles) is **Claude's discretion** — `argv[]` form spawn already handles literal strings safely, but query-string sanitization for the YouTube search itself may need a planner-level note.
- **D-09:** **`YtDlpBridge` runs in Node**, not Python. Lives at `src/modules/server/downloader/YtDlpBridge.ts` and mirrors the `SpotifyScraperBridge` shape (argv-form `child_process.spawn`, `shell: false`, structured stdout/stderr parsing, typed envelope/error). Python runtime stays exclusively for `spotifyscraper`. Concurrency coordination lives where it's easiest — Node.
- **D-10:** **`YT_DLP_BIN` env var, PATH fallback.** Mirrors Phase 2's `PYTHON_BIN` pattern. Default invocation shape is `'yt-dlp'` (resolved via `PATH`); `YT_DLP_BIN` overrides for Docker (e.g. `/usr/local/bin/yt-dlp`) or dev shells. The Dockerfile installs a pinned yt-dlp version — pinning mechanism (apt vs `pip install yt-dlp==X.Y.Z` into the existing scraper venv vs bundled binary download) is **Claude's discretion** during planning; planner should choose whichever keeps the image diff smallest while leaving room for periodic version bumps.
- **D-11:** **Concurrency via `p-limit`.** `DownloadRunner` constructs `pLimit(N)` per run, where N is read from `global_settings.match.parallel` (or equivalent settings key — Claude's discretion on key naming) at the start of the run. Changing the setting takes effect on the **next** sync, not mid-batch. p-limit is an existing-ecosystem dep with zero transitive deps. Per-source vs cross-source pool distinction is moot in single-user scope; the source-level lock (D-06) already prevents two downloads on the same source.

### Tagging — node-id3 post-step

- **D-12:** **Tagging is a separate Node step after yt-dlp produces a clean MP3.** yt-dlp writes the file with `--extract-audio --audio-format mp3 --audio-quality 0` and **without** `--add-metadata` / `--embed-thumbnail` — YouTube-derived metadata never enters the file. After the spawn returns success, Node opens the MP3 with `node-id3` and writes `TIT2` (title), `TPE1` (artist), `TALB` (album, when set; see D-13), and `APIC` (cover art, when available; see D-14). All values come from the Spotify scrape (`tracks.title`, `tracks.artist`, `tracks.album`, `source.cover_art_url`).
- **D-13:** **`tracks` table gains a nullable `album` column** (schema migration in this phase). Population rule:
    - **Album sources** (Phase 4 onwards): `album = source.name` at scrape time. Phase 3 lays the column groundwork; the actual album-source population logic ships in Phase 4.
    - **Playlist sources** (Phase 3 reality): `album` stays **`null`**. No per-track refetch via `get_track_info` — that would mean 100 extra HTTP calls per playlist sync, breaks the auth-free single-request scrape pattern, and the spike findings explicitly mark per-track album refetch as a v2 concern.
    - **TALB frame is omitted entirely when `album IS NULL`.** Players show no album grouping for playlist tracks — accepted v1 trade-off. Phase 5's UI doesn't need to display album either.
- **D-14:** **Cover art is fetched per track** from `source.cover_art_url` and embedded as the `APIC` frame. User explicitly chose per-track fetch over batch-fetch caching: keeps each `DownloadRunner` work unit self-contained with no cross-track state, no in-memory buffer to manage, no cache invalidation. Cost is N redundant HTTP calls per sync (~1–20KB image × 100 tracks); acceptable. If `source.cover_art_url IS NULL`, skip APIC silently — no error, no placeholder.
- **D-15:** **`yt-dlp -o` writes directly to the final path; node-id3 mutates in place; existing files are skipped.** No temp-file + atomic-rename in v1. yt-dlp writes `data/music/<source-slug>/<artist> - <title>.mp3`; on its own success, node-id3 opens that exact path and writes ID3v2 frames. Before issuing the probe call, `DownloadRunner` checks if the target path already exists for the track — if it does, the track transitions to `downloaded` without invoking yt-dlp at all (idempotent re-runs). This deliberately leaves "forced re-download" semantics to Phase 5's manual retry button (TRACK-04), which will need to delete the file before re-running. Source slug + filename sanitization rule is **Claude's discretion** — recommended baseline: lowercase, replace whitespace with `-`, strip filesystem-unsafe chars (`/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, `|`), normalize unicode; planner should pick a slug helper (e.g. `slugify` lib or hand-rolled) that's deterministic across runs.

### Settings / configuration

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

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level decisions
- `.planning/PROJECT.md` — Core value, key decisions table (yt-dlp ytsearch1 lockdown, ±3s sole gate, MP3+ID3, concurrency 3 default range 2–4, `data/music/<playlist>/` layout, no Spotify API)
- `.planning/REQUIREMENTS.md` — Phase 3 requirements MATCH-01..04 + DOWNLOAD-01..05; Out-of-Scope (no per-track album refetch, no format switching, no library hierarchy, no template path)
- `.planning/ROADMAP.md` §"Phase 3: Match + download slice (end-to-end MP3)" — Goal, depends-on (Phase 2), success criteria 1–5 (especially SC #1 ±3s gate semantics, SC #2 tagged MP3 layout, SC #4 yt-dlp failure shape)
- `.planning/STATE.md` — Phase 3 of 6; Phase 2 complete; current focus

### Prior phase decisions (carried forward)
- `.planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md` — Phase 1 D-09 locked the `state` enum (`pending | matched | downloaded | skipped_low_confidence | failed`); D-10 locked the unique key. Phase 3 schema migration ADDS the `album` column without touching either lock.
- `.planning/phases/02-spotify-metadata-spotifyscraper/02-CONTEXT.md` — Phase 2 D-01..D-04 (Python-bridge, stdin-JSON, scraper/ dir at repo root, Docker-only dev), D-05/D-06 (single SyncRunner = scheduler + manual button), D-07..D-09 (invocation row contract + typed failure taxonomy + atomic-on-fail), D-13..D-16 (full re-scrape upsert; never touches `state`/`yt_video_id`/`download_path`/`failure_reason`). Phase 3 extends the existing pattern; the Phase 2 contract for those preserved fields is the lock that lets `DownloadRunner` write to them safely while re-scrapes happen.

### Spike findings (MUST read — non-negotiable constraints carried into Phase 3)
- `.claude/skills/spike-findings-spotdl-manager/SKILL.md` — Index of spike-validated rules
- `.claude/skills/spike-findings-spotdl-manager/references/spotify-metadata-scraping.md` — Why `tracks.album` cannot be cheaply populated for playlist sources (per-track refetch = 100 HTTP calls); why album-source `artist` falls back to `album.artists[0].name`; the 100-cap that already shaped Phase 2 still applies to scrape but is irrelevant to Phase 3's match+download work
- `.planning/spikes/MANIFEST.md` — Spike verdicts (001 VALIDATED, 002 INVALIDATED → 100-cap accepted)

### Codebase maps (read before touching code)
- `.planning/codebase/ARCHITECTURE.md` — Module structure, client/server boundary
- `.planning/codebase/STRUCTURE.md` — File layout, where to add new server modules (`src/modules/server/downloader/` is the recommended new home — sibling to `scraper/`)
- `.planning/codebase/CONVENTIONS.md` — File naming (PascalCase for class-mapped files like `YtDlpBridge.ts`, `DownloadRunner.ts`; kebab-case for utilities)
- `.planning/codebase/STACK.md` — Tech stack; **note:** STACK.md was written pre-pivot — its `spotdl` references are obsolete; the schema/repository/event-bus/scheduler pattern claims are still current
- `.planning/codebase/INTEGRATIONS.md` — Event bus, Discord webhooks, scheduler wiring (Phase 3 adds a new event subscriber, not a new bus)
- `.planning/codebase/TESTING.md` — Vitest patterns; gated integration test convention (`SCRAPER_INTEGRATION=1` from Phase 2 — Phase 3 may add a parallel `DOWNLOADER_INTEGRATION=1` gate)

### Repo guide
- `CLAUDE.md` — Claude-facing project guide; commands; event-bus usage patterns; Logger singleton; `~/` path alias

### Files that will be touched (reference shape, not as specs)
- `src/modules/server/db/schema.ts` — Add nullable `album` column to `tracks`; consider adding `kind` column to `invocations` (D-05)
- `drizzle/<new>.sql` — Generated migration for the schema change
- `src/modules/server/scraper/SyncRunner.ts` — Unchanged in body; the `playlist.sync.completed` event it already emits is the new download trigger
- `src/modules/server/events/schema.ts` — `PlaylistSyncCompletedEventSchema` already exists from Phase 2; verify it carries the `sourceId` needed by the download handler (it does)
- `src/modules/server/events/handlers.ts` — New handler subscribed to `playlist.sync.completed` that instantiates `DownloadRunner.run(sourceId)`
- `server/plugins/events.ts` — Register the new handler in the Nitro plugin
- `src/modules/server/scheduler/PlaylistScheduler.ts` — `runningPlaylists` Set lifecycle extended: held until `DownloadRunner` terminates (D-06). Implementation choice: scheduler awaits the download promise before releasing, OR the download handler calls back to release. Planner picks
- `src/modules/server/invocation/repository.ts` — Insert+update flow extended to support the second (download-kind) row per sync; if a `kind` column lands, repository methods take it as input
- `src/modules/server/downloader/` (NEW) — `YtDlpBridge.ts`, `DownloadRunner.ts`, `repository.ts` (track-state writes for match+download), tests
- `src/modules/server/downloader/tagger.ts` (NEW) — node-id3 wrapper that takes (filepath, { title, artist, album?, coverArtBuffer? })
- `src/modules/server/db/seed.ts` — May need a default `match` row in `global_settings` (tolerance + parallel)
- `package.json` — Add `node-id3`, `p-limit` (verify versions; both lightweight; Biome should be happy)
- `Dockerfile` + `Dockerfile.dev` — Install `yt-dlp` + `ffmpeg` (+ pinning); set `YT_DLP_BIN` if needed
- `.gitignore` — Verify `data/music/` is already excluded (under `data/`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Event bus** (`src/modules/server/events/`): `playlist.sync.completed` already emitted by Phase 2's `SyncRunner` carries `sourceId` + `outputDir` + truncation flag. New handler subscribes — no schema changes to the event itself in Phase 3.
- **Invocation repository** (`src/modules/server/invocation/repository.ts`): Pattern for opening + finalizing a row already in place from Phase 2. `DownloadRunner` reuses this; only changes are (a) writing a `kind=download` discriminator and (b) the `summary` JSON shape.
- **`SpotifyScraperBridge`** (`src/modules/server/scraper/SpotifyScraperBridge.ts`): Direct shape template for `YtDlpBridge` — argv-form spawn, `shell: false`, typed envelope on stdout, structured error mapping, mockable in tests.
- **`SyncRunner`** (`src/modules/server/scraper/SyncRunner.ts`): Stays unchanged. Its emitted `playlist.sync.completed` is the seam Phase 3 plugs into.
- **`PlaylistScheduler.runningPlaylists`**: Existing `Set<sourceId>` lock; Phase 3 extends its lifetime, doesn't replace it.
- **`Logger.get("...")`**: Use `Logger.get("DownloadRunner")`, `Logger.get("YtDlpBridge")`, `Logger.get("Tagger")` for namespaced logs (Phase 2 pattern).
- **Drizzle schema single-file convention**: Add `album` column + optional `kind` column without breaking the file's structure.
- **Vitest gated-integration pattern**: `SCRAPER_INTEGRATION=1` from Phase 2 sets the precedent; Phase 3 may add `DOWNLOADER_INTEGRATION=1` to gate real yt-dlp + ffmpeg invocations behind explicit opt-in.

### Established Patterns
- **Bridge architecture** (Phase 2 D-01..D-03): Node ↔ external-binary IPC via argv-form spawn + JSON envelope. `YtDlpBridge` mirrors but doesn't share code — different binary, different argv shape, different stdout format.
- **Atomic-on-failure invocation rows** (Phase 2 D-08): If scrape fails, no `tracks` rows are written. Phase 3 inverts: track-level failures are isolated, the `DownloadRunner` invocation finishes `success` so long as the runner itself didn't crash. The two semantics coexist because they describe different runners.
- **Typed failure taxonomy** (Phase 2 D-09): Phase 3 introduces a parallel taxonomy for download failures (`exit_code: <N>; <stderr-tail>` in `failure_reason`); planner picks exact enum values for the bridge's error envelope.
- **`createServerFn` + Zod `.inputValidator()`**: No new server functions strictly required for Phase 3 — manual Sync-now uses the existing path. If settings UI lands in Phase 3 (Claude's discretion), the `match` settings get a server-fn pair like `getMatchSettingsServerFn` / `updateMatchSettingsServerFn`.
- **Drizzle upsert via `onConflictDoUpdate`** (Phase 2 D-14): Track-row updates from `DownloadRunner` are simple `UPDATE WHERE id = ?` calls; no upsert needed (the rows already exist from scrape).

### Integration Points
- **`playlist.sync.completed` handler** (`src/modules/server/events/handlers.ts`): New subscriber instantiates `DownloadRunner` and awaits `.run(sourceId)`. Must NOT block the event bus — fire-and-await is fine because the bus calls handlers in sequence per event; planner should verify the bus's handler-await semantics in `EventBus.ts` before relying on this.
- **`PlaylistScheduler.executePlaylistSync`** (`src/modules/server/scheduler/PlaylistScheduler.ts`): Extends the lock-release point. Currently releases when scrape finishes; new behavior: wait for the `playlist.sync.completed` handler chain to settle before releasing. Implementation: scheduler awaits a returned promise from the bus, OR `DownloadRunner` notifies via a release callback. Planner picks.
- **`tracks` table writes** (`src/modules/server/downloader/repository.ts` NEW): Selects `state IN ('pending', 'matched')` for a sourceId, updates `state` / `yt_video_id` / `download_path` / `failure_reason` as the pipeline progresses. No ordering guarantees needed — p-limit handles fairness.
- **`global_settings` reads**: `DownloadRunner` reads the `match` row at start and snapshots `tolerance_seconds` + `parallel` for the duration of the run. Mid-run setting changes do not apply.
- **Filesystem**: `data/music/<source-slug>/` directory created lazily (`fs.mkdir({ recursive: true })`) before the first track of that source downloads. Slug derivation is at write time, not stored on `sources` (no schema change).
- **Manual Sync-now button** (Phase 2 D-06): Already wired to `SyncRunner`. Phase 3 needs **zero** UI changes for this to work end-to-end — the user clicks, scrape runs, event fires, download runs.

</code_context>

<specifics>
## Specific Ideas

- **Split runner via event was a deliberate user choice over inline.** The trade-off ("inline = simpler, split = more rows + lock complexity") was explicit. User picked split because it isolates failure surfaces (a download crash doesn't pollute scrape's invocation status), gives Phase 5's UI two natural rows to display per sync, and matches the "scrape is fast, download is slow" reality. Planner should not collapse this back to inline as a "simplification."
- **Per-track cover-art fetch was deliberately chosen over batch-cache.** User saw the "100 redundant HTTP calls" cost and accepted it for code-shape reasons (each `DownloadRunner` work unit is independent; no cross-track buffer state). Don't optimize this without re-asking.
- **`album = null` for playlist tracks is the v1 reality, not a bug.** TALB frame omitted; players show no album grouping. Per-track refetch via `get_track_info` is explicitly v2. Don't add it.
- **Lock spans both phases — `runningPlaylists` released only after download terminates.** A user clicking Sync-now during a 25-minute download won't be able to retrigger that source. This is correct, not a flaw. Phase 5's per-track manual retry button is the affordance for "I want this one track re-downloaded now."
- **yt-dlp probe-then-download is bandwidth-conscious.** A skipped track never touches disk. With strict ±3s gates, skip rate could be non-trivial — saving the bytes is worth the second spawn per accepted track.

</specifics>

<deferred>
## Deferred Ideas

- **Auto-retry of `failed` / `skipped_low_confidence` tracks on subsequent syncs** — explicitly Phase 5 (TRACK-05). Phase 3's `DownloadRunner` only processes `pending` + `matched` rows. Phase 5 will extend the row selection or add a separate retry trigger.
- **Per-track manual retry button + UI badges** — Phase 5 (TRACK-03, TRACK-04). Phase 3 ships zero per-track UI.
- **Forced re-download for already-downloaded tracks** — Phase 5 (TRACK-04). Phase 3 skips re-downloading if the file already exists at the target path.
- **Per-track album from spotifyscraper `get_track_info` refetch** — explicit v2 (FMT2/META2). Cost is 100 extra HTTP calls per playlist sync; rejected for v1.
- **Match-review UI for ambiguous low-confidence tracks** — explicit v2 (MATCH2-01). Strict ±3s gate + retry is the v1 answer.
- **Reject-bad-terms list (live/cover/remix) as a secondary gate** — explicit v2 (MATCH2-02).
- **yt-dlp cookies passthrough for age-gated content** — explicit v2 (YTAUTH2-01).
- **User-configurable output-path templates** — explicit v2 (LAY2-01). v1 ships `<artist> - <title>.mp3` only.
- **Atomic temp-file + rename write semantics** — rejected for v1 in favor of "yt-dlp writes final path; idempotent skip-if-exists." Revisit only if mid-write crashes prove problematic in practice.
- **Cross-source download pool / global concurrency cap** — single-user single-pipeline scope makes this moot. Per-source p-limit + source-level `runningPlaylists` lock is sufficient.
- **Settings UI for `match.tolerance_seconds` + `match.parallel`** — server-side defaults ship in Phase 3; UI surface deferrable to Phase 5 if desired (Claude's discretion).
- **Cover-art on-disk cache (`data/music/<slug>/.cover.jpg`)** — rejected; per-track fetch was the explicit choice.
- **Discord webhook payload extension for download summary** — not blocked but not specced; the new download-kind invocation row's `summary` will be available for the existing webhook handler. Whether to extend the handler in Phase 3 vs Phase 5 is Claude's discretion.

</deferred>

---

*Phase: 03-match-download-slice-end-to-end-mp3*
*Context gathered: 2026-04-25*
