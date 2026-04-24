# Phase 01 — Deferred Items

Items discovered during execution that are out-of-scope for the current plan but tracked here for later resolution.

## From Plan 01-02 (worktree a881fca4)

### Typecheck errors from parallel sibling plans

Plan 01-02 was executed in a Wave 1 worktree in parallel with Plans 01-01 (schema rename + mapper update) and 01-03 (server spotdl deletion). `pnpm typecheck` cannot be green in isolation in this worktree because sibling changes are not present.

Remaining typecheck errors **NOT caused by plan 01-02's touched files** (owned by sibling plans or pre-existing):

- `src/components/ui/file-upload.tsx(16,22)` — broken import `@/components/ui` (pre-existing, unrelated to Phase 1).
- `src/modules/client/playlist/utils/mapper.ts(47,25)` — references `playlist.flags` (Plan 01-01's territory — mapper rewrite).
- `src/modules/server/playlist/functions.ts(162-166)` — `flags` field on update payload (Plan 01-03's territory — server fn schema trim).
- `src/modules/server/spotdl/functions.ts(76-119)` — `cookiesFile` mismatch (Plan 01-03's territory — entire directory deleted).
- `src/modules/server/spotdl/SpotdlInvocator.test.ts(237,10)` — unused `_result` (Plan 01-03's territory — file deleted).
- `src/routes/library.tsx(113,22)` — `PlaylistItem.id` optional vs required (pre-existing baseline — not a Plan 01-02 ripple).
- `src/modules/client/playlist/components/playlist-header.tsx(71,46)` — `formatSourceType(type: string)` vs narrowed `"playlist" | "album"` (caused by Plan 01-02's Task 1 narrowing; header is not in files_modified list, owned by Plan 01-01's component alignment work).
- `src/modules/client/playlist/components/playlist-header.tsx(72,42)` — `formatStatus(string)` vs narrowed status enum (pre-existing baseline).
- `src/modules/client/library/components/playlist-table.tsx(67,44)` — same `formatSourceType` narrowing as playlist-header.tsx line 71.
- `src/modules/client/library/components/playlist-table.tsx(71,46)` — same `formatStatus` issue as playlist-header.tsx line 72 (pre-existing baseline).
- `src/modules/client/playlist/schema/playlist.test.ts` — flags/spotifyTrack refs (Plan 01-02 Task 3 rewrites this file entirely).

**Resolution:** After Plans 01-01, 01-02, 01-03 merge together, `pnpm typecheck` should converge to 0 errors. If not, a follow-up plan in Wave 2 handles the residue.
