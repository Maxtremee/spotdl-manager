---
phase: 3
slug: match-download-slice-end-to-end-mp3
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-25
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 1.x (already configured in repo) |
| **Config file** | `vite.config.ts` (Vitest config inline) |
| **Quick run command** | `pnpm test` |
| **Full suite command** | `pnpm test && DOWNLOADER_INTEGRATION=1 pnpm test` (gated integration on opt-in) |
| **Estimated runtime** | ~5–10 seconds (mocked unit tier); +30–60s for gated integration |

---

## Sampling Rate

- **After every task commit:** Run `pnpm test`
- **After every plan wave:** Run `pnpm test` (full default suite)
- **Before `/gsd-verify-work`:** Full default suite must be green; manual smoke (Success Criterion 5) recorded as HUMAN-UAT
- **Max feedback latency:** 10 seconds for unit tier

---

## Per-Task Verification Map

> Filled in during planning when each task lands. Tasks should map 1:1 to a co-located `<file>.test.ts` (Phase 2 convention) or the gated integration test where real subprocess work is exercised.

| Task ID | Plan | Wave | Requirement | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|-----------|-------------------|-------------|--------|
| TBD | TBD | TBD | MATCH-01..04, DOWNLOAD-01..05 | TBD | `pnpm test` | TBD | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/modules/server/downloader/YtDlpBridge.test.ts` — mocked-spawn unit tests for probe + download envelopes; exit-code mapping; **`stdout === ""` → `no_results` synthesis** (yt-dlp gh#8033 gotcha)
- [ ] `src/modules/server/downloader/tagger.test.ts` — node-id3 wrapper with fixture MP3 + APIC Buffer (TIT2/TPE1/TALB/APIC); TALB omission when album=null
- [ ] `src/modules/server/downloader/DownloadRunner.test.ts` — state-machine transitions (pending → matched → downloaded; pending → skipped_low_confidence; pending → failed); tolerance read from snapshot; per-track failure isolation; existing-file skip path
- [ ] `src/modules/server/downloader/repository.test.ts` — track-row writes (state, yt_video_id, download_path, failure_reason); never-touches-other-fields contract
- [ ] `src/modules/server/downloader/integration.test.ts` — gated `DOWNLOADER_INTEGRATION=1` real yt-dlp + ffmpeg against a known-good public-domain track; produces a tagged MP3 on disk
- [ ] Slug helper unit tests if a new module lands (`src/modules/server/downloader/slug.test.ts` or co-located with whichever module hosts it)
- [ ] Drizzle migration sanity: `pnpm db:generate` + `pnpm db:push` on a fresh DB applies cleanly; existing fixtures still load (covered in `src/modules/server/db/` tests if they exist; otherwise spot-check during the schema task)

*If none: "Existing infrastructure covers all phase requirements."* — Vitest already in place; Phase 3 only adds new test files.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| End-to-end: real Spotify playlist URL ends with at least one tagged MP3 on disk | Success Criterion 5 (ROADMAP.md Phase 3) | Requires real network access to YouTube + ffmpeg in the runtime; gated integration test covers a known-good track but the full sync path is best validated by a human run | 1) `pnpm docker:dev` 2) Add a 5–10 track public Spotify playlist source in the UI 3) Click Sync now 4) Wait for `playlist.sync.completed` then `playlist.download.completed` 5) Verify `data/music/<slug>/*.mp3` exists with embedded TIT2/TPE1/APIC (use `ffprobe` or a player) |
| Discord webhook fires with download summary | DOWNLOAD-04/05 surfacing | Webhook delivery + Discord rendering can't be reliably automated in CI; manual Discord channel check | 1) Configure a Discord webhook in settings 2) Trigger a sync 3) Confirm download-completed message arrives with track counters and (for failures) sanitized stderr tail |
| User-adjusts tolerance + parallel from settings UI (if surface ships in Phase 3) | DOWNLOAD-04, MATCH-02 | Form interaction; Phase 5 may absorb this if Phase 3 ships server-only defaults | Open settings → adjust → save → confirm next sync uses new values |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
