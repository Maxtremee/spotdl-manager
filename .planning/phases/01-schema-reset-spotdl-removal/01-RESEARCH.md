# Phase 1: Schema reset & spotdl removal - Research

**Researched:** 2026-04-23
**Domain:** Drizzle/SQLite schema reset, feature-flag rip, event-bus-only scheduler stub, form/UI purge
**Confidence:** HIGH

## Summary

Phase 1 is almost entirely a deletion/replacement phase with one additive element (the `tracks` table). The stack is already locked — Solid.js + TanStack Start + Drizzle/SQLite + croner + pino — and every technique this phase needs is already in use somewhere in the repo. Research confirms that the clean-break DB wipe is best implemented by deleting the `data/db.sqlite` file before Drizzle opens it (the `getDb()` singleton lazy-initializes on first query, so wiping the file before any server code touches it is safe), then letting the existing `pnpm db:push` machinery recreate everything from the new schema on dev startup, and letting `drizzle-kit push` run on first boot in container (or equivalently deleting the drizzle/*.sql migrations and regenerating). The `tracks` table follows the existing timestamp/enum/uniqueness idioms already present in `playlists` and `invocations`. The scheduler stub is a trivial transformation: keep `schedulePlaylist()` / `initialize()` / `reload()` / `shutdown()` intact, replace the body of `executePlaylistSync()` with two event emits and a brief sleep, and drop every `Spotdl*` import.

The biggest non-obvious risks are (a) `drizzle/0000_*.sql` and `drizzle/meta/_journal.json` must be deleted atomically with the schema change or `drizzle-kit push` will try to diff against stale snapshots, (b) the `Promise.allSettled` contract in `EventBus.emit` means a stub emitting malformed payloads won't crash the scheduler but will silently log through `console.error` — so the payloads must validate against the existing Zod schemas exactly, (c) the test suite contains deep spotdl-module mocks (`PlaylistScheduler.test.ts`, `SpotdlInvocator.test.ts`, `playlist.test.ts`) that will break hard unless rewritten or deleted as part of this phase.

**Primary recommendation:** Do the full rename `playlists` → `sources` and drop the `"track"` source-type enum variant in this phase. The codebase is clean-breaking anyway (no user data, no migration obligation), so paying the rename cost once now is cheaper than threading two names through Phases 2-7 when `tracks` starts being queried alongside its parent `source`. The `tracks.source_id` foreign key lines up naturally with the new name.

## User Constraints (from CONTEXT.md)

### Locked Decisions

**Scheduler interim behavior**
- **D-01:** Scheduler stays wired and ticks on its existing cron/interval schedule, but the sync body is a no-op — no scrape, no download, no work of any kind.
- **D-02:** Stub ticks emit `playlist.sync.started` and `playlist.sync.completed` via the existing event bus so the webhook + metrics + log handlers keep getting exercised and don't rot while Phase 3 is being built.
- **D-03:** Stub ticks do **not** create `invocations` rows. Events only, no DB writes. Sync history in the UI stays empty until a real engine lands — a correct reflection of reality, and avoids schema churn in the `invocations` table that Phase 3 will rework.
- **D-04:** Manual "sync now" button on library/playlist pages is **hidden** while no engine exists. Hide, not disable-with-tooltip. No dead affordances.

**DB wipe — clean break**
- **D-05:** DB wipe on startup is **unconditional** for the phase-1 upgrade. No first-boot-detection marker, no schema version fingerprint, no one-shot flag. There are zero production instances — "just do it" per user. On boot of the new version, the legacy DB is dropped and recreated from the new schema.
- **D-07:** **Requirement override — CLEANUP-03 "library reset notice":** Drop the notice entirely. No banner, no toast, no global_settings dismiss flag. User has no production users to inform. Success Criterion #4 of Phase 1 is amended: the one-time "library reset" notice is no longer required. DB wipe happens silently.

**Tracks table (baseline contract locked)**
- **D-08:** Use REQUIREMENTS.md TRACK-01 and TRACK-02 as the baseline contract — downstream planner implements exactly that, no extras beyond what later phases will need.
- **D-09:** State enum values are locked by TRACK-02: `pending | matched | downloaded | skipped_low_confidence | failed`.
- **D-10:** Unique key `(source_id, spotify_track_id)` is locked by TRACK-01.

**Flag column cleanup**
- **D-12:** `flagsOverwrite`, `flagsRetries`, `flagsQuality`, `flagsFormat` are all spotdl-engine concerns and have no meaning in the new pipeline. Drop them from the schema and from the playlist create/edit forms. MP3 is fixed for v1.
- **D-13:** The `spotdl` row in `global_settings` (key = `"spotdl"`) and the `SPOTDL_COOKIES_FILE` env var also go. Cookies settings form and server functions in `src/modules/server/spotdl/` are deleted outright.

### Claude's Discretion

- **D-06:** Exact DB wipe mechanism (file delete vs schema drop/recreate) — see "Architecture Patterns → DB Wipe" below for the recommended approach.
- **D-10 (partial):** Indexes on the `tracks` table beyond the required `(source_id, spotify_track_id)` unique key.
- **D-11:** Whether to rename `playlists` → `sources`, adjust the `sourceType` enum (drop `"track"`), and add `slug` / `cover_art_url` columns. Constraint: the `tracks` table's `source_id` FK must line up with the final table name. User explicitly said: "prefer the final shape over backward-compatible names" since there's no migration pressure.
- Invocation table: trim any now-unused columns if helpful; no columns are strictly required to change in Phase 1.
- Scheduler disable-vs-keep-wired at the `croner` level — both meet "tick but no-op" as long as the stub body short-circuits.

### Deferred Ideas (OUT OF SCOPE)

- **Library reset UI notice (CLEANUP-03)** — dropped per user override. Out of scope.
- **Keeping `flagsFormat` for future format switching** — explicitly deferred; MP3-only is a v1 Out-of-Scope anchor.
- **`invocations` table simplification** — Phase 3 will rework this table's semantics; no preemptive churn in Phase 1.
- **Scheduler concurrency knob / stub-tick visibility in UI** — not needed while stub runs create no rows; revisit in Phase 3.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TRACK-01 | `tracks` table keyed uniquely by `(source_id, spotify_track_id)` | Drizzle `unique()` composite constraint — Standard Stack + Code Examples below. Source column name depends on whether `playlists` is renamed to `sources` (D-11). |
| TRACK-02 | Track rows store: title, artist, duration_ms, state (`pending\|matched\|downloaded\|skipped_low_confidence\|failed`), yt_video_id, download_path, failure_reason, position, created_at, updated_at | Field types + timestamp pattern locked by existing `playlists`/`invocations` idiom (integer unixepoch). State enum uses Drizzle `text({ enum: [...] })` — Code Examples below. |
| CLEANUP-01 | Remove `SpotdlInvocator`, `SpotdlRepository`, and all spotdl CLI wiring from server code | Complete file-deletion list in "Runtime State Inventory" below. Scheduler refactor in "Architecture Patterns → Scheduler stub". |
| CLEANUP-02 | Remove spotdl-specific schema columns (flag toggles, cookies settings) and `SPOTDL_COOKIES_FILE` env var | `flags*` columns in `src/modules/server/db/schema.ts:17-30`; env var at `src/env.ts:7`; `SpotdlSettingsSchema` at `src/modules/server/spotdl/schema.ts`. |
| CLEANUP-03 | Drop / recreate DB on first boot (clean-break reset); library-reset notice | NOTICE PORTION DROPPED per D-07. DB wipe only — see "Architecture Patterns → DB Wipe" below. |
| CLEANUP-04 | Remove spotdl-specific UI: flag form sections, cookies checkbox, any routes/components only used by old engine | File list in "Runtime State Inventory → Build artifacts / Client bundle surface". |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| DB schema definition | Server / DB layer | — | Drizzle single-file schema at `src/modules/server/db/schema.ts` — convention already established. |
| Clean-break DB wipe | Server bootstrap (Nitro plugin) | — | Must run before any repository opens the SQLite file — server/plugins ordering slot. |
| Tracks table writes (Phase 3+) | Server / repository | — | Future feature — Phase 1 only defines the table, no writes yet. |
| Scheduler tick (no-op) | Server / scheduler | Event bus | `PlaylistScheduler` owns cron registration; the tick body emits through the existing bus. |
| Webhook / metrics / logging handlers | Server / event bus | — | Already registered in `server/plugins/events.ts`; stub ticks keep them exercised. |
| Create-playlist form (flag removal) | Client / playlist feature | — | `src/modules/client/playlist/schema/create-playlist-form.ts` + `components/advanced-flags-section.tsx`. |
| Playlist detail config card (flag/format/quality removal) | Client / playlist feature | — | `src/modules/client/playlist/components/playlist-config-card.tsx` — format/quality selects go, status stays. |
| Settings route (cookies form removal) | Route layer | Client / settings feature | `src/routes/settings.tsx` loader trim + `CookiesSettingsForm` delete. |
| Env var removal | Server bootstrap | — | `src/env.ts` — drop `SPOTDL_COOKIES_FILE`. |
| "Run Now" button hiding (D-04) | Client / playlist feature | — | Hide the `<Button>` with the `PlayIcon` in `playlist-config-card.tsx:50-58`. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `drizzle-orm` | 0.45.1 (installed) / 0.45.2 (latest) | SQLite schema definition + queries | Already in use across every repository file. Composite unique constraints via `unique().on(...)` and indexes via `index().on(...)` / `uniqueIndex().on(...)`. [VERIFIED: npm view drizzle-orm version] |
| `drizzle-kit` | 0.31.8 (installed) / 0.31.10 (latest) | `drizzle-kit push` and `generate` | Already wired via `package.json` scripts `db:push` / `db:generate`. `push` directly syncs schema to DB — the right tool for clean-break since there's no migration history to preserve. [VERIFIED: Context7 /drizzle-team/drizzle-orm-docs — "`drizzle-kit push` lets you push your Drizzle schema to database"] |
| `better-sqlite3` | 12.6.0 (installed) / 12.9.0 (latest) | Synchronous SQLite driver | Used by Drizzle driver at `src/modules/server/db/index.ts:12`. [VERIFIED: npm view better-sqlite3 version] |
| `croner` | 9.1.0 (installed) / 10.0.1 (latest) | Cron scheduling | Currently used for `new Cron(expr, async () => {...})` in `PlaylistScheduler.ts:261`. Stub can keep the same wiring — just replace the callback body. [VERIFIED: npm view croner version; Context7 /hexagon/croner confirms `pause()` / `stop()` semantics if ever needed] |
| `zod` | 4.3.5 (installed) / 4.3.6 (latest) | Event payload + schema validation | Used everywhere. Stub event emits must conform to existing `PlaylistSyncStartedEventSchema` / `PlaylistSyncCompletedEventSchema` — which both require a **positive** `duration` on completion. [VERIFIED: `src/modules/server/events/schema.ts:34`] |
| `vitest` | 4.0.16 | Test framework | Existing test runner. Phase 1 rewrites (or deletes) `PlaylistScheduler.test.ts`, `SpotdlInvocator.test.ts`, `playlist.test.ts`. |

**Version verification:** All installed versions are ≤1 minor release behind npm latest; no upgrade required for Phase 1. [VERIFIED: npm registry lookups 2026-04-23]

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `drizzle-orm/sqlite-core` | (same as drizzle-orm) | `sqliteTable`, `integer`, `text`, `unique`, `index`, `uniqueIndex` | All schema definitions. Keep the existing import style. |
| `@tanstack/solid-form` | 1.27.7 | Form state for create-playlist + settings | Existing pattern — the Phase 1 work is trimming fields, not replacing the library. |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `drizzle-kit push` on every boot | Explicit `drizzle-kit generate` + `migrate` applied at startup | `push` is simpler for a personal tool with clean-break semantics; `migrate` is preferred when you need a versioned audit trail of schema changes. For Phase 1 (one-shot clean break, zero prod instances), `push` is the right choice — the user's explicit direction is "no ceremony". [CITED: Drizzle FAQ "`push` is primarily recommended for local development and local databases"] |
| File-delete `data/db.sqlite` on boot | `drizzle-seed` reset (`PRAGMA foreign_keys = OFF; DELETE FROM ...`) | File-delete is cleaner when the schema itself has changed (new columns, dropped columns, renamed tables) — which is exactly the Phase 1 case. `DELETE FROM` only clears rows; it doesn't alter table structure. Since we need both, file-delete wins. [CITED: Drizzle seed-overview.mdx documents the `PRAGMA foreign_keys = OFF; DELETE FROM ...` pattern for row-only resets] |
| Keep `playlists` table name | Rename to `sources` | Rename is a one-time cost in Phase 1 (all references live in a handful of files — see "Runtime State Inventory → Stored data"). Keeping the name pollutes Phase 3+ queries (`tracks.source_id → playlists.id` reads wrong). User already gave discretion + preference toward final shape. Recommendation: rename. |

**Installation:** No new packages needed. `pnpm install` only if any dep gets upgraded — not required for Phase 1 since installed versions all work.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│ Nitro boot sequence (server startup)                            │
└─────────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌─────────────────┐   (NEW Phase 1) runs BEFORE every plugin
  │ db-reset plugin │──► unlink data/db.sqlite if present
  └─────────────────┘       │
         │                  ▼
         ▼            drizzle-kit push  (or first getDb() triggers
                                         fresh schema via push target)
         │
         ▼
  ┌─────────────────┐
  │ events plugin   │──► registerLoggingHandler, MetricsHandler,
  └─────────────────┘     SchedulerReloadHandler, SyncDurationWarning,
         │                 DiscordWebhookHandler   (all unchanged)
         ▼
  ┌─────────────────┐
  │scheduler plugin │──► getScheduler().initialize()
  └─────────────────┘       │
                            ▼
                      For each playlist(scheduleEnabled=true):
                        new Cron(expr, async () => stubTick(playlist))
                                           │
                                           ▼
                              ┌─────────────────────────┐
                              │ stubTick (Phase 1 stub) │
                              ├─────────────────────────┤
                              │ bus.emit(sync.started)  │──► Discord
                              │ // no work, no DB write │    webhook
                              │ await sleep(N ms)       │    Metrics
                              │ bus.emit(sync.completed)│──► DurationWarn
                              └─────────────────────────┘    Logging

┌─────────────────────────────────────────────────────────────────┐
│ HTTP request path (users browsing UI)                           │
└─────────────────────────────────────────────────────────────────┘
  Browser ──► /library          ──► listPlaylistsServerFn
                                    ──► PlaylistRepository.listPlaylists
                                        (queries renamed 'sources' table)
  Browser ──► /library/$id      ──► getPlaylistDetailsServerFn
                                    (same repo; config card no longer
                                     renders format/quality/retries/
                                     overwrite fields; Run Now hidden)
  Browser ──► /library/add      ──► createPlaylistServerFn
                                    (no flags object in the payload)
  Browser ──► /settings         ──► getWebhookSettingsServerFn only
                                    (no getSpotdlSettingsServerFn —
                                     that file is deleted)
```

### Recommended Project Structure (Phase 1 end state)

```
src/
├── modules/
│   ├── client/
│   │   ├── playlist/
│   │   │   ├── schema/
│   │   │   │   ├── playlist.ts        ← trimmed: no PlaylistFlagsSchema; source enum drops "track"
│   │   │   │   └── create-playlist-form.ts  ← trimmed: no flag fields, no /track/ URL branch
│   │   │   ├── components/
│   │   │   │   ├── playlist-config-card.tsx  ← no Format/Quality selects; no "Run Now" btn
│   │   │   │   ├── advanced-flags-section.tsx  ← DELETED
│   │   │   │   └── (rest unchanged)
│   │   │   ├── service/
│   │   │   │   ├── options.ts         ← drop formatOptions, qualityOptions
│   │   │   │   ├── playlist.ts        ← drop "track" case from formatSourceType
│   │   │   │   └── playlist-actions.ts  ← drop updateFormat, updateQuality
│   │   │   └── utils/
│   │   │       └── mapper.ts          ← drop flags object from rowToPlaylist / playlistToRow
│   │   └── settings/
│   │       ├── index.ts               ← drop CookiesSettingsForm export
│   │       └── components/
│   │           └── cookies-settings-form.tsx  ← DELETED
│   └── server/
│       ├── db/
│       │   ├── schema.ts              ← renamed playlists→sources; new tracks table; drop flags*
│       │   ├── index.ts               ← unchanged
│       │   └── seed.ts                ← drop flags fields; drop "track" sourceType; optional new tracks seeds
│       ├── scheduler/
│       │   ├── PlaylistScheduler.ts   ← strip spotdl imports; replace sync body with event emits
│       │   └── PlaylistScheduler.test.ts  ← rewritten for stub behavior
│       ├── playlist/
│       │   ├── repository.ts          ← renamed refs: schema.playlists → schema.sources
│       │   └── functions.ts           ← drop flags from updatePlaylistInputSchema; no /track/ URL detection
│       └── spotdl/                    ← ENTIRE DIRECTORY DELETED
server/
└── plugins/
    ├── db-reset.ts                    ← NEW: deletes data/db.sqlite on startup
    ├── events.ts                      ← unchanged
    └── scheduler.ts                   ← unchanged (scheduler singleton still initializes)
drizzle/                               ← regenerated: single fresh migration
├── 0000_<new-name>.sql                ← sources + tracks + invocations + global_settings
└── meta/
    └── _journal.json                  ← fresh journal
src/
└── env.ts                             ← drop SPOTDL_COOKIES_FILE
```

### Pattern 1: DB Wipe (file delete before first connection)

**What:** A Nitro startup plugin `server/plugins/db-reset.ts` registered **first** in `vite.config.ts` → `nitro({ plugins: [...] })`, ahead of `events.ts` and `scheduler.ts`. It synchronously deletes `data/db.sqlite` (if present) before any other plugin runs, then exits. Next access via `getDb()` opens a fresh DB file; `drizzle-kit push` (run by `pnpm dev` before `vite dev`) or a `drizzle-kit push` call at container start creates the schema.

**When to use:** Phase 1 unconditional wipe. This is the only phase that needs it — after Phase 1 ships, the plugin is **deleted** (a wipe-every-boot plugin would destroy runtime state forever).

**Why file-delete beats `DROP TABLE`:** The schema shape itself changed (new `tracks` table, renamed `playlists` → `sources`, dropped `flags*` columns). Row-level `DELETE FROM` wouldn't change the columns. `drizzle-kit push` applied against a legacy DB with old columns will prompt interactively and confuse container startup. Starting from an empty file side-steps all that. [VERIFIED: Drizzle docs show `DELETE FROM` as a row-reset pattern only; schema change requires regeneration]

**Example:**
```typescript
// server/plugins/db-reset.ts — PHASE 1 ONLY — delete at end of phase
// Source: existing plugin pattern at server/plugins/scheduler.ts
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { NitroApp } from "nitro/types";
import { Logger } from "../../src/logger";

const DB_PATH = path.resolve(process.cwd(), "data", "db.sqlite");

export default (_nitroApp: NitroApp) => {
	const logger = Logger.get("DbReset");
	if (existsSync(DB_PATH)) {
		unlinkSync(DB_PATH);
		logger.warn({ path: DB_PATH }, "Legacy DB deleted — clean-break reset");
	} else {
		logger.info("No legacy DB present; clean slate");
	}
};
```

Note: the plugin deletes the file *synchronously* so downstream plugins see a missing file, not a half-deleted one. `better-sqlite3` will open a fresh file when `getDb()` is first called; the Drizzle-Kit `push` invoked by `pnpm dev`'s `db:push` pre-step (or `pnpm db:push` at container boot) applies the new schema.

**Container startup ordering:** `pnpm start` in production runs `node .output/server/index.mjs` — this does NOT invoke `drizzle-kit push`. Dev mode does (see `package.json:6` `pnpm dev: "pnpm run db:push && vite dev"`). For container production, add a Dockerfile `CMD` or entrypoint that runs `drizzle-kit push` before `node .output/server/index.mjs`. Since Phase 7 will rework the Docker image, leave a note for Phase 7 rather than pre-work the Dockerfile now. For Phase 1 dev validation, `pnpm db:push` already runs as part of `pnpm dev`, so the dev loop is covered.

### Pattern 2: tracks table (exact shape)

**What:** New `sqliteTable("tracks", {...})` in `src/modules/server/db/schema.ts`, following the established idioms:
- Timestamps: `integer("created_at", { mode: "timestamp" }).notNull().default(sql\`(unixepoch())\`)`
- Enum via `text("state", { enum: [...] }).default("pending").notNull()`
- Composite unique constraint via the `(t) => [unique().on(t.sourceId, t.spotifyTrackId)]` callback form — matches the Drizzle docs pattern exactly. [VERIFIED: Context7 /drizzle-team/drizzle-orm-docs "Define SQLite Unique Constraints in DrizzleORM"]

**When to use:** The canonical track-state contract for Phase 3+ (scrape → match → download pipeline). Phase 1 defines the table; Phase 3 starts writing to it.

**Example:**
```typescript
// src/modules/server/db/schema.ts (added after sources table)
// Source: Drizzle sqlite-core docs + existing schema.ts timestamp idiom
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const tracks = sqliteTable(
	"tracks",
	{
		id: text("id").primaryKey().notNull(),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		spotifyTrackId: text("spotify_track_id").notNull(),
		title: text("title").notNull(),
		artist: text("artist").notNull(),
		durationMs: integer("duration_ms").notNull(),
		state: text("state", {
			enum: [
				"pending",
				"matched",
				"downloaded",
				"skipped_low_confidence",
				"failed",
			],
		})
			.default("pending")
			.notNull(),
		ytVideoId: text("yt_video_id"),
		downloadPath: text("download_path"),
		failureReason: text("failure_reason"),
		position: integer("position").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		unique("tracks_source_spotify_unique").on(t.sourceId, t.spotifyTrackId),
		// Claude's discretion indexes (D-10) — justified by Phase 3+ query shapes:
		index("tracks_source_id_idx").on(t.sourceId),   // detail page: list all tracks per source
		index("tracks_state_idx").on(t.state),          // retry path: list all non-downloaded tracks
	],
);

export type TrackRow = typeof tracks.$inferSelect;
export type NewTrackRow = typeof tracks.$inferInsert;
```

**Index rationale (D-10 discretion):**
- `(source_id)` index: Phase 5's detail page (TRACK-03) queries `WHERE source_id = ? ORDER BY position`. Without the index, this is a full scan.
- `(state)` index: Phase 5's auto-retry (TRACK-05) queries `WHERE state IN ('pending', 'skipped_low_confidence', 'failed')`. Candidate pool is the whole library.
- Composite `(source_id, state)` index: **not** added — redundant with single-column `source_id` index for small libraries (<1000 tracks per source). Revisit in Phase 5 if query plans show it helping.

### Pattern 3: sources table (renamed from playlists) — recommended

**What:** Rename `playlists` → `sources` in `src/modules/server/db/schema.ts`. Drop the `"track"` variant from the source-type enum (v1 only covers playlists + albums per REQUIREMENTS.md SCRAPE-01 and SCRAPE-02). Drop all four `flags*` columns. Keep `schedule*` + `status` + timestamps + output_dir + source_url + name unchanged.

**When to use:** Recommended strongly for Phase 1 since (a) the rename surface is small (the `PlaylistRow` type is imported in ~7 files; the table name `schema.playlists` is referenced in ~12 places), (b) Phase 3+ queries will read awkwardly if tracks.source_id → playlists.id, and (c) the user explicitly said "prefer the final shape since clean break" (D-11).

**Cover-art URL + slug:** v2 per D-11 discretion. Research recommendation: add `coverArtUrl: text("cover_art_url")` (nullable) in this phase since Phase 3 DOWNLOAD-02 embeds cover art in ID3 tags and SCRAPE-07 captures it — having the column ready avoids a schema churn in Phase 3. Skip `slug` for Phase 1 — slug generation is a Phase 3 DOWNLOAD-03 concern; premature to model it now.

**Example:**
```typescript
// src/modules/server/db/schema.ts — renamed + trimmed
export const sources = sqliteTable("sources", {
	id: text("id").primaryKey().notNull(),
	name: text("name").notNull(),
	sourceType: text("source_type", {
		enum: ["playlist", "album"],    // "track" dropped
	}).notNull(),
	sourceUrl: text("source_url").notNull(),
	outputDir: text("output_dir").notNull(),
	coverArtUrl: text("cover_art_url"),  // nullable; populated in Phase 3
	// schedule fields unchanged
	scheduleEnabled: integer("schedule_enabled", { mode: "boolean" })
		.default(false)
		.notNull(),
	scheduleType: text("schedule_type", { enum: ["cron", "interval"] })
		.default("interval")
		.notNull(),
	scheduleCron: text("schedule_cron"),
	scheduleMinutes: integer("schedule_minutes").default(1440),
	status: text("status", { enum: ["active", "paused", "archived", "error"] })
		.default("active")
		.notNull(),
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

export type SourceRow = typeof sources.$inferSelect;
export type NewSourceRow = typeof sources.$inferInsert;
```

### Pattern 4: Scheduler stub (event-emitting no-op)

**What:** Strip the `SpotdlRepository`/`SpotdlInvocator` imports from `src/modules/server/scheduler/PlaylistScheduler.ts`. Keep class structure, `tasks` map, `runningPlaylists` set, `schedulePlaylist`, `unschedulePlaylist`, `initialize` (minus `loadSpotdlSettings` call), `reload`, `shutdown` untouched. Replace the body of `executePlaylistSync` with: emit `playlist.sync.started`, short sleep, emit `playlist.sync.completed` with zero-ish payload. Do **not** create invocation rows (D-03).

**When to use:** Exactly this phase. Phase 3's planner will re-introduce the real sync body alongside the new engine.

**Payload constraints (from event schema validation):**
- `PlaylistSyncStartedEventSchema` (`src/modules/server/events/schema.ts:14-23`) requires: `playlistId`, `playlistName`, `invocationId` (UUID format), `sourceUrl`, `outputDir`. **All strings.** `invocationId` must be a valid UUID — generate via `randomUUID()`.
- `PlaylistSyncCompletedEventSchema` (`schema.ts:28-40`) requires: `playlistId`, `playlistName`, `invocationId` (UUID), **`duration: z.number().positive()`** (cannot be 0 or negative — must be positive), `exitCode: z.number()`; optional `summary`, `logPath`, `syncFilePath`.

**Critical catch:** `duration` must be **positive**. A stub that emits immediately with `duration: 0` will fail Zod validation when handlers re-parse. Emit a small measured duration (e.g., `Date.now() - started`) or a hardcoded `1`. Wrapping the emit in a tiny `await setTimeout(1)` also works and is honest ("we ticked, we finished").

**Example:**
```typescript
// src/modules/server/scheduler/PlaylistScheduler.ts — stub body of executePlaylistSync
// Source: existing executePlaylistSync structure at PlaylistScheduler.ts:84-233, trimmed
private async executePlaylistSync(playlist: SourceRow): Promise<void> {
	if (this.runningPlaylists.has(playlist.id)) {
		this.logger.warn(
			{ playlistId: playlist.id, playlistName: playlist.name },
			"Source is already running (stub), skipping",
		);
		return;
	}
	this.runningPlaylists.add(playlist.id);
	const invocationId = randomUUID();
	const startedAt = Date.now();
	const eventBus = getEventBus();

	try {
		await eventBus.emit({
			type: "playlist.sync.started",
			payload: {
				playlistId: playlist.id,
				playlistName: playlist.name,
				invocationId,
				sourceUrl: playlist.sourceUrl,
				outputDir: playlist.outputDir,
			},
		});

		this.logger.info(
			{ playlistId: playlist.id, playlistName: playlist.name },
			"Scheduler stub tick — no engine attached (Phase 1)",
		);

		// No work, no DB write (D-03)
		const duration = Math.max(1, Date.now() - startedAt);

		await eventBus.emit({
			type: "playlist.sync.completed",
			payload: {
				playlistId: playlist.id,
				playlistName: playlist.name,
				invocationId,
				duration,
				exitCode: 0,
				summary: "Phase 1 stub — no engine",
			},
		});
	} finally {
		this.runningPlaylists.delete(playlist.id);
	}
}
```

Note: `triggerManualSync()` stays on the class (it's called by `triggerPlaylistSyncServerFn`), but since the "Run Now" button is hidden (D-04), it will never be reached via UI. Leave the server fn + method intact so Phase 3 can re-light them.

### Pattern 5: Create-playlist form trim

**What:** Drop `enableAdvancedFlags`, `overwrite`, `retries`, `quality`, `format` fields from `CreatePlaylistFormSchema`. Drop the `/track/` branch from the `sourceUrl.refine()` check and from `detectSourceType`. Remove `AdvancedFlagsSection` import + render from `src/routes/library_.add.tsx`. Delete `src/modules/client/playlist/components/advanced-flags-section.tsx`.

**When to use:** Required by CLEANUP-04 + D-12.

### Anti-Patterns to Avoid

- **Leaving `drizzle/0000_*.sql` in place while changing the schema.** The drizzle-kit journal at `drizzle/meta/_journal.json` will think the old migrations are applied; the next `db:generate` may produce an incremental ALTER-column migration instead of a fresh CREATE-TABLE. Delete the entire `drizzle/*.sql` + `drizzle/meta/*.json` directory and regenerate with `pnpm db:generate` once the new schema compiles.
- **Emitting `playlist.sync.completed` with `duration: 0`.** The Zod schema requires `positive()`. The event bus invokes handlers inside `Promise.allSettled` + `safeInvoke` (try/catch + `console.error`) — the emit won't crash the scheduler, but handlers that re-parse the payload will log "Handler failed for event" errors to console and silently drop the event for any downstream consumer. Use `duration: Math.max(1, elapsed)`.
- **Keeping `SpotdlRepository` around as a "future reference".** Dead code will fail typecheck once `src/env.ts` drops `SPOTDL_COOKIES_FILE` (the invocator references `this.env.SPOTDL_COOKIES_FILE` on `SpotdlInvocator.ts:76`). Delete the entire directory in one sweep.
- **Deleting `data/db.sqlite` after Drizzle has opened it.** `better-sqlite3` holds an open file handle; deleting the file while Drizzle owns it leaves a zombie state. The db-reset plugin must run **before** any plugin that touches `getDb()`. Register it first in `vite.config.ts` `nitro({ plugins: [...] })` and don't call `getDb()` from within it.
- **Implementing the scheduler stub as "don't register the cron at all".** User wants ticks so downstream handlers stay warm (D-02). Register the cron; short-circuit the body.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Emit an event | Manual handler dispatch | `getEventBus().emit({...})` with existing Zod payloads | Existing pattern; `EventBus.emit` enriches with `id`+`timestamp` and fans out via `Promise.allSettled` with per-handler error isolation. |
| Detect "first boot" / schema version | Marker file, fingerprint table, migration version column | Unconditional file-delete (D-05) | Explicitly out of scope. "Just do it" per user. |
| Generate UUIDs | `Date.now().toString()` or custom logic | `randomUUID()` from `node:crypto` | Used throughout existing code (`invocation/repository.ts`, `EventBus.ts`). Event schemas enforce UUID v4 format. |
| Drop & recreate tables in SQL | Raw `DROP TABLE` statements | `drizzle-kit push` after file delete | `drizzle-kit push` reads the schema source of truth and handles dependency order. |
| Composite uniqueness in SQLite | Hand-written `CREATE UNIQUE INDEX` | `unique().on(t.a, t.b)` in Drizzle schema | Drizzle translates to the right SQL per dialect; also provides typed error handling. |
| Track retention / cleanup of old logs | New cron job or cleanup script | Existing `registerLogCleanupHandler` in `src/modules/server/events/handlers.ts` | Not needed for Phase 1 (no logs generated by stub), but the pattern exists for Phase 3+. |

**Key insight:** Every mechanism this phase needs is already present in the codebase. The phase is ~70% deletion, ~20% surgical renames, ~10% additive (`tracks` table + one bootstrap plugin). Introducing any new library or pattern would be overshoot.

## Runtime State Inventory

Phase 1 is a refactor/rename phase. Every category below must be addressed explicitly.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| **Stored data** | `data/db.sqlite` (legacy schema: `playlists` with `flags_*` columns; `invocations` unchanged; `global_settings` with `spotdl` key). `data/data.db` also present (legacy). `data/sync/` dir (spotdl sync files) still exists but empty. | File-delete `data/db.sqlite` on boot via `server/plugins/db-reset.ts` (Pattern 1). Recommend also deleting `data/data.db` as stale. Delete `data/sync/` directory contents — no longer referenced. |
| **Live service config** | None. No external services (Datadog, n8n, Tailscale, Cloudflare Tunnel) embed "spotdl" or "playlists"-table-name strings. Discord webhook URL is stored in DB (`global_settings.discord_webhook`) — the DB wipe will clear it; user must reconfigure webhook after Phase 1 boot. | **None automated** — but note: Discord webhook settings in DB will be cleared by the wipe. User reconfigures via `/settings` page post-upgrade. Acceptable given "no production users" (D-05). |
| **OS-registered state** | None. No Windows Task Scheduler / launchd / systemd / pm2 registrations reference spotdl or table names. Scheduler tasks are in-process `croner` instances owned by the Node process — they vanish when the process restarts and are rebuilt from the DB on boot. | None. |
| **Secrets / env vars** | `SPOTDL_COOKIES_FILE` in `src/env.ts:7` and (optionally) in `.env` / `.env.example` / `docker-compose.yml` env block. Code that reads it: `src/modules/server/spotdl/SpotdlInvocator.ts:76`. | Remove from `src/env.ts`. Grep `.env`, `.env.example`, `.env.sample`, `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`, `Dockerfile.dev` and strip any `SPOTDL_COOKIES_FILE` references. (Verified `docker-compose.yml`/`.prod.yml` don't set it; still worth a final grep.) [VERIFIED: grep against `src/` `server/` only finds the one reference in env.ts + SpotdlInvocator.ts which is being deleted] |
| **Build artifacts / installed packages / generated files** | `drizzle/0000_lonely_justin_hammer.sql`, `drizzle/0001_charming_the_hood.sql`, `drizzle/0002_fine_zombie.sql`, `drizzle/meta/_journal.json`, `drizzle/meta/0000_snapshot.json`, `drizzle/meta/0001_snapshot.json`, `drizzle/meta/0002_snapshot.json`. Also `.output/` (nitro build) and `.tanstack/` (TanStack cache). `styled-system/` (PandaCSS codegen) — unaffected since no theme changes. `src/routeTree.gen.ts` — will regenerate when routes change (but routes structure is unchanged; only route file contents). | Delete entire `drizzle/` contents (but keep the directory itself). Run `pnpm db:generate` against the new schema to create a single fresh `0000_*.sql`. `.output/` and `.tanstack/` rebuild on next build; no action needed. `src/routeTree.gen.ts` — no action, Vite plugin regenerates on dev/build. |

**Exhaustive file-modify / file-delete list** (derived from grep passes above):

**DELETE (entire file or directory):**
- `src/modules/server/spotdl/` — entire directory (5 files: `SpotdlInvocator.ts`, `SpotdlInvocator.test.ts`, `repository.ts`, `schema.ts`, `functions.ts`)
- `src/modules/client/settings/components/cookies-settings-form.tsx`
- `src/modules/client/playlist/components/advanced-flags-section.tsx`
- `drizzle/*.sql` (three files)
- `drizzle/meta/*.json` (four files)
- `data/db.sqlite` (runtime — handled by db-reset plugin at boot)
- `data/data.db` (stale runtime artifact)

**MODIFY (surgical edits):**
- `src/modules/server/db/schema.ts` — rename `playlists`→`sources`, drop `flags*` columns, drop `"track"` enum variant, add `coverArtUrl` column, add new `tracks` table
- `src/modules/server/db/seed.ts` — drop `flags*` fields, drop `"track"` seed, update type imports
- `src/modules/server/scheduler/PlaylistScheduler.ts` — remove spotdl imports (lines 10-11), remove `spotdlRepository` field (23, 27), remove `loadSpotdlSettings()` method (33-40), remove its calls from `initialize()` and `reload()` (307, 329), replace `executePlaylistSync` body (84-233) with stub pattern above, update `PlaylistRow` import to `SourceRow`, update all `schema.playlists` refs to `schema.sources`
- `src/modules/server/scheduler/PlaylistScheduler.test.ts` — rewrite entirely (mocks reference deleted `SpotdlRepository`, `SpotdlInvocator`; expectations reference `mockSpotdlRun`/`flagsFormat`/etc.); verify stub emits events instead of calling spotdl
- `src/modules/server/playlist/repository.ts` — rename table refs, update imports (`schema.playlists` → `schema.sources`)
- `src/modules/server/playlist/functions.ts` — drop `flags` from `updatePlaylistInputSchema` (110-121), drop the `flags` merge block (161-168), update types; optionally rename file/exports (likely out of scope for Phase 1 — keep `createPlaylistServerFn` name since routes call it)
- `src/modules/client/playlist/schema/playlist.ts` — drop `PlaylistFlagsSchema` (25-42), drop `flags` field (92), drop `"track"` source variant (16-20), drop track sample (171-192)
- `src/modules/client/playlist/schema/create-playlist-form.ts` — drop flag fields (49-66), drop `/track/` URL branch (24, 115-120), drop `flags` from `formDataToPlaylistPayload` return type (135-140, 160-167)
- `src/modules/client/playlist/schema/playlist.test.ts` — drop "valid spotify track" test, drop "track" from source-type expectations, drop "all audio formats" test, drop "all quality levels" test, drop retries-related test
- `src/modules/client/playlist/utils/mapper.ts` — drop `flags` object (17-22, 47-52, 64-67); rename import `PlaylistRow` → `SourceRow`
- `src/modules/client/playlist/components/playlist-config-card.tsx` — drop `format`, `quality`, `onFormatChange`, `onQualityChange` props; drop the two `Select.Root` blocks for Format/Quality (142-206); drop `formatOptions`/`qualityOptions` imports; hide the "Run Now" button (50-58 — either `<Show when={false}>...</Show>` or simply delete it)
- `src/modules/client/playlist/components/playlist-header.tsx` — drop `"track"` branch if present in source-type label path (service layer actually handles this — see below)
- `src/modules/client/playlist/service/options.ts` — delete `formatOptions`, `qualityOptions`, their exported types; keep `statusOptions` only
- `src/modules/client/playlist/service/playlist.ts` — drop `"track"` case from `formatSourceType` (121-128)
- `src/modules/client/playlist/service/playlist-actions.ts` — delete `updateFormat`, `updateQuality` functions
- `src/modules/client/playlist/components/basic-fields-section.tsx` — update help text from "playlist, album, or track" → "playlist or album" (line 51)
- `src/modules/client/settings/index.ts` — drop `CookiesSettingsForm` re-export (line 2)
- `src/routes/settings.tsx` — drop `CookiesSettingsForm` import (line 7), drop `getSpotdlSettingsServerFn` import (9) and call (15), drop the `<CookiesSettingsForm>` render (45); simplify loader return to `{ webhookSettings }`
- `src/routes/library_.add.tsx` — drop `AdvancedFlagsSection` import + render, drop `enableAdvancedFlags`/`overwrite`/`retries`/`quality`/`format` from `defaultValues`
- `src/routes/library_.$playlistId.tsx` — drop `updateFormat`/`updateQuality` imports (14-15), drop `handleFormatChange`/`handleQualityChange` (75-103), drop `format`/`quality`/`onFormatChange`/`onQualityChange` from `<PlaylistConfigCard>` props (125-126, 131-132), drop isSyncing/canSync/onRunSync if the hide-not-disable decision makes them unused (or leave wired for Phase 3)
- `src/env.ts` — drop `SPOTDL_COOKIES_FILE: z.string().optional()` (line 7)
- `src/modules/server/events/examples.ts` — update/remove the `spotdl_syncs_*` Prometheus metric comment (132-136) — cosmetic only
- `src/modules/server/events/IMPLEMENTATION.md` — find & update the spotdl mention (line 5) — cosmetic only
- `src/modules/server/events/ARCHITECTURE.md` — find & update spotdl mentions in the ASCII diagram (64, 74, 176) — cosmetic only

**CREATE:**
- `server/plugins/db-reset.ts` (Phase 1 only — deletes `data/db.sqlite`; register first in `vite.config.ts`)
- Register the new plugin in `vite.config.ts` → `nitro({ plugins: ["server/plugins/db-reset.ts", "server/plugins/events.ts", "server/plugins/scheduler.ts"] })` — first in the list

**Nothing found in OS-registered-state category:** verified by grep across `package.json` (scripts), `docker-compose*.yml`, `Dockerfile*`, `.github/` — no systemd unit names, no external task registrations.

**Nothing found in live-service-config category:** verified by grep for external service identifiers; only Discord webhook URL exists in DB (cleared by the wipe — user reconfigures).

## Common Pitfalls

### Pitfall 1: Drizzle-Kit migration drift after clean-break

**What goes wrong:** Keeping `drizzle/0000_lonely_justin_hammer.sql` + `drizzle/meta/_journal.json` in place while changing the schema source. Next time someone runs `pnpm db:generate`, Drizzle-Kit compares the new schema to the old snapshot and produces an incremental migration (ALTER TABLE, RENAME COLUMN, DROP COLUMN, etc.) instead of a fresh CREATE-TABLE. `drizzle-kit push` on an empty DB will also produce interactive prompts about which "new" columns it should add vs which old ones to drop.

**Why it happens:** `drizzle-kit generate` maintains journal state in `drizzle/meta/_journal.json`. Source-of-truth is the schema file + the snapshots; deleting only the `.sql` files leaves the journal inconsistent.

**How to avoid:** Delete `drizzle/` contents **entirely** (both `*.sql` and `meta/*.json`, keep the directory itself) atomically with the schema change commit. Run `pnpm db:generate` afterward to create a single fresh `0000_<new-adjective>.sql` migration against the new schema.

**Warning signs:** `pnpm db:push` prompts `⚠ There are 2 unique constraints to be deleted. Are you sure you want to proceed? (y/N)`. Or `db:generate` produces a migration with ALTER TABLE instead of CREATE TABLE.

### Pitfall 2: Stub emits fail Zod validation silently

**What goes wrong:** Stub emits `{ type: "playlist.sync.completed", payload: { duration: 0, exitCode: 0, ... } }`. The event bus doesn't re-validate on emit (handlers do at consume time), so the emit "succeeds". Handlers that accept `PlaylistSyncCompletedEvent` (and re-parse via inference from the discriminated union) will fail `z.number().positive()` on `duration`. Because `EventBus.safeInvoke` catches handler errors and just `console.error`s them, the failure is silent and Discord/metrics never fire. Phase 1's whole point of "keep handlers warm" is defeated.

**Why it happens:** Zod `z.number().positive()` rejects 0 and negative. Stub is "instant" so `Date.now() - start` can be 0ms.

**How to avoid:** Use `Math.max(1, elapsed)` for duration. Or add an explicit `await new Promise(r => setTimeout(r, 2))` between emits so elapsed is real.

**Warning signs:** Stub ticks appear in pino logs but Discord webhook never fires; metrics handler logs "Sync stats" with unchanged totals; `console.error("Handler failed for event playlist.sync.completed: ZodError: ...")` appears in output.

### Pitfall 3: `pnpm test` breaks on spotdl-mock-heavy tests

**What goes wrong:** After deleting `src/modules/server/spotdl/`, the `PlaylistScheduler.test.ts` file (lines 79-99) imports and mocks `SpotdlRepository` and `SpotdlInvocator` — it's literally unrunnable. Also `SpotdlInvocator.test.ts` itself is deleted. Also `src/modules/client/playlist/schema/playlist.test.ts` has cases like "should support all audio formats" (7 formats) and "valid spotify track" that reference removed schema fields.

**Why it happens:** Tests are co-located with the source they test. Tests are source code, not documentation — they have to be kept consistent.

**How to avoid:** As part of Phase 1, rewrite `PlaylistScheduler.test.ts` to assert the stub behavior (emits two events, does not call repository, does not create invocation row). Rewrite `playlist.test.ts` to drop track cases and format/quality enum expansions. Delete `SpotdlInvocator.test.ts` entirely.

**Warning signs:** `pnpm test` fails with `Cannot find module '../spotdl/repository'` or similar.

### Pitfall 4: `getDb()` singleton held open when db-reset plugin runs

**What goes wrong:** If any earlier plugin or early module import calls `getDb()` before `db-reset.ts` runs, `better-sqlite3` holds an open file handle; `fs.unlinkSync(DB_PATH)` on macOS/Linux will succeed (the file is marked deleted but the handle persists), then subsequent queries still see the old schema because they're reading through the held handle. On Windows, unlink may fail outright.

**Why it happens:** The db-reset plugin must run **strictly first**. Node's `import` hoists, but Nitro plugin execution order is the order given in `vite.config.ts` → `nitro({ plugins: [...] })`.

**How to avoid:** Register `"server/plugins/db-reset.ts"` **first** in that array. Do not import `getDb` or `schema` into `db-reset.ts` itself — use only `node:fs`. Verify by adding a log line `logger.info("db-reset plugin running")` and confirming it appears before any `SchedulerPlugin` or `EventBusPlugin` log line in the boot output.

**Warning signs:** Boot logs show `SchedulerPlugin` before `DbReset`. Scheduler registers a playlist from a row that shouldn't exist (leftover from legacy DB).

### Pitfall 5: `triggerPlaylistSyncServerFn` dies on `isRunning` gate when scheduler is stub

**What goes wrong:** Even though "Run Now" button is hidden (D-04), the server function `triggerPlaylistSyncServerFn` remains callable from any HTTP client (curl, Postman). If the button is accidentally re-rendered, or an old client hits a cached page, it invokes the server function → calls `scheduler.triggerManualSync(playlistRow)` → eventually executes the stub. This is fine by design. But the `isRunning` check currently returns an error string "Playlist is already syncing" — which the (hidden) button would surface in a toast. Acceptable.

**Why it happens:** Backend surface is wider than UI surface; hiding the button is UI-only.

**How to avoid:** Acceptable risk for Phase 1. Document that the server fn is a no-op-through-stub; Phase 3 will rewire it.

**Warning signs:** N/A — this is expected behavior.

### Pitfall 6: Cover-art URL scope creep

**What goes wrong:** Recommending `coverArtUrl` in the `sources` table (research suggestion, see Pattern 3) tempts the planner to add a scrape integration in Phase 1. The column exists but should stay null until Phase 3's SCRAPE-07 populates it.

**Why it happens:** Columns are cheap to add; the *feature* that fills them is what has scope.

**How to avoid:** Plan only the column add. Leave default null. Do not add any UI that displays cover art in Phase 1.

**Warning signs:** Phase 1 tasks grow to include "scrape cover art" — reject.

## Code Examples

### Example 1: New tracks table with composite uniqueness + indexes

```typescript
// src/modules/server/db/schema.ts (addition)
// Source: Drizzle /drizzle-team/drizzle-orm-docs "Define SQLite Unique Constraints in DrizzleORM"
// + repository existing unixepoch timestamp idiom
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

export const tracks = sqliteTable(
	"tracks",
	{
		id: text("id").primaryKey().notNull(),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		spotifyTrackId: text("spotify_track_id").notNull(),
		title: text("title").notNull(),
		artist: text("artist").notNull(),
		durationMs: integer("duration_ms").notNull(),
		state: text("state", {
			enum: ["pending", "matched", "downloaded", "skipped_low_confidence", "failed"],
		})
			.default("pending")
			.notNull(),
		ytVideoId: text("yt_video_id"),
		downloadPath: text("download_path"),
		failureReason: text("failure_reason"),
		position: integer("position").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		unique("tracks_source_spotify_unique").on(t.sourceId, t.spotifyTrackId),
		index("tracks_source_id_idx").on(t.sourceId),
		index("tracks_state_idx").on(t.state),
	],
);

export type TrackRow = typeof tracks.$inferSelect;
export type NewTrackRow = typeof tracks.$inferInsert;
```

### Example 2: DB-reset plugin (Phase 1 only)

```typescript
// server/plugins/db-reset.ts
// Source: existing server/plugins/scheduler.ts pattern; node:fs stdlib
import { existsSync, unlinkSync } from "node:fs";
import path from "node:path";
import type { NitroApp } from "nitro/types";
import { Logger } from "../../src/logger";

const DB_PATH = path.resolve(process.cwd(), "data", "db.sqlite");

export default (_nitroApp: NitroApp) => {
	const logger = Logger.get("DbReset");
	if (existsSync(DB_PATH)) {
		unlinkSync(DB_PATH);
		logger.warn({ path: DB_PATH }, "Legacy DB deleted — clean-break reset (Phase 1)");
	} else {
		logger.info("No legacy DB present; clean slate");
	}
};
```

Register in `vite.config.ts`:
```typescript
// vite.config.ts (excerpt)
nitro({
	plugins: [
		"server/plugins/db-reset.ts",   // NEW — must be first
		"server/plugins/events.ts",
		"server/plugins/scheduler.ts",
	],
}),
```

### Example 3: Scheduler stub tick

```typescript
// src/modules/server/scheduler/PlaylistScheduler.ts — replace executePlaylistSync body
// Source: existing method signature at PlaylistScheduler.ts:84; event schemas at events/schema.ts:14-40
private async executePlaylistSync(source: SourceRow): Promise<void> {
	if (this.runningPlaylists.has(source.id)) {
		this.logger.warn(
			{ sourceId: source.id, sourceName: source.name },
			"Stub: source already ticking, skipping",
		);
		return;
	}
	this.runningPlaylists.add(source.id);
	const invocationId = randomUUID();
	const startedAt = Date.now();

	try {
		await getEventBus().emit({
			type: "playlist.sync.started",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				sourceUrl: source.sourceUrl,
				outputDir: source.outputDir,
			},
		});

		this.logger.info(
			{ sourceId: source.id, sourceName: source.name },
			"Scheduler stub tick — no engine (Phase 1)",
		);

		// No DB write (D-03). No work.
		await getEventBus().emit({
			type: "playlist.sync.completed",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				duration: Math.max(1, Date.now() - startedAt),
				exitCode: 0,
				summary: "Phase 1 stub — no engine attached",
			},
		});
	} finally {
		this.runningPlaylists.delete(source.id);
	}
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| spotdl CLI wrapper (binary + cookie file + child_process spawn) | Playwright + yt-dlp pipeline | Multi-phase pivot (Phase 1 rips old, Phase 2+ builds new) | Phase 1 removes the spotdl wrapper; new pipeline slots into Phase 3. |
| `flagsQuality`/`flagsFormat`/`flagsRetries`/`flagsOverwrite` on playlist rows | No per-playlist flags (MP3 fixed, retries via track state model, overwrite via per-track manual retry) | Phase 1 (this phase) | Simpler schema, simpler form, simpler UI. |
| `playlists` table name | `sources` table name | Phase 1 (recommended — D-11 discretion) | Cleaner Phase 3+ queries. |
| `drizzle-kit push` versions via incremental migration files | One-shot clean-break `push` | Phase 1 one-shot | Zero migration code to write; acceptable given zero prod instances. |

**Deprecated/outdated:**
- `src/modules/server/spotdl/` — entirely removed in this phase
- `SPOTDL_COOKIES_FILE` env var — removed
- `data/cookies/cookies.txt` — no code reads it anymore after Phase 1; file can stay on disk or be cleaned up (file cleanup is not required for Phase 1 completion)

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Renaming `playlists` → `sources` in Phase 1 is the right call | Primary recommendation + Pattern 3 | Minimal — user gave discretion. If planner disagrees during discuss-phase, keep the name; the rest of the research applies unchanged. |
| A2 | Adding `cover_art_url` (nullable) column to `sources` in Phase 1 is useful prep for SCRAPE-07 | Pattern 3 | Minimal — a nullable column is free. Risk is scope creep toward Phase 3 scrape; Pitfall 6 guards against it. |
| A3 | `index("tracks_source_id_idx")` and `index("tracks_state_idx")` are worthwhile at Phase 1 | Pattern 2 | Minimal — indexes are always safe; deleting them later is easy. If Phase 5 profiling shows they're unused, drop then. |
| A4 | The db-reset plugin will be deleted at the end of Phase 1 (not shipped forever) | Pattern 1 | Critical if missed — a wipe-every-boot plugin destroys runtime state forever. Planner must explicitly include "delete server/plugins/db-reset.ts" or "feature-flag it behind `PHASE_1_RESET=1` env var" as a late task in Phase 1. |
| A5 | The existing `triggerPlaylistSyncServerFn` can stay callable during Phase 1 despite the hidden button | Pitfall 5 | Low — hidden button means no UI path; server-fn callable from curl is acceptable for a personal tool. |
| A6 | Discord webhook settings clearing (as a side effect of DB wipe) is acceptable | Runtime State Inventory / Live service config | Low — user explicitly accepts clean-break tradeoffs (D-05). User will reconfigure once post-boot. |
| A7 | `pnpm db:push` in the dev start script covers dev-mode schema recreation after file delete | Pattern 1 + Environment Availability | Low — `pnpm dev` line in `package.json:6` is `pnpm run db:push && vite dev --port 3000`, which runs push before dev. File delete happens at Nitro boot (inside `vite dev`), so push has already run against the then-present (old-schema) file. Actually this is a problem — see A8. |
| A8 | Ordering: `pnpm db:push` in `pnpm dev` runs BEFORE `vite dev` starts Nitro → `db:push` runs against the OLD DB file → then the Nitro plugin deletes the file → then `getDb()` opens a fresh file with NO schema | Pattern 1 + Pitfall 4 | **MEDIUM — needs resolution during planning.** Options: (a) have the db-reset plugin also run `drizzle-kit push` after file delete (adds complexity); (b) change dev flow to `rm -f data/db.sqlite && pnpm run db:push && vite dev` (but that skips the plugin on prod); (c) have the db-reset plugin be a one-shot that deletes the file AND runs `drizzle-kit push` programmatically via Drizzle-Kit API; (d) accept that Phase 1 first boot in dev needs a manual `rm data/db.sqlite && pnpm db:push` and document it; (e) replace the plugin with a `pnpm reset:db` script that both rms and pushes, invoked once at the Phase 1 cutover. Recommendation: option (e) — simplest and aligns with user's "just do it" philosophy. Planner must pick one. |

**If this table is non-empty:** A4 and A8 need explicit resolution during `/gsd-discuss-phase` or at planner stage. A1-A7 are low-risk and can be left to Claude's discretion.

## Open Questions (RESOLVED)

1. **How to sequence `db:push` and the file delete?** **RESOLVED:** One-shot `pnpm reset:db` script (not a runtime plugin). Implemented by plan 01-05 Task 1 (`scripts/reset-db.mjs` + `package.json` script entry). Plan 01-05 Task 2 re-runs `pnpm db:push` against a wiped DB file as the [BLOCKING] verification step. Nitro plugin approach explicitly rejected and asserted-absent in plan 01-05 verification.
   - What we know: `pnpm db:push` runs before `vite dev` (dev flow); production `pnpm start` does not run push at all (container entrypoint would need to); Nitro plugin deletes file inside Vite/Nitro boot.
   - What's unclear: Cleanest way to guarantee "fresh file + fresh schema" in one step without a double-push or a manual command.
   - Recommendation: Add a one-shot npm script `pnpm reset:db` = `rimraf data/db.sqlite && pnpm db:push` (or shell equivalent), have the planner add a task "run `pnpm reset:db` at Phase 1 cutover" and **skip the runtime plugin entirely**. The plugin-based approach is elegant but has the ordering problem in A8. A one-shot script is dumber and works. This also aligns with D-05's "just do it" spirit — no ceremony.

2. **Delete or rewrite `PlaylistScheduler.test.ts`?** **RESOLVED:** Rewrite from scratch. Implemented by plan 01-04 Task 1 (test written first, TDD) + Task 2 (stub implementation to turn it green). New test mocks `getEventBus()` and asserts the two lifecycle emits + zero `InvocationRepository` calls.
   - What we know: Existing file has 468 lines, heavily mocks spotdl internals, asserts invocation row creation + update.
   - What's unclear: Whether to delete and rewrite vs patch in-place.
   - Recommendation: Rewrite from scratch. Keep test coverage for cron expression calculation (`intervalToCron`), scheduling/unscheduling, reload, shutdown, concurrency guard — but drop all spotdl mocks and instead mock `getEventBus()` to assert the two emits. Target: ~200 lines, significantly simpler.

3. **Should `SPOTDL_COOKIES_FILE` be removed from `.env.example`?** **RESOLVED:** Yes — removed from `.env.example`, `Dockerfile`, `Dockerfile.dev` by plan 01-03 Task 2 (acceptance criteria include `! grep -r "SPOTDL_COOKIES_FILE" .env.example Dockerfile Dockerfile.dev`).
   - What we know: `.env.example` exists (per Stack analysis), but not inspected here.
   - What's unclear: Whether other env vars reference it.
   - Recommendation: Planner task: `sed`-out any `SPOTDL_COOKIES_FILE` line from `.env.example`, `.env.sample`, `docker-compose.yml`, `docker-compose.prod.yml`, `Dockerfile`, `Dockerfile.dev`. Cheap to include; cheap if it finds nothing.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Everything | ✓ | 24.14.1 (user) / 22.x (prod target) | — |
| pnpm | All scripts | ✓ | 10.33.0 | — |
| SQLite (better-sqlite3) | Drizzle schema push + runtime | ✓ | system sqlite3 v3.51.0; better-sqlite3 compiles natively | — |
| ffmpeg | Out of scope for Phase 1 (Phase 3+) | ✓ | 8.1 | — |
| Python 3 + spotdl | **Intentionally unnecessary** for Phase 1 end-state (removing spotdl) | ✓ (Python 3.9.6; spotdl install state not checked) | — | Irrelevant — being removed. |
| Playwright / Chromium | Phase 2+ | N/A | — | — |
| yt-dlp | Phase 3+ | N/A | — | — |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** None — everything Phase 1 needs is available locally.

## Validation Architecture

`workflow.nyquist_validation: true` per `.planning/config.json`. Validation section is required.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.0.16 |
| Config file | none at repo root; Vitest uses default config — co-located `*.test.ts` files |
| Quick run command | `pnpm test` (runs `vitest run` — single pass, non-watch) |
| Full suite command | `pnpm test && pnpm typecheck && pnpm lint && pnpm build` |
| Per-file command | `pnpm exec vitest run <file>` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TRACK-01 | `tracks` table has unique `(source_id, spotify_track_id)` | unit (schema introspection) | `pnpm exec vitest run src/modules/server/db/schema.test.ts` (new file) | ❌ Wave 0 — create `src/modules/server/db/schema.test.ts` asserting the `$inferSelect` type, unique constraint, column set |
| TRACK-02 | Track rows store all required columns with correct types + default state | unit (schema introspection) | same as TRACK-01 | ❌ Wave 0 |
| CLEANUP-01 | `SpotdlInvocator` + `SpotdlRepository` + `src/modules/server/spotdl/` gone | integration (compile-time) | `pnpm typecheck` fails if any import remains; `[ -d src/modules/server/spotdl ] && exit 1 || exit 0` as a shell guard | ✓ typecheck exists; shell guard is trivial |
| CLEANUP-02 | `SPOTDL_COOKIES_FILE`, `flags*` columns, `spotdl` global_settings key all gone | unit + integration | `grep -r "SPOTDL_COOKIES_FILE\|flagsFormat\|flagsQuality" src/ && exit 1 \|\| exit 0`; schema test asserts no `flags_*` columns on sources | ❌ Wave 0 (schema test) |
| CLEANUP-03 | DB wipe succeeds on first boot; no notice UI rendered | integration (manual boot check — see below) | manual: `rm data/db.sqlite; pnpm dev` → observe logs "Legacy DB deleted" OR "clean slate"; then observe DB recreated with new schema via `sqlite3 data/db.sqlite '.schema'` | manual-only acceptable |
| CLEANUP-04 | No `CookiesSettingsForm`, no `AdvancedFlagsSection`, no flag form fields; Run Now button hidden | integration (compile) + unit (component shallow test, optional) | `pnpm typecheck`; shell guards for file existence `[ -f src/modules/client/settings/components/cookies-settings-form.tsx ] && exit 1 \|\| exit 0` | ✓ typecheck + shell guards |
| D-01/D-02 scheduler stub emits events | Stub tick emits `playlist.sync.started` + `playlist.sync.completed` on each fire, does NOT call spotdl, does NOT write to invocations | unit (rewritten PlaylistScheduler.test.ts) | `pnpm exec vitest run src/modules/server/scheduler/PlaylistScheduler.test.ts` | ✓ file exists (rewrite) |
| D-03 no invocation rows | Stub does not call `InvocationRepository.create` or `.update` | unit (same as D-01/D-02) | same | ✓ |
| Event payload validation | Emits satisfy Zod schemas (duration positive, invocationId uuid) | unit (PlaylistScheduler.test.ts + optional explicit event schema parse test) | same | ✓ |

### Sampling Rate

- **Per task commit:** `pnpm exec vitest run <touched-file>` + `pnpm typecheck` (< 20s for small diff)
- **Per wave merge:** `pnpm test && pnpm typecheck && pnpm lint` (< 45s total — current repo size)
- **Phase gate:** `pnpm test && pnpm typecheck && pnpm lint && pnpm build && (rm -f data/db.sqlite && pnpm db:push && pnpm start in background, curl /library, assert 200 + schema verification sqlite3 .schema | grep tracks)` — full green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/modules/server/db/schema.test.ts` — new file; asserts TRACK-01 unique constraint, TRACK-02 column set, `sources` table has no `flags_*` columns, `global_settings` has no `spotdl` key (row-level assertion run against seeded DB)
- [ ] Rewrite `src/modules/server/scheduler/PlaylistScheduler.test.ts` — new test body asserting stub behavior (event emits, no repository calls)
- [ ] Rewrite `src/modules/client/playlist/schema/playlist.test.ts` — drop track/format/quality cases, keep source-type + status + schedule validation cases
- [ ] Framework install: not needed — Vitest already installed
- [ ] Optional: shell guard script `scripts/verify-cleanup.sh` that greps for leftover spotdl strings — runnable in CI or by hand

## Security Domain

Per `security_enforcement` default = enabled. Phase 1 is a deletion/rename phase with no new attack surface, but the listing is required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Single-user self-hosted, no auth layer. |
| V3 Session Management | no | No user sessions. |
| V4 Access Control | no | No multi-tenancy; single-user tool. |
| V5 Input Validation | yes | **Zod 4.3.5** — all server-fn inputs via `.inputValidator()`, all route search params via `zodValidator`, all event payloads via discriminated Zod union. Phase 1 changes (dropping flag fields) reduce the input surface; no new inputs added. |
| V6 Cryptography | no | No passwords, tokens, or encryption in scope. (Phase 2+ will store Playwright storage-state JSON in `/data` — handled in Phase 2/7.) |
| V8 Data Protection | partial | Deleting `data/db.sqlite` is an intentional data-destruction event. Phase 1 plugin makes this unconditional on boot — this IS the feature, but document it prominently so a future maintainer doesn't accidentally ship the plugin in Phase 2+. (Assumption A4.) |
| V10 Malicious Code | no | No untrusted input executes as code. |
| V12 Files & Resources | partial | `data/db.sqlite` deletion uses absolute path resolution via `path.resolve(process.cwd(), ...)` — same pattern used elsewhere (`SpotdlInvocator.ts:67-68`). Safe. |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Accidental DB destruction in prod (wipe plugin shipping past Phase 1) | Denial-of-Service / Repudiation | A4 mitigation: planner task to delete the plugin at Phase 1 cutover, OR gate it behind a one-shot `PHASE_1_RESET=1` env var. Recommended: replace runtime plugin with a one-shot `pnpm reset:db` script (see Open Question 1). |
| SQL injection into new tracks table | Tampering | Drizzle ORM — parameterized queries by construction. No raw SQL. |
| Event bus handler throwing on malformed payload | DoS (handler chain breakage) | Already mitigated by `safeInvoke` in `EventBus.emit` + `Promise.allSettled`. Pitfall 2 addresses payload shape correctness. |
| Leftover cookies file on disk (`data/cookies/cookies.txt`) | Info disclosure (if cookies still valid when exposed) | Cookies file will be orphaned after Phase 1 (no code references). Planner task: delete `data/cookies/` directory during cutover. Low-risk since single-user self-hosted. |

## Sources

### Primary (HIGH confidence)
- Context7 `/drizzle-team/drizzle-orm-docs` — SQLite unique constraints (`unique().on(...)`), push vs generate, reset patterns. Queried 2026-04-23.
- Context7 `/hexagon/croner` — `pause()` / `resume()` / `stop()` lifecycle. Queried 2026-04-23. (Not used in Phase 1 stub — the existing `new Cron()` + short-circuit body pattern is sufficient — but documented as the escape hatch if someone wants to truly stop the cron.)
- Codebase — all schema, scheduler, event bus, plugin, route, form, and test files under `src/` and `server/`. Fully read 2026-04-23.
- `.planning/PROJECT.md`, `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md`, `.planning/STATE.md` — read 2026-04-23.
- `.planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md` — user decisions, read 2026-04-23.
- `.planning/codebase/ARCHITECTURE.md`, `STRUCTURE.md`, `CONVENTIONS.md`, `STACK.md`, `INTEGRATIONS.md` — read 2026-04-23.
- `CLAUDE.md` — project guidelines, read 2026-04-23.
- `package.json`, `drizzle.config.ts`, `Dockerfile`, `docker-compose.yml`, `docker-compose.prod.yml` — read 2026-04-23.
- `npm view drizzle-orm/drizzle-kit/croner/better-sqlite3/zod` — current versions verified 2026-04-23.

### Secondary (MEDIUM confidence)
- Container startup ordering assertion for Nitro plugins — based on the pattern visible in `vite.config.ts` and the array order in `nitro({ plugins: [...] })`. Not explicitly documented in Nitro docs but consistent with how `server/plugins/events.ts` and `server/plugins/scheduler.ts` currently interact.

### Tertiary (LOW confidence)
- None — every claim traces back to either Context7, codebase, or npm registry.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions verified against npm registry; all libraries already in use.
- Architecture: HIGH — every pattern is a minor transformation of existing code; no new paradigms introduced.
- Pitfalls: HIGH — derived from actual code reading (event schema validation, plugin ordering, migration journal state).
- DB wipe mechanism (A8 uncertainty): MEDIUM — the precise boot-ordering of `pnpm db:push` vs the plugin has one unresolved option that the planner must choose.

**Research date:** 2026-04-23
**Valid until:** 2026-05-23 (30 days — stack is stable; no major Drizzle or croner releases expected to invalidate findings within this window)
