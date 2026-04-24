---
phase: 2
slug: spotify-metadata-spotifyscraper
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-24
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `02-RESEARCH.md` §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.16 |
| **Config file** | none — uses Vitest defaults (`package.json` `"test": "vitest run"`) |
| **Quick run command** | `pnpm test -- <scope>` (filter by file name) |
| **Full suite command** | `pnpm test && pnpm typecheck && pnpm check` |
| **Estimated runtime** | ~10s quick / ~15s full (current repo) |

Tests co-located beside source (`<name>.test.ts`). Existing pattern examples: `src/modules/server/scheduler/PlaylistScheduler.test.ts`, `src/modules/server/events/EventBus.test.ts`, `src/modules/server/db/schema.test.ts`.

---

## Sampling Rate

- **After every task commit:** Run `pnpm test -- <scope>` (vitest filter by file name; <5s feedback)
- **After every plan wave:** Run `pnpm test && pnpm typecheck && pnpm check` (~10s full suite)
- **Before `/gsd-verify-work`:** Full suite must be green + one manual Docker run confirming scrape of a known-small public playlist (spike 001 URL)
- **Max feedback latency:** ~5 seconds per task, ~15 seconds per wave

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-XX-XX | scraper-py | 1 | — | — | N/A | build probe | `docker build . && docker run --rm spotdl-manager:test scraper/.venv/bin/python -c "import spotify_scraper"` | manual (documented in plan notes) | ⬜ pending |
| 2-XX-XX | bridge | 1 | — | T-2-01 (command injection), T-2-03 (DoS via timeout) | spawn with `shell: false`; 30s timeout | unit | `pnpm test -- SpotifyScraperBridge` | ❌ Wave 0 — `src/modules/server/scraper/SpotifyScraperBridge.test.ts` | ⬜ pending |
| 2-XX-XX | runner | 2 | SCRAPE-03, SCRAPE-04 | T-2-05 (traceback leak) | bridge accepts only envelope-shaped output; Zod-parse | unit | `pnpm test -- SyncRunner` | ❌ Wave 0 — `src/modules/server/scraper/SyncRunner.test.ts` | ⬜ pending |
| 2-XX-XX | runner | 2 | D-09 failure enum | T-2-05 | enum-only reasons on `.failed` event | unit | `pnpm test -- SyncRunner` | ❌ Wave 0 | ⬜ pending |
| 2-XX-XX | runner | 2 | D-10, D-11 truncation | — | `truncation_suspected` surfaces on summary + event payload when `len==100` | unit | `pnpm test -- SyncRunner` | ❌ Wave 0 | ⬜ pending |
| 2-XX-XX | runner | 2 | D-08 atomicity | — | DB error mid-scrape → no tracks rows written | unit | `pnpm test -- SyncRunner` | ❌ Wave 0 | ⬜ pending |
| 2-XX-XX | repo | 2 | SCRAPE-07, D-13, D-14, D-15 | — | upsert preserves `state`/`yt_video_id`/`download_path`/`failure_reason`; updates `position` | unit (in-memory SQLite) | `pnpm test -- scraper/repository` | ❌ Wave 0 — `src/modules/server/scraper/repository.test.ts` | ⬜ pending |
| 2-XX-XX | schema | 1 | SCRAPE-01 | T-2-04 (SSRF via URL) | hostname `open.spotify.com` + path `/playlist/` required | unit | `pnpm test -- create-playlist-form` | ❌ Wave 0 — `src/modules/client/playlist/schema/create-playlist-form.test.ts` | ⬜ pending |
| 2-XX-XX | events | 1 | D-11 schema shape | — | `truncationSuspected: z.boolean().optional()`; `failureReason: enum.optional()` | unit (optional) | `pnpm test -- events/schema` | existing — add cases | ⬜ pending |
| 2-XX-XX | scheduler | 3 | D-06 shared guard | — | manual + scheduled never run same source concurrently | unit | `pnpm test -- PlaylistScheduler` | ✅ exists — ADD cases | ⬜ pending |
| 2-XX-XX | integration | 3 | SCRAPE-01..07 E2E | — | real Python spawn in Docker | integration (gated) | `SCRAPER_INTEGRATION=1 pnpm test -- integration/scraper` | ❌ Wave 0 — `src/modules/server/scraper/integration.test.ts` | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/modules/server/scraper/SyncRunner.test.ts` — SCRAPE-03/04, D-08/09/10/11 with injected fake bridge
- [ ] `src/modules/server/scraper/repository.test.ts` — D-13/14/15 upsert-preserves-state + SCRAPE-07 (in-memory better-sqlite3 with real schema)
- [ ] `src/modules/server/scraper/SpotifyScraperBridge.test.ts` — Node→Python envelope parsing, timeout behavior, `python_crash` synthesis (mock `node:child_process`)
- [ ] `src/modules/client/playlist/schema/create-playlist-form.test.ts` — SCRAPE-01 URL accept/reject matrix
- [ ] `src/modules/server/scraper/integration.test.ts` — gated on `SCRAPER_INTEGRATION=1`; real bridge inside Docker dev container
- [ ] `src/modules/server/scheduler/PlaylistScheduler.test.ts` — UPDATE: add manual+scheduled race case
- [ ] `src/modules/server/events/schema.test.ts` — OPTIONAL: cases for extended schemas

*Framework install:* none — Vitest already present and wired. Python install is Docker-only per D-04.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real-playlist end-to-end scrape (UI) | SCRAPE-01..07 | Requires UI interaction + real Docker container + real Spotify URL | 1. `pnpm docker:dev`. 2. Add source via UI with spike-001 playlist URL. 3. Click Sync-now. 4. Confirm tracks appear in DB (`sqlite3 data/db.sqlite 'select count(*), state from tracks;'`) with state=pending. 5. Confirm `sources.cover_art_url` populated. |
| Docker image `python3 -c "import spotify_scraper"` | D-03, DEPLOY-01 (partial, Phase 6-scope-verify) | Requires full image build | `docker build -t spotdl-manager:test . && docker run --rm spotdl-manager:test scraper/.venv/bin/python -c "import spotify_scraper; print(spotify_scraper.__version__)"` |
| Truncation warning on 100-track playlist | D-10, D-11 | Requires real ≥100-track public playlist | Use known large public playlist (see spike 002 `scale_results.json`). Sync. Verify `invocations.summary.truncation_suspected == true` AND Discord webhook message includes truncation note. |
| Typed-failure Discord webhook formatting | D-09, D-11 | Requires real webhook endpoint | With webhook configured, force each failure path (bad URL → `invalid_url`; deleted playlist → `not_found`; disconnect network → `network_error`). Verify webhook message format per enum. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags (`pnpm test` uses `vitest run`, not `vitest`)
- [ ] Feedback latency < 10s per task
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
