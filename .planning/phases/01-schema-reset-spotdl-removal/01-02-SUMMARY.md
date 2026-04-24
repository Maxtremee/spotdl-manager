---
phase: 01-schema-reset-spotdl-removal
plan: 02
subsystem: ui
tags: [solid-js, zod, tanstack-form, panda-css, cleanup, spotdl-removal]

# Dependency graph
requires:
  - phase: 01-schema-reset-spotdl-removal
    provides: CLEANUP-04 client-side surface trim (parallel with Plan 01-01 schema + Plan 01-03 server/env trim in Wave 1)
provides:
  - Trimmed client PlaylistSchema (no flags, no track source variant)
  - Trimmed CreatePlaylistFormSchema (no flag fields, URL validator rejects /track/)
  - Trimmed PlaylistConfigCard (no Format/Quality/Run Now controls)
  - Deleted AdvancedFlagsSection + CookiesSettingsForm components
  - Webhook-only settings page
  - Rewritten playlist.test.ts (12 tests, no flags/track/format/quality)
affects: [Plan 01-03 server cleanup, Plan 02+ new download engine, Phase 3 scheduler wiring]

# Tech tracking
tech-stack:
  added: []
  patterns: []

key-files:
  created:
    - .planning/phases/01-schema-reset-spotdl-removal/deferred-items.md
  modified:
    - src/modules/client/playlist/schema/playlist.ts
    - src/modules/client/playlist/schema/playlist.test.ts
    - src/modules/client/playlist/schema/create-playlist-form.ts
    - src/modules/client/playlist/service/options.ts
    - src/modules/client/playlist/service/playlist.ts
    - src/modules/client/playlist/service/playlist-actions.ts
    - src/modules/client/playlist/components/playlist-config-card.tsx
    - src/modules/client/playlist/components/basic-fields-section.tsx
    - src/modules/client/settings/index.ts
    - src/routes/library_.add.tsx
    - src/routes/library_.$playlistId.tsx
    - src/routes/settings.tsx
  deleted:
    - src/modules/client/playlist/components/advanced-flags-section.tsx
    - src/modules/client/settings/components/cookies-settings-form.tsx

key-decisions:
  - "D-04 applied: Run Now button hidden (deleted) rather than disabled-with-tooltip"
  - "D-12 applied: all flag fields (overwrite/retries/quality/format) removed from schema + form + UI"
  - "D-07 respected: no library-reset banner added to settings page"
  - "Typecheck not required green in isolation — parallel Plans 01-01 and 01-03 own sibling errors; final merge converges"

patterns-established: []

requirements-completed: [CLEANUP-04]

# Metrics
duration: 7min
completed: 2026-04-24
---

# Phase 1 Plan 02: Spotdl UI Surface Purge Summary

**Purged all spotdl-era flag controls + cookies settings form from the client bundle; playlist create/detail pages + settings page now reflect the Phase 1 webhook-only, flagless, playlist-or-album-only contract.**

## Performance

- **Duration:** 7 min
- **Started:** 2026-04-24T08:28:37Z
- **Completed:** 2026-04-24T08:35:24Z
- **Tasks:** 3
- **Files modified:** 12
- **Files deleted:** 2
- **Files created:** 1 (deferred-items.md tracker)

## Accomplishments

- Zod client PlaylistSchema trimmed to two-variant source union (playlist|album) with no flags field
- CreatePlaylistFormSchema reduced from 11 user-facing fields to 7 (dropped enableAdvancedFlags/overwrite/retries/quality/format)
- PlaylistConfigCard prop surface reduced from 13 props to 7 (dropped format/quality/isSyncing/canSync/onFormatChange/onQualityChange/onRunSync)
- Two dead components (`AdvancedFlagsSection`, `CookiesSettingsForm`) deleted outright
- `playlist.test.ts` rewritten with 12 passing tests reflecting the trimmed contract
- Settings page now loads + renders only webhook form

## Task Commits

Each task was committed atomically (worktree `worktree-agent-a881fca4`, parallel Wave 1):

1. **Task 1: Trim PlaylistSchema + CreatePlaylistFormSchema + service helpers** — `b6eebc6` (refactor)
2. **Task 2: Delete dead components + trim playlist detail card + fix three routes** — `64240a9` (refactor)
3. **Deferred items tracker** — `8512516` (docs)
4. **Task 3: Rewrite playlist.test.ts** — `514535e` (test)

## Files Created/Modified

### Modified

- `src/modules/client/playlist/schema/playlist.ts` — dropped PlaylistFlagsSchema const entirely, removed `flags` field from PlaylistSchema, removed `"track"` variant from PlaylistSourceSchema, removed `spotifyTrack` sample + `flags` blocks from `SAMPLE_PLAYLISTS`.
- `src/modules/client/playlist/schema/create-playlist-form.ts` — dropped `enableAdvancedFlags`, `overwrite`, `retries`, `quality`, `format` fields; URL refine rejects `/track/`; narrowed `detectSourceType` + `formDataToPlaylistPayload` to `"playlist" | "album"`.
- `src/modules/client/playlist/schema/playlist.test.ts` — 12-test rewrite; dropped flags/format/quality/retries/track cases; added "track no longer supported" rejection test.
- `src/modules/client/playlist/service/options.ts` — shrunk from ~29 lines to ~7: kept only `statusOptions` + `StatusOption`; removed `formatOptions`, `qualityOptions`, `FormatOption`, `QualityOption`.
- `src/modules/client/playlist/service/playlist.ts` — narrowed `formatSourceType` signature to `Playlist["source"]["type"]` → `"Playlist" | "Album"` (dropped `"Track"` return and `track` labels entry).
- `src/modules/client/playlist/service/playlist-actions.ts` — deleted `updateFormat` + `updateQuality` functions; dropped `FormatOption`/`QualityOption` imports; kept `deletePlaylist`, `triggerSync`, `updateStatus`, `PlaylistActionCallbacks`.
- `src/modules/client/playlist/components/playlist-config-card.tsx` — dropped `PlayIcon` import + `Button` import; dropped Format/Quality `Select.Root` blocks; deleted Run Now button; trimmed `PlaylistConfigCardProps` to 7 fields (`sourceUrl`, `outputDir`, `schedule`, `status`, `isUpdating`, `onStatusChange`, `deleteDialog`).
- `src/modules/client/playlist/components/basic-fields-section.tsx` — help text: "playlist or album" (dropped ", or track").
- `src/modules/client/settings/index.ts` — dropped `CookiesSettingsForm` re-export; only `WebhookSettingsForm` remains.
- `src/routes/library_.add.tsx` — dropped `AdvancedFlagsSection` import + render; trimmed `defaultValues` to 7 fields (no flag defaults).
- `src/routes/library_.$playlistId.tsx` — dropped `updateFormat`, `updateQuality`, `triggerSync` imports; deleted `isSyncing` signal, `handleRunSync`, `handleFormatChange`, `handleQualityChange`; trimmed `PlaylistConfigCard` props; coerced `schedule` `undefined → null` at render.
- `src/routes/settings.tsx` — dropped `CookiesSettingsForm` + `getSpotdlSettingsServerFn` imports; loader returns `{ webhookSettings }` only; JSX renders only `<WebhookSettingsForm>`.

### Deleted

- `src/modules/client/playlist/components/advanced-flags-section.tsx` (156 lines — entire `AdvancedFlagsSection` component)
- `src/modules/client/settings/components/cookies-settings-form.tsx` (129 lines — entire `CookiesSettingsForm` component)

### Created

- `.planning/phases/01-schema-reset-spotdl-removal/deferred-items.md` — tracks typecheck errors owned by parallel Wave 1 sibling plans (01-01 mapper/schema, 01-03 server spotdl/env).

## Final Prop Surface of `PlaylistConfigCard`

```typescript
interface PlaylistConfigCardProps {
  sourceUrl: string;
  outputDir: string;
  schedule: PlaylistSchedule | null;
  status: string;
  isUpdating: Accessor<boolean>;
  onStatusChange: (status: string) => void;
  deleteDialog: JSX.Element;
}
```

## Final Field List in `CreatePlaylistFormSchema`

```typescript
{
  name: z.string().min(1).max(255),
  sourceUrl: z.string().url().refine(isSpotifyPlaylistOrAlbumUrl),
  outputDir: z.string().min(1).refine(...),
  enableSchedule: z.boolean().default(false),
  scheduleType: z.enum(["cron", "interval"]).default("interval"),
  scheduleCron: z.string().optional().refine(isValidCron),
  scheduleMinutes: z.number().int().min(1).max(43200).default(1440),
}
```

Seven fields. URL validator accepts `open.spotify.com` with `/playlist/` or `/album/` only.

## Rewritten `playlist.test.ts` Coverage

- **Count:** exactly 12 `it(...)` specs (verified via `grep -c "^\s*it(" = 12`)
- **Passing:** 12/12 green under `pnpm exec vitest run src/modules/client/playlist/schema/playlist.test.ts`
- **No refs to:** `spotifyTrack`, `flags`, `format`, `quality`, `retries` (verified empty via grep)
- **Explicit anti-regression:** `"should throw when source type is 'track' (no longer supported)"` spec

## Decisions Made

- **Task 2 schedule prop coercion:** Pre-existing baseline type mismatch — `playlist().schedule` is `PlaylistSchedule | undefined`, `PlaylistConfigCardProps.schedule` is `PlaylistSchedule | null`. Coerced at the call site (`?? null`) rather than widening the prop type because `null` is a more explicit "no schedule" signal than `undefined` in the detail card's downstream `<Show>` logic.
- **Typecheck-in-isolation expectation adjusted:** Plan called for `pnpm typecheck` exit 0 as Task 2 acceptance, but the plan also explicitly prohibits touching `src/modules/server/playlist/functions.ts` and `src/modules/client/playlist/utils/mapper.ts` (Plans 01-01 and 01-03's territory). In parallel Wave 1 worktrees, sibling changes are absent. The remaining typecheck errors after Tasks 1-2 are all either (a) pre-existing baseline errors or (b) caused by Task 1's narrowing but residing in files owned by Plans 01-01/01-03. All are logged in `deferred-items.md` per executor Scope Boundary rules.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Schedule prop type mismatch in `library_.$playlistId.tsx`**

- **Found during:** Task 2 (trim routes)
- **Issue:** `PlaylistConfigCard.schedule` prop typed `PlaylistSchedule | null`, but `playlist().schedule` is `PlaylistSchedule | undefined`. `undefined` isn't assignable to `null`.
- **Fix:** Coerce at the call site with `playlist().schedule ?? null`. Pre-existing baseline issue — surfaced after other errors in this file were resolved.
- **Files modified:** `src/routes/library_.$playlistId.tsx`
- **Verification:** typecheck now produces only out-of-scope errors (tracked in deferred-items.md).
- **Committed in:** `64240a9` (part of Task 2 commit)

### Out-of-scope Items Deferred

Logged in `.planning/phases/01-schema-reset-spotdl-removal/deferred-items.md`. Summary: 11 residual typecheck errors that are (a) pre-existing baseline (`file-upload.tsx` broken import, `library.tsx` PlaylistItem id optional vs required, `playlist-header.tsx(72)` formatStatus widening, `playlist-table.tsx(71)` same) or (b) owned by parallel Wave 1 plans (Plan 01-01: `mapper.ts` flags refs + formatSourceType widening in components consuming mapper output; Plan 01-03: `server/spotdl/functions.ts`, `server/playlist/functions.ts` flags block, `SpotdlInvocator.test.ts`).

## Verification

- `grep -c "^\s*it(" src/modules/client/playlist/schema/playlist.test.ts` → **12** ✓
- `pnpm exec vitest run src/modules/client/playlist/schema/playlist.test.ts` → **12 passed** ✓
- `grep -rln "AdvancedFlagsSection\|CookiesSettingsForm\|PlaylistFlagsSchema" src/` → **no results** ✓
- `grep -q "Run Now" src/modules/client/playlist/components/playlist-config-card.tsx` → **empty** ✓
- `grep -q "or track" src/modules/client/playlist/components/basic-fields-section.tsx` → **empty** ✓
- `grep -q "formatOptions\|qualityOptions" src/modules/client/playlist/components/playlist-config-card.tsx` → **empty** ✓

## Known Stubs

None introduced by this plan. Existing stubs elsewhere in the codebase (e.g., scheduler no-op body) belong to other plans in Phase 1 (01-04).

## Self-Check: PASSED

- All 12 modified file paths exist and contain expected post-edit shape ✓
- Both deleted file paths (`advanced-flags-section.tsx`, `cookies-settings-form.tsx`) confirmed gone ✓
- 4 commits visible in `git log --oneline -5`: `b6eebc6`, `64240a9`, `8512516`, `514535e` ✓
- Test file has exactly 12 `it()` calls and all pass ✓
- `deferred-items.md` created and committed ✓
