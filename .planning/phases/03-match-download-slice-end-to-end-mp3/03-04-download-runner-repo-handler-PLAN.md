---
phase: 03-match-download-slice-end-to-end-mp3
plan: 04
type: execute
wave: 3
depends_on: [03-01, 03-02, 03-03]
files_modified:
  - src/modules/server/downloader/repository.ts
  - src/modules/server/downloader/repository.test.ts
  - src/modules/server/downloader/DownloadRunner.ts
  - src/modules/server/downloader/DownloadRunner.test.ts
  - src/modules/server/downloader/handler.ts
  - src/modules/server/downloader/index.ts
  - src/modules/server/events/schema.ts
  - server/plugins/events.ts
  - src/modules/server/scheduler/PlaylistScheduler.test.ts
autonomous: true
requirements: [MATCH-01, MATCH-02, MATCH-03, MATCH-04, DOWNLOAD-01, DOWNLOAD-02, DOWNLOAD-03, DOWNLOAD-04, DOWNLOAD-05]
user_setup: []

must_haves:
  truths:
    - "DownloadRunner.run(source) reads pending+matched tracks for the source, snapshots match settings, runs them through pLimit(N), and writes a kind=download invocation row"
    - "Per-track state machine writes at three transition points: state=matched + ytVideoId BEFORE download (D-02); state=downloaded + downloadPath AFTER tag (D-02); state=failed/skipped_low_confidence on per-track failure (D-03)"
    - "Track-level download failures DO NOT abort the run — invocation row finishes with status=success and summary counters"
    - "MATCH-04: tracks with state=matched skip the probe call and reuse the persisted yt_video_id"
    - "Out-of-tolerance probe results transition to skipped_low_confidence with the duration delta in failure_reason (MATCH-03)"
    - "yt-dlp writes directly to data/music/<source-slug>/<artist> - <title>.mp3 (sanitized via slug.ts); existing files are skipped (D-15)"
    - "fs.mkdir({recursive:true}) creates the source-slug directory lazily before the first track downloads"
    - "Path resolution checks resolved path stays under data/music/<slug>/ (T-3-02 path traversal mitigation)"
    - "playlist.download.completed event is emitted at the end of every DownloadRunner.run with download counters payload"
    - "DownloadHandler is registered in the Nitro events plugin and subscribes to playlist.sync.completed"
    - "PlaylistScheduler.runningPlaylists is held across the entire scrape→download chain (D-06) — verified by an integration test against the real EventBus"
    - "Stderr captured in failure_reason is capped at 500 chars (T-3-03)"
    - "Cover-art fetch failure does NOT mark the track failed — track is downloaded successfully without APIC frame (Pitfall #8)"
  artifacts:
    - path: "src/modules/server/downloader/repository.ts"
      provides: "DownloadRepository class — getTracksToProcess, markMatched, markDownloaded, markFailed, markSkippedLowConfidence, getMatchSettings, saveMatchSettings, getSource"
      contains: "export class DownloadRepository"
      min_lines: 100
    - path: "src/modules/server/downloader/repository.test.ts"
      provides: "Drizzle in-memory tests using W-5 latest-migration loader"
      contains: "createTestDb"
    - path: "src/modules/server/downloader/DownloadRunner.ts"
      provides: "DownloadRunner orchestrator class with run(source) entry point"
      contains: "export class DownloadRunner"
      min_lines: 200
    - path: "src/modules/server/downloader/DownloadRunner.test.ts"
      provides: "Mocked-bridge + mocked-repo + mocked-fs unit tests covering all 10+ behaviors"
      contains: "describe(\"DownloadRunner.run\""
    - path: "src/modules/server/downloader/handler.ts"
      provides: "registerDownloadHandler() — bus.on('playlist.sync.completed', async event => runner.run(source))"
      contains: "registerDownloadHandler"
    - path: "src/modules/server/events/schema.ts"
      provides: "PlaylistDownloadCompletedEventSchema added to discriminated union"
      contains: "playlist.download.completed"
    - path: "server/plugins/events.ts"
      provides: "registerDownloadHandler call alongside existing handler registrations"
      contains: "registerDownloadHandler"
    - path: "src/modules/server/scheduler/PlaylistScheduler.test.ts"
      provides: "D-06 lock-spans-handler-chain test using real EventBus"
      contains: "runningPlaylists"
  key_links:
    - from: "src/modules/server/downloader/DownloadRunner.ts"
      to: "src/modules/server/downloader/YtDlpBridge.ts"
      via: "bridge.probe + bridge.download"
      pattern: "bridge\\.probe|bridge\\.download"
    - from: "src/modules/server/downloader/DownloadRunner.ts"
      to: "src/modules/server/downloader/tagger.ts"
      via: "embedTags(targetPath, ...)"
      pattern: "embedTags"
    - from: "src/modules/server/downloader/DownloadRunner.ts"
      to: "src/modules/server/downloader/cover-art.ts"
      via: "fetchCoverArt(source.coverArtUrl)"
      pattern: "fetchCoverArt"
    - from: "src/modules/server/downloader/DownloadRunner.ts"
      to: "src/modules/server/downloader/slug.ts"
      via: "sourceSlug(source.name) + safeFilename(artist, title)"
      pattern: "sourceSlug|safeFilename"
    - from: "src/modules/server/downloader/DownloadRunner.ts"
      to: "p-limit npm package"
      via: "pLimit(settings.parallel)"
      pattern: "pLimit"
    - from: "src/modules/server/downloader/handler.ts"
      to: "EventBus.on('playlist.sync.completed')"
      via: "bus.on subscription returning unsubscribe fn"
      pattern: "bus.on"
    - from: "server/plugins/events.ts"
      to: "src/modules/server/downloader/handler.ts"
      via: "registerDownloadHandler() call at startup"
      pattern: "registerDownloadHandler"
---

<objective>
Wire together every piece built in Plans 03-01 through 03-03 into the production pipeline. Implement `DownloadRepository` (track-row writes + match-settings JSON), `DownloadRunner` (per-source orchestration with pLimit fan-out + per-track state machine + per-track failure isolation), the new `playlist.download.completed` event, the EventBus handler that subscribes to `playlist.sync.completed` and kicks the runner, and register the handler in the Nitro plugin so the scheduler→scrape→download chain works end-to-end.

Purpose: Delivers all 9 Phase 3 requirements end-to-end:
- MATCH-01..04 via DownloadRunner.processTrack pipeline (probe → duration gate → matched-skip → state writes)
- DOWNLOAD-01 via YtDlpBridge.download (Plan 03-02)
- DOWNLOAD-02 via tagger + cover-art (Plan 03-03), wired in by DownloadRunner
- DOWNLOAD-03 via path.resolve + slug helpers (Plan 03-01) + path-traversal guard (T-3-02)
- DOWNLOAD-04 via pLimit(settings.parallel) snapshot
- DOWNLOAD-05 via per-track markFailed with stderr-tail-capped failure_reason

Implements decisions D-01..D-07 (pipeline shape), D-11 (concurrency), D-13 (album column wired), D-15 (skip-if-exists). Mitigates T-3-02 (path traversal), T-3-05 (.part file false-positive — final filename only).

Output: Repository class + Runner class + handler + event schema extension + plugin registration + scheduler D-06 test, all green and integrated. After this plan, a manual sync-now press triggers scrape → emits playlist.sync.completed → handler awaits DownloadRunner.run → tracks march through state machine → MP3s land on disk → playlist.download.completed fires.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/ROADMAP.md
@.planning/STATE.md
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md
@.planning/phases/02-spotify-metadata-spotifyscraper/02-CONTEXT.md
@CLAUDE.md
@src/modules/server/scraper/SyncRunner.ts
@src/modules/server/scraper/SyncRunner.test.ts
@src/modules/server/scraper/repository.ts
@src/modules/server/scraper/repository.test.ts
@src/modules/server/webhooks/handler.ts
@src/modules/server/webhooks/repository.ts
@src/modules/server/events/schema.ts
@src/modules/server/events/EventBus.ts
@src/modules/server/scheduler/PlaylistScheduler.ts
@src/modules/server/invocation/repository.ts
@src/modules/server/db/schema.ts
@src/modules/server/downloader/schema.ts
@src/modules/server/downloader/slug.ts
@src/modules/server/downloader/YtDlpBridge.ts
@src/modules/server/downloader/tagger.ts
@src/modules/server/downloader/cover-art.ts
@src/modules/server/downloader/index.ts
@server/plugins/events.ts
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-01-foundation-schema-deps-slug-PLAN.md
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-02-yt-dlp-bridge-PLAN.md
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-03-tagger-cover-art-PLAN.md

<interfaces>
<!-- Cross-module contracts the executor MUST honor. -->

From src/modules/server/db/schema.ts (Plan 03-01):
```typescript
export const tracks = sqliteTable("tracks", {
    id, sourceId, spotifyTrackId, title, artist, durationMs, state,
    ytVideoId, downloadPath, failureReason, position,
    album,            // NEW (Phase 3 D-13) — nullable
    createdAt, updatedAt,
}, ...);

export const invocations = sqliteTable("invocations", {
    id, playlistId, startedAt, finishedAt, exitCode, status,
    logPath, syncFilePath, summary,
    kind,             // NEW (Phase 3 D-05) — enum 'scrape'|'download', default 'scrape'
});
```

From src/modules/server/downloader/schema.ts (Plan 03-01):
```typescript
export const MATCH_SETTINGS_KEY = "match";
export const MatchSettingsSchema = z.object({
    tolerance_seconds: z.number().int().min(0).max(60).default(3),
    parallel: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});
export const DEFAULT_MATCH_SETTINGS: MatchSettings;
```

From src/modules/server/downloader/YtDlpBridge.ts (Plan 03-02):
```typescript
export class YtDlpBridge {
    constructor(options?: YtDlpBridgeOptions);
    async probe(query: string): Promise<YtDlpProbeEnvelope>;
    async download(videoId: string, outputPath: string): Promise<YtDlpDownloadEnvelope>;
}
```

From src/modules/server/downloader/tagger.ts + cover-art.ts (Plan 03-03):
```typescript
export interface CoverArt { buffer: Buffer; mime: string; }
export interface TagInput { title: string; artist: string; album?: string | null; coverArt?: CoverArt | null; }
export function embedTags(filepath: string, input: TagInput): void;
export async function fetchCoverArt(url: string | null, log?: AppLogger): Promise<CoverArt | null>;
```

From src/modules/server/downloader/slug.ts (Plan 03-01):
```typescript
export function sourceSlug(name: string): string;
export function safeFilename(artist: string, title: string): string;
```

From src/modules/server/scraper/SyncRunner.ts — emit-then-await chain to mirror:
```typescript
await getEventBus().emit({
    type: "playlist.sync.completed",
    payload: { playlistId, playlistName, invocationId, duration, exitCode, ... },
});
```

From src/modules/server/events/EventBus.ts (line 177): `await Promise.allSettled(promises);` — registered handlers are awaited; lock spans automatically (D-06).

From src/modules/server/webhooks/handler.ts — register pattern to mirror:
```typescript
export function registerDiscordWebhookHandler(logger = Logger.get("...")): () => void {
    const bus = getEventBus();
    const unsubscribe = bus.on("playlist.sync.completed", async (event) => { ... });
    return () => { unsubscribe(); };
}
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend events/schema.ts with PlaylistDownloadCompletedEventSchema + add to discriminated union</name>
  <files>src/modules/server/events/schema.ts</files>
  <read_first>
    - src/modules/server/events/schema.ts (current discriminated union — extend, do NOT touch existing schemas)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "src/modules/server/events/schema.ts (MOD)")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Open Question #3 recommendation — emit playlist.download.completed)
  </read_first>
  <behavior>
    Add to events/schema.ts BEFORE the existing `EventSchema = z.discriminatedUnion(...)` block:
    ```typescript
    /**
     * Phase 3 D-05: download finalization event.
     * Emitted by DownloadRunner.run after all per-track work is settled.
     * Carries summary counters that match the kind=download invocation row's summary JSON.
     */
    export const PlaylistDownloadCompletedEventSchema = BaseEventSchema.extend({
        type: z.literal("playlist.download.completed"),
        payload: z.object({
            playlistId: z.string(),
            playlistName: z.string(),
            invocationId: z.string().uuid(),
            duration: z.number().positive(),
            total: z.number().int().nonnegative(),
            downloaded: z.number().int().nonnegative(),
            matchedOnly: z.number().int().nonnegative(),
            skippedLowConfidence: z.number().int().nonnegative(),
            failed: z.number().int().nonnegative(),
        }),
    });
    export type PlaylistDownloadCompletedEvent = z.infer<typeof PlaylistDownloadCompletedEventSchema>;
    ```
    And append `PlaylistDownloadCompletedEventSchema` to the `z.discriminatedUnion("type", [ ... ])` array.
  </behavior>
  <action>
    1. Edit `src/modules/server/events/schema.ts`:
       a. After the `SchedulerReloadEventSchema` definition (around line 132), add a new BaseEventSchema.extend block as shown in <behavior>.
       b. In the `EventSchema = z.discriminatedUnion("type", [ ... ])` array (around lines 137-146), add `PlaylistDownloadCompletedEventSchema,` before the closing `])`.
       c. Add the type export `export type PlaylistDownloadCompletedEvent` near the other typed exports (around lines 152-167).
    2. Run `pnpm typecheck` and `pnpm check`.
    3. Run `pnpm test src/modules/server/events/` to confirm existing event-bus tests still pass with the extended union.
  </action>
  <verify>
    <automated>grep -q 'PlaylistDownloadCompletedEventSchema' src/modules/server/events/schema.ts &amp;&amp; grep -q '"playlist.download.completed"' src/modules/server/events/schema.ts &amp;&amp; grep -q 'matchedOnly' src/modules/server/events/schema.ts &amp;&amp; grep -q 'skippedLowConfidence' src/modules/server/events/schema.ts &amp;&amp; grep -q 'PlaylistDownloadCompletedEventSchema' src/modules/server/events/schema.ts | wc -l | awk '$1 &gt;= 2 {exit 0} {exit 1}' &amp;&amp; pnpm typecheck &amp;&amp; pnpm test src/modules/server/events/</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q 'PlaylistDownloadCompletedEventSchema' src/modules/server/events/schema.ts` exits 0
    - `grep -q '"playlist.download.completed"' src/modules/server/events/schema.ts` exits 0
    - `grep -q 'matchedOnly' src/modules/server/events/schema.ts` exits 0
    - `grep -q 'skippedLowConfidence' src/modules/server/events/schema.ts` exits 0
    - `grep -q 'failed: z.number()' src/modules/server/events/schema.ts` exits 0
    - The string `PlaylistDownloadCompletedEventSchema` appears at least TWICE in the file (definition + discriminated union entry)
    - `grep -q 'PlaylistDownloadCompletedEvent =' src/modules/server/events/schema.ts` exits 0 (type export)
    - `pnpm typecheck` exits 0
    - `pnpm test src/modules/server/events/` exits 0 (existing tests still green)
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>events/schema.ts has the new event schema + type export + discriminated union entry; the extended union compiles and existing event-bus tests still pass.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement DownloadRepository (track + settings + source reads) + Drizzle in-memory tests</name>
  <files>src/modules/server/downloader/repository.ts, src/modules/server/downloader/repository.test.ts, src/modules/server/downloader/index.ts</files>
  <read_first>
    - src/modules/server/scraper/repository.ts (DI constructor pattern + class shape)
    - src/modules/server/scraper/repository.test.ts (W-5 latest-migration loader pattern at lines 18-32 — COPY VERBATIM)
    - src/modules/server/webhooks/repository.ts (settings JSON GET/UPSERT pattern at lines 13-61)
    - src/modules/server/db/schema.ts (current schema after Plan 03-01 — tracks has album column; invocations has kind column)
    - src/modules/server/downloader/schema.ts (Plan 03-01 — MATCH_SETTINGS_KEY, MatchSettingsSchema, DEFAULT_MATCH_SETTINGS)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "downloader/repository.ts" + "downloader/repository.test.ts")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-07, D-15, D-16)
  </read_first>
  <behavior>
    Class shape:
    ```typescript
    export class DownloadRepository {
        constructor(db?: TDatabase, logger?: AppLogger);

        // Track reads
        getTracksToProcess(sourceId: string): Promise<TrackRow[]>;        // WHERE state IN ('pending','matched') (D-07)

        // Source read (used by runner to get cover_art_url + name for slug)
        getSource(sourceId: string): Promise<SourceRow | null>;

        // Track-row writes — atomic UPDATE of (state + relevant cols + updatedAt)
        markMatched(trackId: string, ytVideoId: string): Promise<void>;
        markDownloaded(trackId: string, downloadPath: string): Promise<void>;
        markFailed(trackId: string, errorType: string, message: string): Promise<void>;
        markSkippedLowConfidence(trackId: string, ytVideoId: string | null, reason: string): Promise<void>;

        // Match settings JSON in global_settings
        getMatchSettings(): Promise<MatchSettings>;
        saveMatchSettings(settings: MatchSettings): Promise<MatchSettings>;
    }
    ```

    Implementation notes:
    - DI constructor mirrors `ScraperRepository` exactly: `(db: TDatabase = getDb(), logger: AppLogger = Logger.get("DownloadRepository"))`.
    - All write methods set `updatedAt: new Date()`.
    - `markFailed` truncates message to 500 chars (T-3-03) and stores as `failure_reason: \`${errorType}: ${tail}\``.
    - `markSkippedLowConfidence` accepts an optional ytVideoId (null means we never persisted one — should still write what we have); the reason string contains `delta=Xs, tolerance=Ys`. Set state='skipped_low_confidence' + ytVideoId (if non-null) + failureReason. Do NOT touch downloadPath.
    - `markDownloaded` sets state='downloaded' + downloadPath; clears failureReason to null (in case it was set on a prior failed run that has since succeeded — this is rare in v1 since the runner only processes pending+matched, but safe).
    - `markMatched` sets state='matched' + ytVideoId; does NOT clear failureReason (left for the next failure to overwrite if needed).
    - `getMatchSettings` mirrors `WebhookRepository.getSettings`: select row, JSON.parse, MatchSettingsSchema.parse — fall back to DEFAULT_MATCH_SETTINGS on missing row OR JSON.parse failure OR Zod validation failure.
    - `saveMatchSettings` upserts via `onConflictDoUpdate` on `globalSettings.key`, using sql\`(unixepoch())\` for updatedAt to mirror the webhook pattern.

    Test coverage (12+ tests, W-5 in-memory pattern):
    1. `getTracksToProcess` returns only state='pending'+'matched' rows for the given sourceId
    2. `getTracksToProcess` excludes 'downloaded', 'failed', 'skipped_low_confidence'
    3. `getTracksToProcess` excludes other sources' rows
    4. `markMatched` writes state + ytVideoId, preserves other fields (title, artist, etc.)
    5. `markDownloaded` writes state + downloadPath
    6. `markFailed` truncates message > 500 chars and prefixes with errorType
    7. `markFailed` stores `<errorType>: <message>` format
    8. `markSkippedLowConfidence` writes state + reason; downloadPath stays null
    9. `markSkippedLowConfidence` writes ytVideoId when provided
    10. `getMatchSettings` returns DEFAULT_MATCH_SETTINGS when row absent
    11. `getMatchSettings` returns parsed JSON when row exists
    12. `getMatchSettings` returns DEFAULT on JSON.parse failure (graceful)
    13. `saveMatchSettings` inserts new row when key absent
    14. `saveMatchSettings` upserts existing row (idempotent re-save)
    15. `getSource` returns the row by id; returns null when absent
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/repository.ts` based on `ScraperRepository` shape. Imports:
       ```typescript
       import { and, eq, inArray, sql } from "drizzle-orm";
       import type { AppLogger } from "~/logger";
       import { Logger } from "~/logger";
       import { getDb, schema, type TDatabase } from "../db";
       import type { SourceRow, TrackRow } from "../db/schema";
       import {
           DEFAULT_MATCH_SETTINGS,
           MATCH_SETTINGS_KEY,
           type MatchSettings,
           MatchSettingsSchema,
       } from "./schema";

       const STDERR_SLICE_LIMIT = 500;
       ```
    2. Implement all 9 methods per the <behavior> spec. Use `inArray(schema.tracks.state, ["pending", "matched"])` for getTracksToProcess. Use `onConflictDoUpdate` for saveMatchSettings (mirror webhooks/repository.ts:39-60 exactly, only swap key).
    3. Create `src/modules/server/downloader/repository.test.ts` based on `scraper/repository.test.ts`. Copy the W-5 `createTestDb()` function VERBATIM (lines 18-32) — it auto-loads the latest migration which now includes the album + kind columns from Plan 03-01.
    4. Add helper `seedTrack(db, overrides)` that inserts a track row with sensible defaults. Use it across the 15+ tests.
    5. Update `src/modules/server/downloader/index.ts` to add `export * from "./repository";`.
    6. Run `pnpm test src/modules/server/downloader/repository.test.ts` until green (15+ tests).
    7. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/repository.ts &amp;&amp; test -f src/modules/server/downloader/repository.test.ts &amp;&amp; grep -q 'export class DownloadRepository' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'getTracksToProcess' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'markMatched' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'markDownloaded' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'markFailed' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'markSkippedLowConfidence' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'getMatchSettings' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'saveMatchSettings' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'inArray.*state.*pending.*matched\|\["pending", "matched"\]' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'STDERR_SLICE_LIMIT = 500' src/modules/server/downloader/repository.ts &amp;&amp; grep -q 'createTestDb' src/modules/server/downloader/repository.test.ts &amp;&amp; grep -q './repository' src/modules/server/downloader/index.ts &amp;&amp; pnpm test src/modules/server/downloader/repository.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/repository.ts` exits 0
    - `test -f src/modules/server/downloader/repository.test.ts` exits 0
    - `grep -q 'export class DownloadRepository' src/modules/server/downloader/repository.ts` exits 0
    - All 9 method names present: `getTracksToProcess`, `getSource`, `markMatched`, `markDownloaded`, `markFailed`, `markSkippedLowConfidence`, `getMatchSettings`, `saveMatchSettings`
    - `grep -q '\["pending", "matched"\]\|inArray.*pending' src/modules/server/downloader/repository.ts` exits 0 (D-07 row selection)
    - `grep -q 'STDERR_SLICE_LIMIT = 500' src/modules/server/downloader/repository.ts` exits 0 (T-3-03)
    - `grep -q 'onConflictDoUpdate' src/modules/server/downloader/repository.ts` exits 0 (settings upsert)
    - `grep -q 'MatchSettingsSchema.parse' src/modules/server/downloader/repository.ts` exits 0
    - `grep -q 'DEFAULT_MATCH_SETTINGS' src/modules/server/downloader/repository.ts` exits 0
    - `grep -q 'createTestDb' src/modules/server/downloader/repository.test.ts` exits 0 (W-5 pattern)
    - `grep -c 'it(' src/modules/server/downloader/repository.test.ts` returns at least 15
    - `pnpm test src/modules/server/downloader/repository.test.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>DownloadRepository exposes all DB primitives DownloadRunner needs; 15+ in-memory tests verify D-07 row selection, T-3-03 stderr cap, settings JSON parse-and-default behavior.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Implement DownloadRunner orchestrator + state machine + per-track failure isolation + emit playlist.download.completed</name>
  <files>src/modules/server/downloader/DownloadRunner.ts, src/modules/server/downloader/DownloadRunner.test.ts, src/modules/server/downloader/index.ts</files>
  <read_first>
    - src/modules/server/scraper/SyncRunner.ts (entire file — lifecycle + finalize pattern + W-1 detection at lines 131-132)
    - src/modules/server/scraper/SyncRunner.test.ts (entire file — fakeBridge / fakeRepo / emitSpy pattern; sourceRow factory at lines 70-87)
    - src/modules/server/downloader/repository.ts (Task 2 output — methods to call)
    - src/modules/server/downloader/YtDlpBridge.ts (Plan 03-02 — probe + download interfaces)
    - src/modules/server/downloader/tagger.ts (Plan 03-03 — embedTags signature)
    - src/modules/server/downloader/cover-art.ts (Plan 03-03 — fetchCoverArt signature)
    - src/modules/server/downloader/slug.ts (Plan 03-01 — sourceSlug + safeFilename)
    - src/modules/server/downloader/schema.ts (Plan 03-01 — YTDLP_CRASH_PREFIX W-1, MatchSettings types)
    - src/modules/server/invocation/repository.ts (InvocationRepository.create + .update signatures)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (sections "DownloadRunner.ts" — full state machine pattern + "DownloadRunner.test.ts" — 10 test targets)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Code Examples §DownloadRunner skeleton; Pitfall #6 EventBus await; Pitfall #7 idempotent skip; Pitfall #8 cover-art non-fatal)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-01..D-07, D-11, D-15)
  </read_first>
  <behavior>
    DownloadRunner.ts shape:
    ```typescript
    import { randomUUID } from "node:crypto";
    import { promises as fs } from "node:fs";
    import path from "node:path";
    import pLimit from "p-limit";
    import type { AppLogger } from "~/logger";
    import { Logger } from "~/logger";
    import type { SourceRow, TrackRow } from "../db/schema";
    import { getEventBus } from "../events";
    import { InvocationRepository } from "../invocation/repository";
    import { fetchCoverArt } from "./cover-art";
    import { DownloadRepository } from "./repository";
    import type { MatchSettings } from "./schema";
    import { YTDLP_CRASH_PREFIX } from "./schema";
    import { safeFilename, sourceSlug } from "./slug";
    import { embedTags } from "./tagger";
    import { YtDlpBridge } from "./YtDlpBridge";

    const MUSIC_ROOT = "data/music";

    export interface DownloadRunnerDeps {
        bridge?: YtDlpBridge;
        repo?: DownloadRepository;
        invocationRepo?: InvocationRepository;
        coverArtFetcher?: typeof fetchCoverArt;
        tagger?: typeof embedTags;
        logger?: AppLogger;
        clock?: () => Date;
        musicRoot?: string;  // override for tests
    }

    export class DownloadRunner {
        constructor(deps: DownloadRunnerDeps = {});
        async run(source: SourceRow): Promise<void>;
    }
    ```

    run(source) lifecycle:
    1. Generate `invocationId = randomUUID()`. Capture `startedAt = clock()`.
    2. Wrap entire body in outer try/catch (Pitfall 8 from SyncRunner — always emit a terminal event/finalize).
    3. Read `tracks = await repo.getTracksToProcess(source.id)`.
    4. If `tracks.length === 0`:
       - Log info "DownloadRunner: zero tracks to process — exit cleanly"
       - Do NOT create an invocation row, do NOT emit playlist.download.completed (no work was done).
       - Return early.
    5. Read `settings = await repo.getMatchSettings()` and snapshot tolerance + parallel.
    6. Create invocation row via `invocationRepo.create({ id: invocationId, playlistId: source.id, startedAt, status: "running", kind: "download" })`.
    7. Compute `slug = sourceSlug(source.name)`, `dir = path.resolve(MUSIC_ROOT, slug)`. Verify `dir.startsWith(path.resolve(MUSIC_ROOT) + path.sep)` OR `dir === path.resolve(MUSIC_ROOT)` — defense-in-depth path-traversal guard (T-3-02). If guard fails, throw with a clear error message that the outer catch will route through finalizeFailure.
    8. `await fs.mkdir(dir, { recursive: true })`.
    9. Create `limit = pLimit(settings.parallel)`. Map tracks to `limit(() => this.processTrack(track, source, dir, settings.tolerance_seconds))`.
    10. `const results = await Promise.allSettled(promises)`.
    11. Aggregate counters from results: `{ total, downloaded, matched_only, skipped_low_confidence, failed }`. (matched_only counts tracks that ended in 'matched' state — typically zero unless a runner crash interrupted between markMatched and markDownloaded; in normal flow nearly all accepted tracks reach 'downloaded'.)
    12. Update invocation row: `invocationRepo.update(invocationId, { finishedAt: clock(), exitCode: 0, status: "success", summary: JSON.stringify(counters) })`.
    13. Emit `playlist.download.completed` with payload mapping snake_case counters to camelCase event keys.
    14. Outer catch: log error, attempt to update invocation row to status='failed' (if it was created) with summary `{ failure_reason: "ytdlp_crash", error: <message> }`. Never re-throw.

    processTrack(track, source, dir, toleranceSeconds) returns one of: `"downloaded" | "skipped_low_confidence" | "failed" | "matched_only"`:
    1. Compute `targetPath = path.join(dir, safeFilename(track.artist, track.title))`.
    2. **Path-traversal guard (T-3-02 defense-in-depth):** verify `path.resolve(targetPath).startsWith(path.resolve(dir) + path.sep)`. If not, mark failed with `tagger_error` (closest enum) and message "path traversal detected" and return "failed".
    3. **Skip-if-exists (D-15):** `try { await fs.access(targetPath); await repo.markDownloaded(track.id, targetPath); return "downloaded"; } catch (err) { if ((err as NodeJS.ErrnoException).code !== "ENOENT") { throw err; } /* proceed */ }`
    4. **Probe (skip if state=matched):**
       - If `track.state === "matched" && track.ytVideoId` → `videoId = track.ytVideoId` (MATCH-04 — reuse).
       - Else: `probe = await bridge.probe(\`${track.artist} ${track.title}\`)`. If `probe.error`:
         - Reclassify ytdlp_crash via W-1: `if (probe.error.message.startsWith(YTDLP_CRASH_PREFIX)) errorType = "ytdlp_crash"; else errorType = probe.error.type;`
         - `await repo.markFailed(track.id, errorType, probe.error.message)`; return "failed".
       - If probe ok:
         - `delta = Math.abs(probe.durationSeconds - Math.round(track.durationMs / 1000))`
         - If `delta > toleranceSeconds`:
           - `reason = \`delta=\${delta}s, tolerance=\${toleranceSeconds}s\``
           - `await repo.markSkippedLowConfidence(track.id, probe.videoId, reason)` (MATCH-03); return "skipped_low_confidence".
         - Else: `await repo.markMatched(track.id, probe.videoId)` (MATCH-02 / D-02); `videoId = probe.videoId`.
    5. **Download:** `dl = await bridge.download(videoId, targetPath)`. If `dl.error`:
       - Reclassify ytdlp_crash via W-1 same as probe.
       - `await repo.markFailed(track.id, errorType, dl.error.message)`; return "failed".
    6. **Cover-art fetch (best-effort, Pitfall #8):** `coverArt = await coverArtFetcher(source.coverArtUrl ?? null)`. NEVER throws.
    7. **Tag (best-effort — try/catch isolates tagger failures from the file existing on disk):**
       ```typescript
       try {
           tagger(targetPath, {
               title: track.title,
               artist: track.artist,
               album: track.album,  // null for playlist tracks (D-13); set by Phase 4 album sources
               coverArt: coverArt,
           });
       } catch (tagErr) {
           // Per Open Q #5 in RESEARCH: file is on disk + playable; tag failure is a quality issue, not data loss.
           // Mark downloaded with a logged warning instead of failed.
           logger.warn({ err: tagErr, trackId: track.id, targetPath }, "tagging failed — file kept; track marked downloaded");
       }
       ```
    8. `await repo.markDownloaded(track.id, targetPath)`. Return "downloaded".

    Counters mapping for event payload:
    - `total: results.length`
    - `downloaded: count of "downloaded" outcomes`
    - `matchedOnly: count of "matched_only" outcomes` (typically 0 in normal flow; non-zero if Promise.allSettled saw a tagger throw or a runner crash mid-track)
    - `skippedLowConfidence: count of "skipped_low_confidence"`
    - `failed: count of "failed" + count of rejected promises`

    Test coverage (matches PATTERNS.md DownloadRunner.test.ts — 10+ targets):
    1. **happy path** — 3 tracks, all probe ok + within tolerance + download ok → all marked downloaded; invocation status=success; counters {total:3, downloaded:3, ...}; playlist.download.completed emitted with matching payload.
    2. **mixed result** — 2 succeed, 1 out-of-tolerance, 1 yt-dlp download fails → counters {downloaded:2, skipped_low_confidence:1, failed:1}; invocation still status=success.
    3. **settings snapshot** — repo.getMatchSettings called once at start; mid-run settings.parallel changes do NOT affect the in-flight pool (verify by counting bridge.probe calls per parallelism).
    4. **MATCH-04 — matched-skip** — track with state='matched' + ytVideoId='cached' → bridge.probe NOT called; bridge.download IS called with cached videoId.
    5. **D-15 skip-if-exists** — pre-create the target file; verify zero spawns and direct markDownloaded; return "downloaded" (counted as downloaded).
    6. **zero tracks** — getTracksToProcess returns []; verify NO invocation row created and NO event emitted.
    7. **tagger fails** — tagger throws; track is still marked downloaded with logged warning (per Open Q #5).
    8. **cover-art fails** — coverArtFetcher returns null; tagger called with coverArt=null; track marked downloaded normally.
    9. **runner crash** — repo.getTracksToProcess throws → outer catch fires; if invocation was already created, update to status=failed; never re-throws.
    10. **W-1 reclassification** — bridge.download returns error with message starting with YTDLP_CRASH_PREFIX → markFailed called with errorType="ytdlp_crash" (not "download_error" even if that was the type field).
    11. **Path traversal blocked (T-3-02)** — track with artist="../etc" (after slug sanitization this should be impossible, but defense-in-depth) — assert that the resolved target path stays under MUSIC_ROOT or the track is marked failed without invoking yt-dlp.
    12. **DOWNLOAD-04 — pLimit(N)** — assert pLimit was constructed with settings.parallel value. Use a tiny test double: 5 tracks, settings.parallel=2, count concurrent in-flight calls — never exceeds 2 at once.
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/DownloadRunner.ts` per the <behavior> spec. Mirror SyncRunner.ts's class shell + DI constructor + outer try/catch shape; replace the loop body with the pLimit fan-out + per-track state machine.
    2. Use `getEventBus()` for the event emission (not injected — mirrors SyncRunner.ts at line 89).
    3. Top-of-file docblock: explain D-01 (split runner), D-02 (state machine), D-03 (per-track isolation), D-15 (skip-if-exists), and the W-1 reclassification of YTDLP_CRASH_PREFIX prefixes.
    4. Add the path-traversal guard (T-3-02) explicitly — comment it as "T-3-02 defense-in-depth: even though slug+filename sanitize, double-check the resolved path is under MUSIC_ROOT before any fs operation".
    5. Create `src/modules/server/downloader/DownloadRunner.test.ts` based on `scraper/SyncRunner.test.ts`. Module-level `vi.mock("../events", () => ({ getEventBus: () => ({ emit: emitSpy }) }))`. Build factories:
       - `fakeBridge({ probeResults: Map, downloadResults: Map })` — returns mocks for probe/download keyed by query/videoId
       - `fakeRepo({ tracks: TrackRow[], settings?: MatchSettings, sourceMissing?: boolean })` — returns DownloadRepository fakes for getTracksToProcess, getMatchSettings, getSource, mark* methods
       - `fakeInvocationRepo()` — same shape as the existing one in SyncRunner.test.ts
       - `fakeCoverArtFetcher()` — returns a mock that resolves to `null` (most tests) or `{ buffer, mime }` (one happy-path test)
       - `fakeTagger()` — vi.fn() that returns undefined; one test makes it throw
       - `sourceRow(overrides)` factory copied from SyncRunner.test.ts
       - `trackRow(overrides)` factory new — with sensible defaults including `state: "pending"`, `album: null`, etc.
    6. For Test 12 (DOWNLOAD-04 concurrency assertion), build a probe mock that increments a counter in-flight and decrements when resolved; assert max in-flight never exceeded settings.parallel.
    7. Update `src/modules/server/downloader/index.ts` to add `export * from "./DownloadRunner";`.
    8. Run `pnpm test src/modules/server/downloader/DownloadRunner.test.ts` until green (12+ tests).
    9. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/DownloadRunner.ts &amp;&amp; test -f src/modules/server/downloader/DownloadRunner.test.ts &amp;&amp; grep -q 'export class DownloadRunner' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'pLimit(settings.parallel)' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'fs.access(targetPath)' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q '"playlist.download.completed"' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'kind: "download"' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'fs.mkdir.*recursive' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'safeFilename\|sourceSlug' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'embedTags' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'fetchCoverArt' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q 'startsWith.*MUSIC_ROOT\|startsWith.*resolve' src/modules/server/downloader/DownloadRunner.ts &amp;&amp; grep -q './DownloadRunner' src/modules/server/downloader/index.ts &amp;&amp; pnpm test src/modules/server/downloader/DownloadRunner.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/DownloadRunner.ts` exits 0
    - `test -f src/modules/server/downloader/DownloadRunner.test.ts` exits 0
    - `grep -q 'export class DownloadRunner' src/modules/server/downloader/DownloadRunner.ts` exits 0
    - `grep -q 'pLimit(settings.parallel)' src/modules/server/downloader/DownloadRunner.ts` exits 0 (DOWNLOAD-04)
    - `grep -q 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/DownloadRunner.ts` exits 0 (W-1 import)
    - `grep -q 'fs.access(targetPath)' src/modules/server/downloader/DownloadRunner.ts` exits 0 (D-15 skip-if-exists)
    - `grep -q '"playlist.download.completed"' src/modules/server/downloader/DownloadRunner.ts` exits 0
    - `grep -q 'kind: "download"' src/modules/server/downloader/DownloadRunner.ts` exits 0 (D-05)
    - `grep -q 'fs.mkdir.*recursive' src/modules/server/downloader/DownloadRunner.ts` exits 0
    - `grep -q 'safeFilename' src/modules/server/downloader/DownloadRunner.ts` exits 0
    - `grep -q 'sourceSlug' src/modules/server/downloader/DownloadRunner.ts` exits 0
    - `grep -q 'embedTags' src/modules/server/downloader/DownloadRunner.ts` exits 0 (DOWNLOAD-02)
    - `grep -q 'fetchCoverArt' src/modules/server/downloader/DownloadRunner.ts` exits 0 (DOWNLOAD-02)
    - `grep -q 'startsWith' src/modules/server/downloader/DownloadRunner.ts` exits 0 (T-3-02 path traversal guard)
    - `grep -q 'state === "matched"' src/modules/server/downloader/DownloadRunner.ts` exits 0 (MATCH-04 reuse)
    - `grep -q 'tolerance_seconds\|toleranceSeconds' src/modules/server/downloader/DownloadRunner.ts` exits 0 (MATCH-02)
    - `grep -q 'skipped_low_confidence\|markSkippedLowConfidence' src/modules/server/downloader/DownloadRunner.ts` exits 0 (MATCH-03)
    - `grep -q './DownloadRunner' src/modules/server/downloader/index.ts` exits 0
    - `grep -c 'it(' src/modules/server/downloader/DownloadRunner.test.ts` returns at least 12
    - `pnpm test src/modules/server/downloader/DownloadRunner.test.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>DownloadRunner orchestrates the per-source pipeline end-to-end with full state machine + per-track failure isolation + W-1 reclassification + path-traversal guard. 12+ tests cover MATCH-01..04, DOWNLOAD-01..05, D-15 idempotent skip, D-03 isolation, T-3-02 path traversal.</done>
</task>

<task type="auto">
  <name>Task 4: Implement EventBus handler + register in Nitro plugin</name>
  <files>src/modules/server/downloader/handler.ts, src/modules/server/downloader/index.ts, server/plugins/events.ts</files>
  <read_first>
    - src/modules/server/webhooks/handler.ts (entire file — 84 lines; THE TEMPLATE TO MIRROR for register pattern)
    - server/plugins/events.ts (existing handler registration site)
    - src/modules/server/events/EventBus.ts (lines 160-178 — confirm await Promise.allSettled handler-await semantics)
    - src/modules/server/db/schema.ts (sources table — for getDb().select(sources).where(...) lookup)
    - src/modules/server/downloader/DownloadRunner.ts (Task 3 output)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (sections "downloader/handler.ts" + "server/plugins/events.ts (MOD)")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-01, D-06)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall #6 — D-06 simplification: no scheduler change needed)
  </read_first>
  <behavior>
    handler.ts shape:
    ```typescript
    import { eq } from "drizzle-orm";
    import type { AppLogger } from "~/logger";
    import { Logger } from "~/logger";
    import { getDb, schema } from "../db";
    import { getEventBus } from "../events";
    import type { PlaylistSyncCompletedEvent } from "../events/schema";
    import { DownloadRunner } from "./DownloadRunner";

    /**
     * Phase 3 D-01: subscribe to playlist.sync.completed (emitted by SyncRunner)
     * and kick DownloadRunner.run for the same source.
     *
     * D-06: EventBus.emit awaits Promise.allSettled(handlers), so this handler's
     * promise transitively keeps the runningPlaylists lock held in
     * PlaylistScheduler.executePlaylistSync until DownloadRunner.run returns.
     * No scheduler code change required (Pitfall #6 — verified at EventBus.ts:177).
     */
    export function registerDownloadHandler(
        logger: AppLogger = Logger.get("DownloadHandler"),
        runner: DownloadRunner = new DownloadRunner(),
    ): () => void {
        const bus = getEventBus();
        const unsubscribe = bus.on(
            "playlist.sync.completed",
            async (event: PlaylistSyncCompletedEvent) => {
                try {
                    const [source] = await getDb()
                        .select()
                        .from(schema.sources)
                        .where(eq(schema.sources.id, event.payload.playlistId));
                    if (!source) {
                        logger.warn(
                            { sourceId: event.payload.playlistId },
                            "Source not found for download handler — skipping",
                        );
                        return;
                    }
                    await runner.run(source);
                } catch (err) {
                    // D-03 per-track failures already isolated inside runner.
                    // This catch only fires for runner-level crashes the runner couldn't self-finalize.
                    logger.error(
                        { err, sourceId: event.payload.playlistId },
                        "DownloadRunner crashed at handler boundary",
                    );
                }
            },
        );

        logger.info("Download handler registered");
        return () => {
            unsubscribe();
            logger.info("Download handler unregistered");
        };
    }
    ```

    Plugin update at server/plugins/events.ts:
    - Add `import { registerDownloadHandler } from "../../src/modules/server/downloader";`
    - After the `registerDiscordWebhookHandler(eventHandlerLogger);` line (around line 55), add:
      ```typescript
      registerDownloadHandler(eventHandlerLogger);
      pluginLogger.info("Download handler registered");
      ```
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/handler.ts` per the <behavior> spec.
    2. Update `src/modules/server/downloader/index.ts` — write the FINAL consolidated barrel. This task owns the full barrel content because Plans 03-02 + 03-03 deliberately deferred index.ts edits to avoid Wave 2 file conflicts. The final barrel content is:
       ```typescript
       export * from "./schema";
       export * from "./slug";
       export * from "./YtDlpBridge";
       export * from "./tagger";
       export * from "./cover-art";
       export * from "./repository";
       export * from "./DownloadRunner";
       export * from "./handler";
       ```
       Note: `./repository` and `./DownloadRunner` were added by Tasks 2 and 3 of this plan; this step ensures the full barrel is in place after Task 4.
    3. Edit `server/plugins/events.ts`:
       a. Add the import at the top with the other handler imports.
       b. Insert the `registerDownloadHandler(eventHandlerLogger);` + `pluginLogger.info(...)` block in registration order after the Discord webhook handler.
    4. Run `pnpm typecheck` and `pnpm check`.
    5. Run `pnpm test` to confirm everything still passes (the existing event-bus-related tests should be unaffected — the new handler only adds, never modifies, the registration chain).
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/handler.ts &amp;&amp; grep -q 'export function registerDownloadHandler' src/modules/server/downloader/handler.ts &amp;&amp; grep -q 'bus.on.*"playlist.sync.completed"' src/modules/server/downloader/handler.ts &amp;&amp; grep -q 'await runner.run(source)' src/modules/server/downloader/handler.ts &amp;&amp; grep -q './handler' src/modules/server/downloader/index.ts &amp;&amp; grep -q 'registerDownloadHandler' server/plugins/events.ts &amp;&amp; grep -q 'from "../../src/modules/server/downloader"' server/plugins/events.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check &amp;&amp; pnpm test</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/handler.ts` exits 0
    - `grep -q 'export function registerDownloadHandler' src/modules/server/downloader/handler.ts` exits 0
    - `grep -q 'bus.on(' src/modules/server/downloader/handler.ts` exits 0
    - `grep -q '"playlist.sync.completed"' src/modules/server/downloader/handler.ts` exits 0
    - `grep -q 'await runner.run(source)' src/modules/server/downloader/handler.ts` exits 0
    - `grep -q './handler' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './schema' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './slug' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './YtDlpBridge' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './tagger' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './cover-art' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './repository' src/modules/server/downloader/index.ts` exits 0
    - `grep -q './DownloadRunner' src/modules/server/downloader/index.ts` exits 0
    - `grep -q 'registerDownloadHandler(eventHandlerLogger)' server/plugins/events.ts` exits 0
    - `grep -q 'from "../../src/modules/server/downloader"' server/plugins/events.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
    - `pnpm test` exits 0 (full suite still green — the registration is additive)
  </acceptance_criteria>
  <done>DownloadHandler subscribes to playlist.sync.completed via the same pattern as the Discord webhook handler; the Nitro plugin registers it on boot. Manual sync-now → scrape → download chain is now wired.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 5: D-06 lock-spans-handler-chain integration test in PlaylistScheduler.test.ts</name>
  <files>src/modules/server/scheduler/PlaylistScheduler.test.ts</files>
  <read_first>
    - src/modules/server/scheduler/PlaylistScheduler.ts (existing executePlaylistSync at lines 84-106)
    - src/modules/server/scheduler/PlaylistScheduler.test.ts (existing test file — we EXTEND with a new describe block)
    - src/modules/server/events/EventBus.ts (real bus is what we use — no mock; the test asserts the real await chain)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "PlaylistScheduler.ts (MOD — verify only)" — explicit test recipe)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall #6 + Open Question #2 — handler.ts location)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-06)
  </read_first>
  <behavior>
    Add a new `describe("D-06 lock spans scrape→download handler chain", ...)` block to the existing `PlaylistScheduler.test.ts`. Two tests:

    1. **Lock held during slow handler**: Use the REAL `EventBus` (not a mock). Subscribe a slow handler that resolves after a configurable delay (e.g. 100ms). Inject a fake SyncRunner that calls `eventBus.emit("playlist.sync.completed", ...)` synchronously then resolves. Trigger `scheduler.triggerManualSync(source)`. Within the 100ms window, assert `scheduler.isRunning(source.id) === true`. After the delay, assert `scheduler.isRunning(source.id) === false`. (This proves the lock survives the emit chain.)

    2. **Concurrent trigger blocked while download in-flight**: Same setup with the slow handler. Call `triggerManualSync` once → returns "triggered". Within the delay window, call `triggerManualSync` again → returns null (rejected by the lock).

    Notes:
    - Test does NOT mock the EventBus — uses `getEventBus()` directly with a clean handler list at start (use `bus.clear()` in `afterEach`).
    - The "fake SyncRunner" is a lightweight class with a `run(source)` method that calls `eventBus.emit({...})` and then resolves. Because EventBus.emit awaits Promise.allSettled, the fake's `run` returns AFTER all subscribers settle.
    - The test uses real `setTimeout`-backed promises in the slow handler to model the DownloadRunner taking time.
  </behavior>
  <action>
    1. Read the current `src/modules/server/scheduler/PlaylistScheduler.test.ts` to understand the existing test infrastructure (factories, beforeEach/afterEach pattern). If the file does not exist yet, create it with a minimal Vitest scaffold.
    2. Add a new `describe("D-06 lock spans scrape→download handler chain", () => { ... })` block. Use `getEventBus()` (REAL singleton) and `bus.clear()` in afterEach.
    3. Test 1 — "Lock held while async handler is in-flight":
       ```typescript
       it("Lock held while playlist.sync.completed handler is in-flight", async () => {
           const bus = getEventBus();
           let resolveHandler!: () => void;
           const handlerDone = new Promise<void>((r) => { resolveHandler = r; });

           bus.on("playlist.sync.completed", async () => {
               await handlerDone;  // simulate slow DownloadRunner
           });

           // Fake SyncRunner that just emits playlist.sync.completed and resolves
           const fakeSyncRunner = {
               run: async (source: SourceRow) => {
                   await bus.emit({
                       type: "playlist.sync.completed",
                       payload: { playlistId: source.id, playlistName: source.name, invocationId: randomUUID(), duration: 1, exitCode: 0 },
                   });
               },
           } as unknown as import("../scraper/SyncRunner").SyncRunner;

           const scheduler = new PlaylistScheduler({ syncRunner: fakeSyncRunner });
           const source = sourceRow();

           const triggerPromise = scheduler.triggerManualSync(source);
           // Manual sync is fire-and-forget at the public API level; allow the executePlaylistSync inner promise to start.
           await Promise.resolve();
           // Wait one microtask for the bus.emit to begin awaiting Promise.allSettled
           await new Promise((r) => setTimeout(r, 10));

           expect(scheduler.isRunning(source.id)).toBe(true);

           resolveHandler();
           // Wait for the async work to flush
           await new Promise((r) => setTimeout(r, 10));

           expect(scheduler.isRunning(source.id)).toBe(false);
           await triggerPromise;
       });
       ```
    4. Test 2 — "Second trigger rejected while first is in-flight":
       ```typescript
       it("Second triggerManualSync returns null while first is in-flight (D-06)", async () => {
           const bus = getEventBus();
           let resolveHandler!: () => void;
           const handlerDone = new Promise<void>((r) => { resolveHandler = r; });

           bus.on("playlist.sync.completed", async () => { await handlerDone; });

           const fakeSyncRunner = {
               run: async (source: SourceRow) => {
                   await bus.emit({ type: "playlist.sync.completed", payload: {...} });
               },
           } as unknown as import("../scraper/SyncRunner").SyncRunner;

           const scheduler = new PlaylistScheduler({ syncRunner: fakeSyncRunner });
           const source = sourceRow();

           const first = await scheduler.triggerManualSync(source);
           expect(first).toBe("triggered");

           await new Promise((r) => setTimeout(r, 10));

           const second = await scheduler.triggerManualSync(source);
           expect(second).toBeNull();

           resolveHandler();
           await new Promise((r) => setTimeout(r, 50));
       });
       ```
    5. Add `afterEach(() => { getEventBus().clear(); })` to ensure handler isolation between tests.
    6. Run `pnpm test src/modules/server/scheduler/PlaylistScheduler.test.ts` until green.
    7. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>grep -q 'D-06\|lock.*span\|spans.*handler' src/modules/server/scheduler/PlaylistScheduler.test.ts &amp;&amp; grep -q 'isRunning' src/modules/server/scheduler/PlaylistScheduler.test.ts &amp;&amp; grep -q 'triggerManualSync' src/modules/server/scheduler/PlaylistScheduler.test.ts &amp;&amp; grep -q 'getEventBus' src/modules/server/scheduler/PlaylistScheduler.test.ts &amp;&amp; pnpm test src/modules/server/scheduler/PlaylistScheduler.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q 'D-06\|lock.*span\|spans.*handler' src/modules/server/scheduler/PlaylistScheduler.test.ts` exits 0
    - `grep -q 'isRunning' src/modules/server/scheduler/PlaylistScheduler.test.ts` exits 0 (D-06 assertion uses isRunning)
    - `grep -q 'triggerManualSync' src/modules/server/scheduler/PlaylistScheduler.test.ts` exits 0
    - `grep -q 'getEventBus()' src/modules/server/scheduler/PlaylistScheduler.test.ts` exits 0 (uses real bus, not mock)
    - `grep -c '"playlist.sync.completed"' src/modules/server/scheduler/PlaylistScheduler.test.ts` returns at least 1
    - `pnpm test src/modules/server/scheduler/PlaylistScheduler.test.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>D-06 is testable + green. The runningPlaylists lock survives the entire scrape→emit→handler→DownloadRunner chain via EventBus's Promise.allSettled await, with no scheduler code change. Pitfall #6 (research finding) is now contract-locked by an automated test.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Spotify-scraped artist+title → filename construction | Untrusted from filesystem-safety perspective; flows through slug.ts (Plan 03-01) and is double-checked by path.resolve guard in DownloadRunner. |
| yt-dlp stderr → failure_reason DB column | Untrusted output bounded by 500-char slice in DownloadRepository.markFailed and YtDlpBridge synthesis. |
| source.coverArtUrl (DB) → fetchCoverArt | Trusted from spotifyscraper but defense-in-depth in cover-art.ts (Plan 03-03). DownloadRunner consumes via the safe wrapper only. |
| EventBus event payload (playlist.sync.completed) → handler | Schema-validated by EventBus during emit; handler reads only `event.payload.playlistId`. |
| sourceId DB lookup → DownloadRunner.run(source) | The handler queries sources WHERE id=event.payload.playlistId; if no row, runner is not invoked. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-3-02 | Tampering | DownloadRunner output path construction | mitigate | (a) artist+title sanitized via `safeFilename` (Plan 03-01) — strips `/`, `\`, `..`, null bytes, control chars, Windows reserved names. (b) source.name sanitized via `sourceSlug`. (c) `path.resolve(targetPath).startsWith(path.resolve(MUSIC_ROOT) + path.sep)` defense-in-depth check before any fs op — if the resolved path escapes MUSIC_ROOT (e.g. someone bypasses the slug helpers in the future), the track is marked failed without invoking yt-dlp. Test #11 in DownloadRunner.test.ts asserts this guard. |
| T-3-03 | Information Disclosure | DownloadRepository.markFailed `failure_reason` | mitigate | `STDERR_SLICE_LIMIT = 500` truncates message before write; `failure_reason: \`${errorType}: ${tail}\`` format limits per-row size to ~520 chars. Phase 5's webhook integration will further sanitize via the existing T-2-05 sanitizer (planner-deferred). |
| T-3-05 | Tampering | yt-dlp `.part` file false-positive | mitigate | D-15 skip-if-exists check uses the FINAL filename (`Artist - Title.mp3`), NOT `.part`. yt-dlp atomically renames `.part` → final on success. If a runner crashes mid-download, the `.part` is orphaned but the next run correctly sees no final file and re-downloads. Pitfall #5 documents this; the test "skip-if-exists" verifies the check uses the final filename only. |
| T-3-06 | Information Disclosure | DownloadHandler crash logging | mitigate | Outer try/catch in handler.ts catches runner-level crashes; `logger.error({err, sourceId}, "...")` logs structured details but does NOT re-throw — preserves the bus's other handlers and the scheduler's lock-release semantics. |
| T-3-07 | DoS | Unbounded pLimit concurrency | mitigate | `MatchSettingsSchema.parallel` is a Zod union of literals 2|3|4. Even a corrupted DB row falls back to DEFAULT_MATCH_SETTINGS (parallel=3) because `MatchSettingsSchema.parse({})` enforces the bound. |
| T-3-08 | Tampering | Per-track failure poisons run | accept | D-03 explicit user choice: per-track failures are isolated; a failed/poisoned track marks state=failed and the run continues. Acceptable v1 trade-off — a malicious source can fill the failure_reason column on its own tracks but cannot block other sources or affect global state. |
| T-3-18 | Tampering | Album field source for TALB | mitigate | Phase 3 always sets `album: null` for playlist tracks (D-13). Phase 4 will populate album from source.name for album sources. The tagger.ts function omits TALB when album is undefined/null/empty — no chance of writing untrusted album text to MP3 in Phase 3. |
</threat_model>

<verification>
After all 5 tasks complete:

1. `pnpm test` — full suite green (including all new downloader/* tests AND extended scheduler test)
2. `pnpm typecheck` — clean
3. `pnpm check` — Biome happy
4. `grep -rn 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/` — only schema.ts defines it; bridge.ts + DownloadRunner.ts import it (no literal duplication)
5. `grep -rn 'shell: true' src/modules/server/` — zero matches
6. The full chain compiles: scheduler → SyncRunner → emit → DownloadHandler → DownloadRunner.run → mark* writes → emit playlist.download.completed
7. Existing scraper tests still pass (Phase 2 contract preserved)
</verification>

<success_criteria>
- Every Phase 3 requirement (MATCH-01..04, DOWNLOAD-01..05) traceable to at least one test in src/modules/server/downloader/
- D-06 lock-spans-handler-chain test green (Pitfall #6 contract-locked)
- The Nitro plugin registers DownloadHandler on startup; manual sync-now button still works (Phase 2 D-04 unchanged) and now triggers the full pipeline
- Per-track failure isolation (D-03) verified: a yt-dlp crash on track #2 doesn't prevent track #3 from being processed
- Path-traversal guard (T-3-02) tested with a hostile artist/title input
- After this plan, only Plan 03-05 (gated integration test + manual smoke) remains for Phase 3 to be ship-ready
</success_criteria>

<output>
After completion, create `.planning/phases/03-match-download-slice-end-to-end-mp3/03-04-SUMMARY.md`.
</output>
