---
phase: 1
slug: schema-reset-spotdl-removal
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-23
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from `01-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest 4.0.16 (co-located `*.test.ts`) |
| **Config file** | none at repo root — Vitest uses default config |
| **Quick run command** | `pnpm test` (runs `vitest run`, single pass, non-watch) |
| **Full suite command** | `pnpm test && pnpm typecheck && pnpm lint && pnpm build` |
| **Per-file command** | `pnpm exec vitest run <file>` |
| **Estimated runtime** | quick: < 20s ; full suite: ~60–90s |

---

## Sampling Rate

- **After every task commit:** `pnpm exec vitest run <touched-file>` + `pnpm typecheck`
- **After every plan wave:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** 20 seconds per-task, 90 seconds per-wave

---

## Per-Task Verification Map

Tasks are filled in by the planner. Requirement → test mapping derived from RESEARCH:

| Req / Decision | Behavior | Test Type | Automated Command | File Exists | Status |
|----------------|----------|-----------|-------------------|-------------|--------|
| TRACK-01 | `tracks` table has unique `(source_id, spotify_track_id)` | unit (schema introspection) | `pnpm exec vitest run src/modules/server/db/schema.test.ts` | ❌ W0 — create `src/modules/server/db/schema.test.ts` | ⬜ pending |
| TRACK-02 | Track row stores title, artist, duration_ms, state enum, yt_video_id, download_path, failure_reason, position, timestamps with correct types + defaults | unit (schema introspection) | same as TRACK-01 | ❌ W0 | ⬜ pending |
| CLEANUP-01 | `SpotdlInvocator`, `SpotdlRepository`, `src/modules/server/spotdl/` deleted | integration (compile-time + shell guard) | `pnpm typecheck`; `[ -d src/modules/server/spotdl ] && exit 1 \|\| exit 0` | ✅ typecheck exists | ⬜ pending |
| CLEANUP-02 | `SPOTDL_COOKIES_FILE`, `flags_*` columns, `spotdl` global_settings key removed | unit + integration (grep + schema test) | `! grep -r "SPOTDL_COOKIES_FILE\|flagsFormat\|flagsQuality\|flagsOverwrite\|flagsRetries" src/`; schema test asserts no `flags_*` columns | ❌ W0 (schema test) | ⬜ pending |
| CLEANUP-03 | DB wipe succeeds on first boot; no notice UI rendered (notice explicitly dropped per D-07) | manual integration | manual: `rm data/db.sqlite && pnpm dev` → observe logs, confirm new schema via `sqlite3 data/db.sqlite '.schema'`; grep src for absence of 'library reset' copy | manual-only acceptable | ⬜ pending |
| CLEANUP-04 | `CookiesSettingsForm` deleted, flag form fields removed, Run Now button hidden | integration (compile + shell guards) | `pnpm typecheck`; `[ -f src/modules/client/settings/components/cookies-settings-form.tsx ] && exit 1 \|\| exit 0` | ✅ | ⬜ pending |
| D-01 / D-02 | Scheduler stub tick emits `playlist.sync.started` + `playlist.sync.completed` on each fire | unit (rewritten PlaylistScheduler.test.ts) | `pnpm exec vitest run src/modules/server/scheduler/PlaylistScheduler.test.ts` | ✅ file exists (rewrite) | ⬜ pending |
| D-03 | Stub does not call `InvocationRepository.create` or `.update` | unit (same test) | same as D-01/D-02 | ✅ | ⬜ pending |
| Event-payload | Emitted events satisfy Zod schemas (`duration: positive`, `invocationId: uuid`) | unit (scheduler test asserts bus.emit resolves, schemas validate) | same as D-01/D-02 | ✅ | ⬜ pending |
| D-04 | Manual "sync now" button not rendered in library/playlist routes | integration (grep + snapshot) | `! grep -r "Run Now\|sync now" src/routes/` or equivalent component-level assertion | manual + grep guard | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `src/modules/server/db/schema.test.ts` — new file: asserts `tracks` table `$inferSelect` shape, unique `(source_id, spotify_track_id)` constraint, state enum default, no `flags_*` columns on `sources` table
- [ ] Rewrite `src/modules/server/scheduler/PlaylistScheduler.test.ts` — strip `SpotdlRepository`/`SpotdlInvocator` mocks; assert stub tick emits lifecycle events + does NOT touch `InvocationRepository`
- [ ] Rewrite `src/modules/client/playlist/playlist.test.ts` — remove flag-enum assertions + `"track"` source-type cases; align with trimmed `CreatePlaylistFormSchema`
- [ ] Delete `src/modules/server/spotdl/SpotdlInvocator.test.ts` outright (module is deleted)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| First-boot DB wipe + fresh schema apply | CLEANUP-03 | DB lifecycle depends on filesystem state + `drizzle-kit push`; hard to simulate deterministically in unit test | 1. `rm -f data/db.sqlite` ; 2. `pnpm dev` (or `pnpm db:push && pnpm dev`) ; 3. `sqlite3 data/db.sqlite '.schema'` — confirm `sources`, `tracks`, `invocations`, `global_settings` tables present and no `playlists` / `flags_*` columns |
| Scheduler stub emits on tick | D-01, D-02 | Cron timing is observed behavior; unit test asserts body, manual tick confirms wiring | Add a source with a 1-minute interval ; wait one tick ; observe logs for `playlist.sync.started` + `playlist.sync.completed` handler output ; confirm no invocation row created |
| Discord webhook handler continues to fire on stub tick | D-02 | Requires real webhook URL to confirm integration | Configure webhook URL in settings ; wait for tick ; confirm Discord message received |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies mapped
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all ❌ MISSING references in the per-task table
- [ ] No watch-mode flags (`vitest` not `vitest --watch`)
- [ ] Feedback latency < 20s per-task, < 90s per-wave
- [ ] `nyquist_compliant: true` set in frontmatter once all of the above are true

**Approval:** pending
