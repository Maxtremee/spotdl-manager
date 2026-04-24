# Phase 1 Deferred Items — Pre-existing TypeScript Errors

Logged by plan 01-01 worktree. These typecheck errors existed at
commit `88c8b34` (Phase 1 wave-1 base) BEFORE this plan touched any file.
They are out of scope per the `SCOPE BOUNDARY` rule and are left for the
plan that owns each file.

| File | Line | Error | Likely owner plan |
|------|------|-------|-------------------|
| src/components/ui/file-upload.tsx | 16 | `Cannot find module '@/components/ui'` — alias mismatch | UI scaffolding (out of Phase 1 scope) |
| src/modules/client/library/components/playlist-table.tsx | 67, 71 | `string` not assignable to `"playlist"\|"album"\|"track"` / status enum — rendering helper parameter typing | Plan 01-02 (client schema trim) |
| src/modules/client/playlist/components/playlist-header.tsx | 71, 72 | Same as above | Plan 01-02 |
| src/modules/server/spotdl/functions.ts | 76, 102, 104, 106, 111, 119 | `cookiesFile` property missing on `SpotdlSettings` type — pre-existing spotdl refactor drift | Plan 01-03 (spotdl directory deletion) |
| src/modules/server/spotdl/SpotdlInvocator.test.ts | 237 | `'_result' is declared but its value is never read` | Plan 01-03 |
| src/routes/library.tsx | 113 | `PlaylistItem` id required vs optional on mapped row | Plan 01-02 or downstream |
| src/routes/library_.$playlistId.tsx | 123 | `PlaylistSchedule \| null` vs `undefined` | Plan 01-02 or downstream |

Verification: `git stash && pnpm typecheck 2>&1 | tail -30 && git stash pop`
against HEAD `88c8b34` reproduces every row above.
