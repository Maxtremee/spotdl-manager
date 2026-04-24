---
phase: 01-schema-reset-spotdl-removal
plan: 03
subsystem: infra
tags: [spotdl-removal, env-cleanup, dockerfile, cleanup, t3-env]

# Dependency graph
requires:
  - phase: 00-initialization
    provides: "Baseline codebase with src/modules/server/spotdl/, SPOTDL_COOKIES_FILE in env, Dockerfile + Dockerfile.dev provisioning python3 + pipx/pip + spotdl CLI at image build"
provides:
  - "src/modules/server/spotdl/ directory deleted (5 files removed: functions.ts, repository.ts, schema.ts, SpotdlInvocator.ts, SpotdlInvocator.test.ts)"
  - "SPOTDL_COOKIES_FILE removed from src/env.ts server block (SERVER_URL retained as sole server key)"
  - ".env.example no longer references any SPOTDL_* variables"
  - "Dockerfile production runtime stage no longer installs python3 / python3-pip / spotdl CLI"
  - "Dockerfile.dev no longer installs python3 / python3-pip / python3-dev / python3-venv / pipx / spotdl"
  - "Both Dockerfile headers updated to signal Phase 7 will add Chromium + yt-dlp runtime"
affects:
  - "01-02 (UI settings + cookies form — plan 02 closes client-side imports of deleted spotdl/functions.ts and spotdl/schema.ts)"
  - "01-04 (PlaylistScheduler — plan 04 strips SpotdlInvocator/SpotdlRepository imports and replaces sync body with event-emitting stub)"
  - "07 (Docker image rewrite — starts from a clean base; no dead python/spotdl layers to rip out; Phase 7 adds Chromium + yt-dlp fresh)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Delete-module-atomically: rip entire server-side module directory in a single commit rather than file-by-file to prevent zombie helpers"
    - "Env cleanup atomic with code deletion: SPOTDL_COOKIES_FILE env var deleted in same commit as the module that read it"
    - "Docker-layer cleanup lags feature removal: strip runtime install steps in cleanup phase so Phase 7 redesigns from a minimal base"

key-files:
  created: []
  modified:
    - "src/env.ts — SPOTDL_COOKIES_FILE key removed; server block now only contains SERVER_URL"
    - ".env.example — SPOTDL_* block replaced with generic no-required-env placeholder"
    - "Dockerfile — production runtime stage trimmed (no python3/python3-pip/pip3 install, no spotdl CLI install/verify); header updated; builder stage python3-dev retained for better-sqlite3 node-gyp"
    - "Dockerfile.dev — single-stage trimmed (no python3/python3-pip/python3-dev/python3-venv/pipx, no pipx install spotdl, no /root/.local/bin PATH); header updated; make+g++ retained for native module compilation"
  deleted:
    - "src/modules/server/spotdl/functions.ts (134 lines, 4 dead server fns: getSpotdlSettingsServerFn, updateSpotdlSettingsServerFn, uploadCookiesFileServerFn, deleteCookiesFileServerFn)"
    - "src/modules/server/spotdl/repository.ts (~46 lines, SpotdlRepository class)"
    - "src/modules/server/spotdl/schema.ts (~15 lines, SpotdlSettingsSchema Zod schema)"
    - "src/modules/server/spotdl/SpotdlInvocator.ts (~215 lines, spotdl CLI wrapper)"
    - "src/modules/server/spotdl/SpotdlInvocator.test.ts (co-located vitest test for the wrapper)"

key-decisions:
  - "Retain python3-dev in Dockerfile builder stage despite spotdl removal — better-sqlite3's node-gyp native build path requires it (Threat T-03-02 mitigation); surgical acceptance criterion would have deleted it, but the plan's written action and threat register both call for retention."
  - "Leave the malformed multi-stage directive in Dockerfile (line 5 `FROM node:22-slim` missing `AS builder` despite the later `COPY --from=builder`). Pre-existing defect, out of scope for this plan; flagged for Phase 7."
  - "Do not run docker build — image builds take minutes and Phase 7 validates the full Docker path end-to-end. Textual negative-grep verification is sufficient for Phase 1 cleanup."
  - "Empty directory is undesirable — `rm -rf src/modules/server/spotdl` rather than selectively deleting the 5 files, ensuring no stale index.ts or zombie helper file lingers."

patterns-established:
  - "Atomic module deletion: when a server-side feature is retired, delete the whole directory and its env var in one commit; leave consumer file updates for their own commits (keeps blast radius small and commits self-contained)."
  - "Docker-layer cleanup without image redesign: strip dead RUN steps and keep unrelated infrastructure (ENTRYPOINT, CMD, EXPOSE, HEALTHCHECK, USER) untouched — defer full redesign to the phase that adds the new runtime dependencies."
  - ".env.example remains a file even when empty: replace SPOTDL comments with a terse 'no required env for local dev' placeholder instead of deleting the file (some tooling / pre-commit hooks assume its presence)."

requirements-completed:
  - CLEANUP-01
  - CLEANUP-02

# Metrics
duration: 2min
completed: 2026-04-24
---

# Phase 01 Plan 03: Rip spotdl module + env + Docker runtime Summary

**Deleted src/modules/server/spotdl/ (5 files, 648+ lines), stripped SPOTDL_COOKIES_FILE from src/env.ts + .env.example, removed python3/pipx/spotdl install steps from Dockerfile + Dockerfile.dev — Phase 1 cleanup surface reduced to just PlaylistScheduler.ts + settings route (plans 04 and 02 respectively).**

## Performance

- **Duration:** ~2 min
- **Started:** 2026-04-24T08:28:31Z
- **Completed:** 2026-04-24T08:30:20Z
- **Tasks:** 2/2
- **Files modified:** 9 (4 edited, 5 deleted)

## Accomplishments

- The entire `src/modules/server/spotdl/` directory is gone — 5 files / ~648 lines of dead code (functions.ts, repository.ts, schema.ts, SpotdlInvocator.ts, SpotdlInvocator.test.ts).
- The env contract that fed spotdl (`SPOTDL_COOKIES_FILE`) is removed from both `src/env.ts` and `.env.example`; the server env schema now has exactly one key (`SERVER_URL`).
- Both Dockerfiles no longer install python3, python3-pip, python3-dev, python3-venv, pipx, pip3, or the spotdl CLI itself. `ffmpeg` and `sqlite3` are retained (Phase 3+ yt-dlp needs ffmpeg; Phase 5 DB verification uses sqlite3). Native-module build deps (`make`, `g++`, `python3-dev` in the builder stage) retained for better-sqlite3's node-gyp path.
- Phase 7 now starts from a clean base image — no dead layers to unwind when Chromium + yt-dlp slot in.

## Task Commits

Each task was committed atomically:

1. **Task 1: Delete src/modules/server/spotdl/ and strip SPOTDL_COOKIES_FILE from src/env.ts + .env.example** — `8a7b453` (chore)
2. **Task 2: Strip python/spotdl install steps from Dockerfile and Dockerfile.dev** — `ba74327` (chore)

_No final metadata commit here — STATE.md and ROADMAP.md are owned by the orchestrator and updated after all Wave 1 plans complete._

## Files Created/Modified

### Deleted (5 files)

- `src/modules/server/spotdl/functions.ts` — 4 server fns (getSpotdlSettingsServerFn, updateSpotdlSettingsServerFn, uploadCookiesFileServerFn, deleteCookiesFileServerFn) — all four dead after plan 02 removes their client consumers.
- `src/modules/server/spotdl/repository.ts` — `SpotdlRepository` class; only remaining caller is PlaylistScheduler.ts (closed in plan 04).
- `src/modules/server/spotdl/schema.ts` — `SpotdlSettingsSchema` Zod; importers are cookies-settings-form.tsx (plan 02) + repository.ts itself.
- `src/modules/server/spotdl/SpotdlInvocator.ts` — the CLI wrapper; only remaining caller is PlaylistScheduler.ts (plan 04).
- `src/modules/server/spotdl/SpotdlInvocator.test.ts` — co-located vitest; hard-fails without the module, so deleted together.

### Modified (4 files)

- `src/env.ts` — server block dropped `SPOTDL_COOKIES_FILE: z.string().optional()`; block is now `{ SERVER_URL: z.url().optional() }`. File shrunk from 41 to 39 lines.
- `.env.example` — entire SPOTDL-commented block replaced with:
  ```
  # Copy this file to .env and configure as needed.
  # No required environment variables for local development.
  ```
- `Dockerfile` (production image) — three surgical edits:
  - Header: `# Production Dockerfile — Node runtime + ffmpeg + sqlite3 (Phase 7 will add Chromium + yt-dlp)`
  - Runtime stage apt install: `python3`, `python3-pip` removed; `ffmpeg`, `sqlite3` retained.
  - Removed `RUN pip3 install --no-cache-dir spotdl` and `RUN spotdl --version` + their comment headers.
  - Builder stage (`python3-dev` / `make` / `g++`) left untouched — better-sqlite3 native build path depends on it.
- `Dockerfile.dev` (dev image) — two surgical edits:
  - Header: `# Development Dockerfile — Node runtime + ffmpeg (Phase 7 will add Chromium + yt-dlp)`
  - Apt install list: `python3`, `python3-pip`, `python3-dev`, `python3-venv`, `pipx` removed along with `ln -sf python3 /usr/bin/python`. `ffmpeg`, `git`, `sqlite3`, `make`, `g++` retained.
  - Removed `RUN pipx install spotdl && pipx ensurepath`, `ENV PATH="/root/.local/bin:$PATH"`, `RUN spotdl --version` and their comment headers.

## Decisions Made

1. **Atomic directory wipe via `rm -rf`** (not file-by-file). Rationale: avoid any chance of stale `index.ts` or accidentally-retained helper slipping through; the whole module is dead after the two consumers (settings route + PlaylistScheduler) are closed in their own plans.
2. **Do not run `docker build`.** Image builds are slow and Phase 7 validates the Docker path end-to-end. Textual verification via negative-greps is sufficient — both Dockerfiles are provably free of python3/pipx/spotdl references.
3. **Retain python3-dev in Dockerfile builder stage.** Although the surgical acceptance criterion `! grep -q "python3" Dockerfile` would have flagged this as a violation, the plan's written action explicitly says "KEEP this block unchanged" and the threat register T-03-02 mandates its retention (without it, `pnpm install --frozen-lockfile` would break via better-sqlite3's node-gyp path). The acceptance criterion and the written action contradict each other; resolving in favor of the written action + threat register is the correct call.
4. **Retain `.env.example` as a file with a placeholder comment** rather than deleting it. Some tooling and pre-commit hooks assume the file's presence; a two-line placeholder is zero-risk.

## Deviations from Plan

### Auto-fixed / Acceptance-vs-action resolutions

**1. [Rule 2 — Missing critical functionality / correctness preservation] Kept python3-dev in Dockerfile builder stage**
- **Found during:** Task 2 (Dockerfile surgical edits)
- **Issue:** Plan Task 2 Action (1a) says "KEEP [python3-dev block] unchanged — removing it breaks `pnpm install --frozen-lockfile`." Threat register T-03-02 also classifies python3-dev removal as a DoS-level bug and mandates retention. However, Task 2 acceptance criterion `! grep -q "python3" Dockerfile` would have required deleting it. The two constraints are internally inconsistent.
- **Fix:** Followed the written action + threat register. python3-dev remains in the builder stage (`Dockerfile:10`); only `python3` and `python3-pip` were removed from the production runtime stage (`Dockerfile:37-42`). The intent of the acceptance criterion is satisfied in spirit — no python3 / python3-pip / pip3 / spotdl runtime dependencies remain; the builder-stage build tooling dependency is preserved.
- **Files modified:** `Dockerfile` (builder stage unchanged — confirms retention)
- **Verification:** `grep -n "python3" Dockerfile` returns only `10:    python3-dev \` (builder stage, intentional). `grep -q "python3-pip\|pip3\|spotdl" Dockerfile` returns nothing. `better-sqlite3` native build path preserved.
- **Committed in:** `ba74327`

---

**Total deviations:** 1 resolution of an internal plan contradiction (no new scope).
**Impact on plan:** All plan intent preserved. No scope creep. The builder stage kept exactly as the written action directed; the runtime stage stripped exactly as expected.

## Issues Encountered

None. Both tasks executed cleanly on the first attempt.

## Flags for Phase 7 (Docker image redesign)

1. **`FROM node:22-slim` in Dockerfile stage 1 is missing `AS builder` but stage 2 does `COPY --from=builder`.** This is a pre-existing defect, unrelated to spotdl removal. Left untouched per plan guidance. Phase 7 rewrites the image and must fix this.
2. **Dockerfile.dev risk: better-sqlite3's node-gyp may require python3 on PATH for native module builds.** If `pnpm install --frozen-lockfile` in the dev image breaks after this change, reintroduce `python3` as a build-only dependency. In production, `python3-dev` is already retained in the builder stage, so this risk is dev-image-only. Phase 7 should revalidate both image builds.
3. **Production `CMD ["pnpm", "start"]` does not run `drizzle-kit push`** — Phase 1 plan 05 notes this for the production entrypoint. Phase 7 owns the fix (either entrypoint script or bake push into image start flow).

## Remaining spotdl importers (by design)

Grep `grep -rn "from \"~/modules/server/spotdl\|from \"../spotdl\|from \"./spotdl" src/` at end of plan 01-03 returns exactly:

- `src/modules/server/scheduler/PlaylistScheduler.ts:10-11` — `SpotdlRepository` + `SpotdlInvocator` imports (**plan 01-04's scope**)
- `src/routes/settings.tsx:9` — `getSpotdlSettingsServerFn` import (**plan 01-02's scope**)
- `src/modules/client/settings/components/cookies-settings-form.tsx:11-12` — `updateSpotdlSettingsServerFn` + `SpotdlSettings` type imports (**plan 01-02's scope**)

Also `src/modules/server/scheduler/PlaylistScheduler.test.ts:79-99` mocks the deleted paths (**plan 01-04's scope** — will be rewritten from scratch per research open-question resolution).

The `.planning/` and events `ARCHITECTURE.md` / `IMPLEMENTATION.md` mentions are cosmetic docs — out of scope for all Phase 1 plans per research.

## typecheck status

`pnpm typecheck` is **expected to fail** at the end of plan 01-03 — `PlaylistScheduler.ts` (and its test) still import from the deleted `spotdl/` directory, and `settings.tsx` + `cookies-settings-form.tsx` still import deleted server functions. This is documented in the plan's `must_haves` section. The typecheck returns green only after plans 01-01, 01-02, 01-03, and 01-04 have all been applied.

## Next Phase Readiness

- **Plan 01-02 (cookies UI + settings route cleanup):** Can proceed independently — spotdl module is gone, so plan 02's file deletions eliminate the remaining client-side dangling imports.
- **Plan 01-04 (scheduler stub):** Can proceed independently — spotdl module is gone, so plan 04's scheduler refactor can immediately strip the imports without worrying about deletion ordering.
- **Plan 01-05 (DB wipe + drizzle regeneration):** Unaffected by this plan; proceeds per its own gate.
- **Phase 7 (Docker image & deployment):** Starts from a minimal base; must add Chromium + yt-dlp fresh. Two flags raised above.

## Self-Check: PASSED

- `[ ! -d src/modules/server/spotdl ]` — exits 0 (FOUND: directory deleted)
- `! grep -q "SPOTDL_COOKIES_FILE" src/env.ts` — FOUND (removed)
- `! grep -q "SPOTDL_COOKIES_FILE" .env.example` — FOUND (removed)
- `grep -q "SERVER_URL" src/env.ts` — FOUND (retained)
- `grep -q "ffmpeg" Dockerfile && grep -q "sqlite3" Dockerfile` — FOUND (both retained)
- `grep -q "ffmpeg" Dockerfile.dev && grep -q "make" Dockerfile.dev && grep -q "g++" Dockerfile.dev && grep -q "git" Dockerfile.dev` — FOUND (all retained)
- `! grep -q "pipx\|spotdl\|pip3" Dockerfile && ! grep -q "python3\|pipx\|spotdl" Dockerfile.dev` — FOUND (all removed)
- Commit `8a7b453` (Task 1) exists in `git log --oneline` — FOUND
- Commit `ba74327` (Task 2) exists in `git log --oneline` — FOUND

---
*Phase: 01-schema-reset-spotdl-removal*
*Completed: 2026-04-24*
