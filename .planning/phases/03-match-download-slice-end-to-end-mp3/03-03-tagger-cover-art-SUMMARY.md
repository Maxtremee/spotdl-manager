---
phase: 03-match-download-slice-end-to-end-mp3
plan: "03"
subsystem: downloader
tags: [tagger, cover-art, node-id3, id3v2, ssrf, security, tdd]
dependency_graph:
  requires:
    - 03-01 (node-id3@0.2.9 installed; downloader/ directory established)
  provides:
    - src/modules/server/downloader/tagger.ts (embedTags function — ID3v2 writer)
    - src/modules/server/downloader/cover-art.ts (fetchCoverArt function — HTTPS-only fetcher)
    - src/modules/server/downloader/fixtures/silence.mp3 (tagger test fixture)
  affects:
    - Plan 03-04 (DownloadRunner imports ./tagger and ./cover-art via relative paths)
tech_stack:
  added: []
  patterns:
    - TDD RED/GREEN cycle — per-plan test-first with fixture-driven tagger tests
    - Module-scope Logger singleton (Logger.get("Tagger"), Logger.get("CoverArtFetcher"))
    - vi.stubGlobal("fetch") pattern for hermetic cover-art HTTP mocking
    - node-id3 object-form APIC (Pitfall #9: imageBuffer not filepath string)
    - node-id3 sync API return-value check (Pitfall #10: true|Error, never throws)
    - AbortSignal.timeout(10_000) for fetch cancellation (Node 22 global)
    - SSRF mitigation: protocol whitelist (https: only), MIME allowlist, 5MB size cap
key_files:
  created:
    - src/modules/server/downloader/tagger.ts
    - src/modules/server/downloader/tagger.test.ts
    - src/modules/server/downloader/cover-art.ts
    - src/modules/server/downloader/cover-art.test.ts
    - src/modules/server/downloader/fixtures/silence.mp3
  modified: []
decisions:
  - "APIC object form with imageBuffer used (not filepath string) per Pitfall #9 — bare string form silently produces empty APIC"
  - "node-id3 sync API return value always checked: true success, Error throw, anything-else throw (Pitfall #10)"
  - "cover-art uses post-read byteLength size cap (not Content-Length pre-check) — safer since CDNs omit Content-Length"
  - "noopLog injected in cover-art tests to silence output and assert warn call count directly"
  - "TALB frame omitted for undefined/null album; APIC frame omitted for undefined/null coverArt (D-13, D-14)"
metrics:
  duration: "~15 minutes"
  completed: "2026-04-25"
  tasks_completed: 3
  files_created: 5
  tests_added: 22
---

# Phase 03 Plan 03: Tagger + Cover-Art Utility Modules Summary

ID3v2 tagger (node-id3 wrapper) and HTTPS-only cover-art fetcher — pure utility functions consumed by DownloadRunner in Plan 03-04 to embed Spotify-sourced tags into yt-dlp-produced MP3 files.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Create silence.mp3 fixture | adc4a26 | src/modules/server/downloader/fixtures/silence.mp3 |
| 2 (RED) | Failing tagger tests | 53c3b0f | tagger.test.ts |
| 2 (GREEN) | Implement tagger.ts | 1459da3 | tagger.ts, tagger.test.ts (formatted) |
| 3 (RED) | Failing cover-art tests | 5641eea | cover-art.test.ts |
| 3 (GREEN) | Implement cover-art.ts | bc7bd6f | cover-art.ts, cover-art.test.ts (formatted) |

## What Was Built

### tagger.ts — `embedTags(filepath, TagInput): void`

node-id3 sync API wrapper. Writes four ID3v2 frames from Spotify-sourced data:

- **TIT2** (title) — always written
- **TPE1** (artist) — always written
- **TALB** (album) — written only when `album` is a non-empty string; omitted when `null` or `undefined` (D-13: no per-track album refetch for playlist sources in v1)
- **APIC** (cover) — written only when `coverArt` is non-null with a non-empty buffer (D-14: best-effort, silent skip)

Key correctness properties:
- Uses the **object form** for APIC with `imageBuffer: Buffer` (Pitfall #9 — the filepath-string form silently produces an empty frame)
- Checks node-id3 sync return value: `true` → success; `instanceof Error` → rethrow; anything else → throw new Error (Pitfall #10 — sync API never throws, always returns)
- 9 tests verify all frame behaviors, omit-when-null branches, error throw, and idempotence

### cover-art.ts — `fetchCoverArt(url, log?): Promise<CoverArt | null>`

HTTPS-only cover-art HTTP fetcher. Implements T-3-04 (SSRF) and T-3-15 (DoS) mitigations:

1. **Null/empty URL guard** — returns null immediately, fetch never called
2. **Protocol whitelist** (T-3-04) — only `https:` accepted; `http:`, `file:`, `data:`, `ftp:` and invalid URLs all return null with a warn log and no fetch call
3. **MIME allowlist** — only `image/jpeg` and `image/png` accepted; other content-types return null
4. **5MB size cap** (T-3-15) — post-`arrayBuffer()` byteLength check; rejects oversized responses
5. **10s timeout** — `AbortSignal.timeout(10_000)` on every fetch call
6. **Never throws** (Pitfall #8) — all errors caught; track continues with no APIC frame

13 tests verify happy paths, all 3 SSRF protocol guards (http, file, data), size cap, MIME guard, network error, AbortError, and invalid URL string.

## Test Results

```
src/modules/server/downloader/tagger.test.ts  — 9/9 passed
src/modules/server/downloader/cover-art.test.ts — 13/13 passed
src/modules/server/downloader/slug.test.ts    — 15/15 passed (pre-existing)
Total: 37 tests passing in downloader/
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixture path resolved from wrong working directory**

- **Found during:** Task 2 (GREEN phase, first run)
- **Issue:** `path.resolve("src/modules/server/downloader/fixtures/silence.mp3")` resolves from the main repo root (`/spotdl-manager/src/...`) but the fixture lives at `.claude/worktrees/agent-.../src/...`
- **Fix:** Replaced with `path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "silence.mp3")` — resolves relative to the test file at runtime, worktree-safe
- **Files modified:** tagger.test.ts
- **Commit:** 1459da3

## Threat Flags

None — T-3-04, T-3-15, T-3-16 threats all mitigated as planned. No new network surfaces introduced beyond what the plan specified.

## Known Stubs

None — both modules are fully wired and functional. `embedTags` and `fetchCoverArt` are production-ready pure functions requiring no further implementation. Plan 03-04 (DownloadRunner) will wire them into the download pipeline.

## Self-Check: PASSED

All created files verified present on disk. All 5 task commits verified in git log (adc4a26, 53c3b0f, 1459da3, 5641eea, bc7bd6f). 22 tests (9 tagger + 13 cover-art) all passing.
