# Phase 1 Deferred Items — Pre-existing + Wave-1 transient Errors

Consolidated log from plans 01-01 and 01-02 (Wave 1 worktrees).
Errors here existed at commit `88c8b34` (Phase 1 wave-1 base) BEFORE Wave 1 touched
any file, or were transient ripples caused by parallel wave plans that converge to
zero once all three merge.

## Pre-existing baseline (independent of Phase 1)

| File | Line | Error |
|------|------|-------|
| src/components/ui/file-upload.tsx | 16 | `Cannot find module '@/components/ui'` — alias mismatch |
| src/routes/library.tsx | 113 | `PlaylistItem` id required vs optional on mapped row |
| src/modules/client/playlist/components/playlist-header.tsx | 72 | `formatStatus(string)` vs narrowed status enum |
| src/modules/client/library/components/playlist-table.tsx | 71 | Same `formatStatus` issue as playlist-header |

## Wave-1 transients (resolve once 01-01 + 01-02 + 01-03 all merge)

| File | Line | Error | Owner plan |
|------|------|-------|------------|
| src/modules/client/library/components/playlist-table.tsx | 67 | `string` not assignable to narrowed source_type | 01-02 trim |
| src/modules/client/playlist/components/playlist-header.tsx | 71 | Same narrowing | 01-02 trim |
| src/modules/client/playlist/utils/mapper.ts | 47 | `playlist.flags` ref | 01-01 mapper rewrite |
| src/modules/server/playlist/functions.ts | 162-166 | `flags` field on update payload | 01-03 server fn schema trim |
| src/modules/server/spotdl/functions.ts | 76-119 | `cookiesFile` mismatch | 01-03 spotdl dir delete |
| src/modules/server/spotdl/SpotdlInvocator.test.ts | 237 | unused `_result` | 01-03 file delete |
| src/modules/client/playlist/schema/playlist.test.ts | — | flags/spotifyTrack refs | 01-02 Task 3 rewrite |
| src/routes/library_.$playlistId.tsx | 123 | `PlaylistSchedule \| null` vs `undefined` | 01-02 or downstream |

## Resolution

After all Wave 1 plans merge, `pnpm typecheck` should converge to baseline errors only
(the pre-existing list above). Residue gets handled by Wave 2+ plans or a follow-up phase.

Verification: `pnpm typecheck 2>&1 | tail -30` post-merge reproduces only baseline rows.
