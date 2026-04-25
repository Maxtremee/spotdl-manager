# Phase 3: Match + download slice (end-to-end MP3) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-25
**Phase:** 03-match-download-slice-end-to-end-mp3
**Areas discussed:** Pipeline shape, yt-dlp invocation, Tagging strategy

---

## Pipeline shape

### Q1: Where does match+download run relative to the existing scrape?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline in SyncRunner (Recommended) | Same invocation: scrape → loop pending tracks → match+download → finish. One user-visible run; trade-off 100-track run blocks 15–30 min before terminal event | |
| Separate DownloadRunner via event | SyncRunner emits `playlist.sync.completed` after scrape; new handler kicks DownloadRunner in its own invocation row. Decouples scrape (fast) from download (slow); two terminal events per sync | ✓ |
| Cron worker drains pending | Match+download is a separate scheduled task scanning `tracks` for pending/matched rows across all sources. Strongest decoupling, most moving parts | |

**User's choice:** Separate DownloadRunner via event
**Notes:** User explicitly chose split runner over inline despite the "more rows + lock complexity" trade-off. Reasoning per the live discussion: isolates failure surfaces, gives Phase 5 UI two natural rows per sync, matches "scrape fast / download slow" reality.

---

### Q2: Per-track state flow inside the run?

| Option | Description | Selected |
|--------|-------------|----------|
| pending → matched → downloaded (Recommended) | After ytsearch1 + duration check passes: write yt_video_id + state=matched. After file lands: state=downloaded. Crash-safe resume per MATCH-04 | ✓ |
| pending → downloaded (skip matched) | yt_video_id written at the same moment as the file. Simpler but a download crash leaves the row in an ambiguous state | |

**User's choice:** pending → matched → downloaded
**Notes:** Recommended option taken. Keeps the locked-enum `matched` value in active use, supports MATCH-04 retry-without-research semantics.

---

### Q3: If a track download fails, what happens to the invocation?

| Option | Description | Selected |
|--------|-------------|----------|
| Continue, mark track failed (Recommended) | Per-track failure recorded; invocation finishes `success`; summary JSON carries counters | ✓ |
| Abort entire sync on first track failure | First yt-dlp non-zero kills the run | |
| Continue, but invocation = `failed` if any track failed | Run all tracks but flip status to failed on any per-track fail | |

**User's choice:** Continue, mark track failed

---

### Q4: What does the manual 'Sync now' button do in Phase 3?

| Option | Description | Selected |
|--------|-------------|----------|
| Full pipeline scrape + match + download (Recommended) | Same code path as scheduler; UI may need a progress affordance (Claude's discretion / Phase 5) | ✓ |
| Scrape only | Manual button only refreshes metadata; match+download stays scheduled-only | |

**User's choice:** Full pipeline scrape + match + download

---

### Q5: Invocation row shape with the split runner?

| Option | Description | Selected |
|--------|-------------|----------|
| Two invocation rows per sync (Recommended) | Scrape writes one row, DownloadRunner writes a second. Requires `kind` column or summary marker | ✓ |
| One invocation, updated by both runners | Scrape opens, DownloadRunner appends and finalizes | |
| DownloadRunner writes per-track 'mini-invocations' | One row per track download attempt | |

**User's choice:** Two invocation rows per sync

---

### Q6: Concurrency guard for the source: who holds it?

| Option | Description | Selected |
|--------|-------------|----------|
| Held across scrape + download (Recommended) | runningPlaylists Set takes the source on scrape start, releases only when DownloadRunner terminates. 30-min download blocks new triggers; acceptable for v1 | ✓ |
| Released after scrape, re-taken by DownloadRunner | Two short locks. Risk: scheduler tick between them races on same `tracks` rows | |
| Two separate Sets (sourcesScraping / sourcesDownloading) | Independent locks per phase. Most flexibility, most coordination logic | |

**User's choice:** Held across scrape + download

---

### Q7: DownloadRunner trigger fan-out within a source?

| Option | Description | Selected |
|--------|-------------|----------|
| Process all pending+matched of that source (Recommended) | Event handler reads all `state in (pending, matched)` rows for the source and runs parallel-N over them | ✓ |
| Only tracks scraped in this run | Diff against scrape result; only download new upserts. Skips Phase-5 auto-retry | |
| Pending only — not skipped/failed | Process `state=pending` only. Simpler but doesn't satisfy TRACK-05 intent | |

**User's choice:** Process all pending+matched of that source
**Notes:** Phase 3 explicitly does NOT process `failed` or `skipped_low_confidence`. Phase 5 (TRACK-05) extends the trigger or adds a parallel auto-retry trigger.

---

## yt-dlp invocation

### Q1: How does yt-dlp get invoked: probe first or download directly?

| Option | Description | Selected |
|--------|-------------|----------|
| Probe-then-download (Recommended) | Call 1: `yt-dlp --print 'id\|duration' --skip-download ytsearch1:'<artist> <title>'`. Apply ±3s gate. If pass: call 2 downloads by video_id. Rejects never download bytes | ✓ |
| Single-call download then verify | One spawn does search + download with post-hoc duration check; delete file on reject. Wastes bandwidth on rejects | |
| Probe with `-J` JSON dump | First call dumps full JSON metadata. Heavier than `--print`; useful for multi-candidate match (we don't need it) | |

**User's choice:** Probe-then-download

---

### Q2: Where does the yt-dlp spawn live: Node or Python?

| Option | Description | Selected |
|--------|-------------|----------|
| Node child_process.spawn directly (Recommended) | New `YtDlpBridge` class in `src/modules/server/downloader/` mirrors `SpotifyScraperBridge` shape. Keeps Python only for spotifyscraper | ✓ |
| Extend scraper.py to wrap yt-dlp | Reuse existing Python venv: import `yt_dlp` Python module. One Python surface; bigger module + parallel-N coordination harder | |
| Separate Python downloader subprocess | New `scraper/downloader.py` calls `yt_dlp` Python API. Same bridge pattern; second Python entrypoint to maintain | |

**User's choice:** Node child_process.spawn directly

---

### Q3: yt-dlp binary discovery + version pinning?

| Option | Description | Selected |
|--------|-------------|----------|
| `YT_DLP_BIN` env var, PATH fallback (Recommended) | Mirrors `PYTHON_BIN` pattern from Phase 2. Default to `yt-dlp` from PATH; env var overrides for Docker | ✓ |
| Pip-install yt-dlp into the existing scraper venv | Add to scraper/requirements.txt. Couples versioning to the venv | |
| Bundled binary in the image, no env override | Dockerfile downloads pinned release. Smallest misconfig surface, least dev flexibility | |

**User's choice:** `YT_DLP_BIN` env var, PATH fallback

---

### Q4: Concurrency pool implementation?

| Option | Description | Selected |
|--------|-------------|----------|
| p-limit library (Recommended) | Battle-tested; pool size from `global_settings.match.parallel` per-run; tiny dep with no transitive deps | ✓ |
| Hand-rolled Promise pool | Internal helper; no new dep but reinvents a solved problem | |
| Per-source semaphore + cross-source cap | Two layers; premature for single-user scale | |

**User's choice:** p-limit library

---

## Tagging strategy

### Q1: How are ID3 tags applied?

| Option | Description | Selected |
|--------|-------------|----------|
| node-id3 post-step (Recommended) | yt-dlp writes clean MP3 (no `--add-metadata`/`--embed-thumbnail`); Node applies Spotify TIT2/TPE1/TALB/APIC via node-id3 | ✓ |
| yt-dlp postprocessors with --parse-metadata | Single spawn does everything via flag plumbing; cover art needs separate fetch+pass-in | |
| Direct ffmpeg invocation post-yt-dlp | Most low-level control; extra spawn per track; reinvents node-id3 | |

**User's choice:** node-id3 post-step

---

### Q2: Album field source for ID3 TALB?

| Option | Description | Selected |
|--------|-------------|----------|
| source.name for both playlists + albums (Recommended) | Album sources: source.name IS the album. Playlist sources: source.name as album tag (e.g. "My Workout Mix"). Pragmatic; no schema change | |
| Add `album` column to tracks; populate via per-track refetch | Schema bump + 100 extra HTTP calls per playlist sync. Accurate but breaks single-request scrape | |
| Add `album` column; populate from album sources only, leave null for playlist tracks | Schema bump but no extra HTTP calls. Albums tag accurately; playlist tracks have no album tag | ✓ |
| No album tag | Skip TALB entirely. Cleanest "don't lie" position | |

**User's choice:** Add `album` column; populate from album sources only, leave null for playlist tracks
**Notes:** Phase 3 ships the column migration. Population for album sources comes in Phase 4 (when album scraping lands). Phase 3 reality: all tracks have `album = NULL` because no album sources scrape yet. TALB frame is omitted when album is null.

---

### Q3: Cover art handling: when is it fetched + embedded?

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch once per source per download batch, embed in every track (Recommended) | One HTTP call per sync; reused for every track's APIC | |
| Fetch per track | Re-download cover for each track. Wasteful (100 identical bytes) but no cache state | ✓ |
| Cache to disk under `data/music/<slug>/.cover.jpg` | Persist across runs; cache invalidation needed | |

**User's choice:** Fetch per track
**Notes:** User chose per-track despite the "wasteful" framing. Reasoning per the live discussion: each DownloadRunner work unit stays self-contained, no cross-track buffer state, no cache invalidation logic.

---

### Q4: Output write semantics on the filesystem?

| Option | Description | Selected |
|--------|-------------|----------|
| yt-dlp -o to final path; node-id3 in-place; skip if file exists (Recommended) | Direct write to final path; node-id3 mutates in place; idempotent re-runs (skip if exists). Phase 5 forced retry will handle delete-before-retry | ✓ |
| Write to temp, tag, atomic rename | Crash-safe but extra rename per track | |
| Always overwrite | Re-runs replace files. Phase 5 forced retry would need this anyway | |

**User's choice:** yt-dlp -o to final path; node-id3 in-place; skip if file exists

---

## Claude's Discretion

- Exact discriminator on `invocations` (column vs `summary` JSON marker)
- Filename + slug sanitization rule (slugify lib choice vs hand-rolled regex)
- yt-dlp version-pinning mechanism (apt vs pip-into-venv vs binary download)
- Search-term escaping for tricky titles (apostrophes, parens, unicode)
- Settings UI surface for the new `match` row (deferrable to Phase 5)
- Stderr tail length cap stored in `failure_reason`
- yt-dlp output template literal shape
- Error envelope shape for `YtDlpBridge` (error enum values)
- Where the cover-art HTTP fetch lives (utility module vs inline in DownloadRunner)
- `global_settings` key name for the match section
- Logger namespacing
- Test surface (mock bridge vs gated integration)

## Deferred Ideas

- Auto-retry of failed/skipped_low_confidence tracks on subsequent syncs (Phase 5 / TRACK-05)
- Per-track manual retry button + UI badges (Phase 5 / TRACK-03 + TRACK-04)
- Forced re-download for already-downloaded tracks (Phase 5 / TRACK-04)
- Per-track album refetch via spotifyscraper get_track_info (v2)
- Match-review UI for ambiguous tracks (v2 / MATCH2-01)
- Reject-bad-terms list (v2 / MATCH2-02)
- yt-dlp cookies passthrough (v2 / YTAUTH2-01)
- User-configurable output-path templates (v2 / LAY2-01)
- Atomic temp-file + rename write semantics
- Cross-source download pool / global concurrency cap
- Cover-art on-disk cache
- Discord webhook payload extension for download summary
