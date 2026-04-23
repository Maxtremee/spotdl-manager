# Phase 1: Schema reset & spotdl removal - Context

**Gathered:** 2026-04-23
**Status:** Ready for planning

<domain>
## Phase Boundary

Rip out the spotdl engine, introduce the new per-track data model, and clean-break wipe the database — so Phase 2+ builds on fresh ground. No replacement download engine lands in this phase; scheduler becomes a no-op stub. Spotify login CLI, scraping, matching, downloading, and per-track UI all belong to later phases.

</domain>

<decisions>
## Implementation Decisions

### Scheduler interim behavior
- **D-01:** Scheduler stays wired and ticks on its existing cron/interval schedule, but the sync body is a no-op — no scrape, no download, no work of any kind.
- **D-02:** Stub ticks emit `playlist.sync.started` and `playlist.sync.completed` via the existing event bus so the webhook + metrics + log handlers keep getting exercised and don't rot while Phase 3 is being built.
- **D-03:** Stub ticks do **not** create `invocations` rows. Events only, no DB writes. Sync history in the UI stays empty until a real engine lands — a correct reflection of reality, and avoids schema churn in the `invocations` table that Phase 3 will rework.
- **D-04:** Manual "sync now" button on library/playlist pages is **hidden** while no engine exists. Hide, not disable-with-tooltip. No dead affordances.

### DB wipe — clean break
- **D-05:** DB wipe on startup is **unconditional** for the phase-1 upgrade. No first-boot-detection marker, no schema version fingerprint, no one-shot flag. There are zero production instances — "just do it" per user. On boot of the new version, the legacy DB is dropped and recreated from the new schema.
- **D-06:** Implementation approach (delete `data/db.sqlite` vs drop/recreate tables) is Claude's discretion during planning — either achieves a clean schema. Preference toward whichever keeps the single-volume `/data` layout cleanest.
- **D-07:** **Requirement override — CLEANUP-03 "library reset notice":** Drop the notice entirely. No banner, no toast, no global_settings dismiss flag. User has no production users to inform. Success Criterion #4 of Phase 1 is amended: the one-time "library reset" notice is no longer required. DB wipe happens silently.

### Tracks table (Claude's discretion, with baseline)
- **D-08:** Use REQUIREMENTS.md TRACK-01 and TRACK-02 as the baseline contract — downstream planner implements exactly that, no extras beyond what later phases will need.
- **D-09:** State enum values are locked by TRACK-02: `pending | matched | downloaded | skipped_low_confidence | failed`.
- **D-10:** Unique key `(source_id, spotify_track_id)` is locked by TRACK-01. Any other indexes (e.g. on `state`, on `source_id`) are Claude's discretion based on query patterns Phase 3+ will introduce.

### playlists → sources (Claude's discretion)
- **D-11:** Whether to rename the `playlists` table to `sources`, adjust the `sourceType` enum (e.g. drop `"track"` since v1 is playlists + albums only), and add `slug` / `cover_art_url` columns is left to Claude during planning. Constraint: the `tracks` table's `source_id` FK must line up cleanly with whatever the table ends up called. Since we're clean-breaking the DB and there's no migration pressure, prefer the final shape over backward-compatible names.

### Flag column cleanup (Claude's discretion)
- **D-12:** `flagsOverwrite`, `flagsRetries`, `flagsQuality`, `flagsFormat` are all spotdl-engine concerns and have no meaning in the new pipeline. Drop them from the schema and from the playlist create/edit forms. MP3 is fixed for v1 per REQUIREMENTS.md "Out of Scope" (no format switching), so keeping `flagsFormat` "just in case" is not justified.
- **D-13:** The `spotdl` row in `global_settings` (key = `"spotdl"`) and the `SPOTDL_COOKIES_FILE` env var also go. Cookies settings form and server functions in `src/modules/server/spotdl/` are deleted outright.

### Claude's Discretion
- Exact DB wipe mechanism (file delete vs schema drop/recreate)
- Tracks table indexes beyond the required unique key
- Whether to rename `playlists` → `sources` in this phase or defer the rename
- Invocation table: only required change is the new engine dropping; whether to trim any now-unused columns is discretion
- Scheduler disable-vs-keep-wired at the `croner` level (both meet "tick but no-op" as long as the stub body short-circuits)

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-level decisions
- `.planning/PROJECT.md` — Core value, key decisions table (clean-break DB, rip spotdl entirely, per-track state model)
- `.planning/REQUIREMENTS.md` — All v1 requirements; Phase 1 maps to TRACK-01, TRACK-02, CLEANUP-01, CLEANUP-02, CLEANUP-03, CLEANUP-04
- `.planning/ROADMAP.md` §"Phase 1: Schema reset & spotdl removal" — Goal, depends-on, success criteria (note: SC #4 amended by D-07 above)
- `.planning/STATE.md` — Current position, phase 1 of 7

### Codebase maps (read before touching code)
- `.planning/codebase/ARCHITECTURE.md` — Module structure, client/server boundary
- `.planning/codebase/STRUCTURE.md` — File layout, where things live
- `.planning/codebase/CONVENTIONS.md` — Coding conventions used in repo
- `.planning/codebase/STACK.md` — Tech stack (Drizzle, SQLite, TanStack Start, Solid.js, PandaCSS, Ark UI)
- `.planning/codebase/INTEGRATIONS.md` — Event bus, Discord webhooks, scheduler wiring
- `.planning/codebase/CONCERNS.md` — Known issues, hot spots

### Repo guide
- `CLAUDE.md` — Claude-facing project guide: commands, architecture, patterns, event bus usage

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **Event bus** (`src/modules/server/events/`): Stub scheduler ticks emit `playlist.sync.started` / `playlist.sync.completed` through the existing bus — no new infrastructure needed. Handlers in `handlers.ts` (logging, metrics, failure notifications, duration warnings) all stay wired and keep running against stub payloads.
- **PlaylistScheduler** (`src/modules/server/scheduler/PlaylistScheduler.ts`): Keep the class; strip the `SpotdlRepository` + `SpotdlInvocator` imports and replace the sync body with a no-op that emits the two lifecycle events.
- **Global settings table** (`global_settings`): Stays in the new schema — future phases will use it for the match-duration-tolerance and concurrency settings (DOWNLOAD-04, MATCH-02).
- **Invocation repository** (`src/modules/server/invocation/`): Keep for Phase 3 to write into; no new rows during Phase 1 stub period.
- **Logger** (`src/logger.ts`): Use `Logger.get("SchedulerStub")` or similar for the no-op stub so it's clearly identifiable in logs.

### Established Patterns
- **Drizzle schema** (`src/modules/server/db/schema.ts`): Single-file schema, inferred types via `$inferSelect`/`$inferInsert`. New `tracks` table follows this pattern.
- **Migrations**: `drizzle/*.sql` exist but are irrelevant — clean break means regenerating migration state from scratch against the new schema.
- **Client/server boundary** (CLAUDE.md): Schema types exported from server; client references via types only. New `tracks` schema must preserve this.
- **Server functions**: `createServerFn` pattern with Zod `.inputValidator()`. Any new track-related server functions follow this.

### Integration Points
- **spotdl module deletion** (`src/modules/server/spotdl/`): Entire directory goes. `SpotdlInvocator`, `SpotdlInvocator.test.ts`, `SpotdlRepository`, `schema.ts`, `functions.ts` — all removed.
- **env.ts** (`src/env.ts:7`): Remove `SPOTDL_COOKIES_FILE` from the server schema.
- **Settings route** (`src/routes/settings.tsx`): Remove the `CookiesSettingsForm` import + render, remove the `getSpotdlSettingsServerFn` loader call, trim the `Promise.all` to webhook-only.
- **Settings client module** (`src/modules/client/settings/components/cookies-settings-form.tsx`): File deleted. Re-export from `index.ts` trimmed.
- **Create-playlist form** (`src/modules/client/playlist/schema/create-playlist-form.ts`): `enableAdvancedFlags`, `overwrite`, `retries`, `quality`, `format` fields all dropped. Source URL validation keeps only playlist + album (drop the `/track/` branch, since `sourceType: "track"` is gone).
- **Scheduler** (`src/modules/server/scheduler/PlaylistScheduler.ts:10-11, 23, 27, 33-36, 135, 306, 328`): All spotdl-specific wiring removed; sync body becomes event-emitting no-op.
- **Events examples** (`src/modules/server/events/examples.ts:132-136`): Comment referencing `spotdl_syncs_*` metrics updated or removed (cosmetic).

</code_context>

<specifics>
## Specific Ideas

- "For the db wipe — just do it, there's not a single prod instance" — user explicitly prioritizes simplicity over first-boot detection ceremony. The wipe is unconditional; no marker, no flag, no banner.
- Stub scheduler is deliberately noisy on the event bus (emits started + completed on every tick) even though it does no work — this keeps the downstream handlers (Discord webhook, metrics, duration warnings) warm and catches regressions in the integration layer before Phase 3 plugs in the real engine.

</specifics>

<deferred>
## Deferred Ideas

- **Library reset UI notice** (CLEANUP-03) — dropped for this milestone per user override. If the app ever gains other users, reintroduce as a backlog item.
- **Keeping `flagsFormat` for future format switching** — explicitly deferred: MP3-only is a v1 Out-of-Scope anchor; revisit in v2 under FMT2-01/FMT2-02 if format switching returns to scope.
- **`invocations` table simplification** — Phase 3 will rework this table's semantics (counts, summary shape) once the real engine exists; no preemptive churn in Phase 1.
- **Scheduler concurrency knob / stub-tick visibility in UI** — not needed while stub runs create no rows; revisit in Phase 3.

</deferred>

---

*Phase: 01-schema-reset-spotdl-removal*
*Context gathered: 2026-04-23*
