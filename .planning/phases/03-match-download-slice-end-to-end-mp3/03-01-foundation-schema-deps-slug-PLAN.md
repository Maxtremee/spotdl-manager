---
phase: 03-match-download-slice-end-to-end-mp3
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/modules/server/db/schema.ts
  - src/env.ts
  - src/modules/server/db/seed.ts
  - package.json
  - pnpm-lock.yaml
  - scraper/requirements.txt
  - Dockerfile
  - Dockerfile.dev
  - src/modules/server/downloader/schema.ts
  - src/modules/server/downloader/slug.ts
  - src/modules/server/downloader/slug.test.ts
  - src/modules/server/downloader/index.ts
  - drizzle/0001_*.sql
  - drizzle/meta/_journal.json
  - drizzle/meta/0001_snapshot.json
autonomous: true
requirements: [DOWNLOAD-02, DOWNLOAD-03, DOWNLOAD-04, MATCH-02]
user_setup: []

must_haves:
  truths:
    - "tracks table has a nullable album column populated as null for existing playlist rows"
    - "invocations table has a kind column with default 'scrape' applied to existing rows"
    - "Drizzle migration has been generated AND applied via pnpm db:push so the live SQLite schema matches schema.ts"
    - "node-id3, p-limit, and slugify are installed in package.json and lockfile"
    - "yt-dlp 2026.3.17 is added to scraper/requirements.txt and installed inside the scraper venv layer in both Dockerfiles"
    - "YT_DLP_BIN environment variable is validated via src/env.ts (optional, mirrors PYTHON_BIN)"
    - "global_settings has a default 'match' row with {tolerance_seconds:3, parallel:3} JSON value"
    - "downloader/slug.ts exports sourceSlug() and safeFilename() that produce deterministic, cross-platform-safe paths"
    - "downloader/schema.ts exports Zod schemas (YtDlpProbeEnvelopeSchema, YtDlpDownloadEnvelopeSchema, YtDlpErrorSchema, MatchSettingsSchema) and W-1 constant YTDLP_CRASH_PREFIX"
  artifacts:
    - path: "src/modules/server/db/schema.ts"
      provides: "Tracks.album (nullable) + Invocations.kind (enum scrape|download, default scrape)"
      contains: "album: text(\"album\")"
    - path: "src/env.ts"
      provides: "YT_DLP_BIN validator"
      contains: "YT_DLP_BIN"
    - path: "src/modules/server/db/seed.ts"
      provides: "Default match settings row inserted via onConflictDoNothing"
      contains: "globalSettings"
    - path: "package.json"
      provides: "node-id3, p-limit, slugify dependency declarations"
      contains: "\"node-id3\""
    - path: "scraper/requirements.txt"
      provides: "Pinned yt-dlp PyPI install"
      contains: "yt-dlp=="
    - path: "Dockerfile"
      provides: "yt-dlp installed into scraper venv via existing pip line; ENV YT_DLP_BIN set"
      contains: "YT_DLP_BIN"
    - path: "Dockerfile.dev"
      provides: "yt-dlp installed into scraper venv via existing pip line; ENV YT_DLP_BIN set"
      contains: "YT_DLP_BIN"
    - path: "src/modules/server/downloader/schema.ts"
      provides: "YtDlpProbeEnvelopeSchema, YtDlpDownloadEnvelopeSchema, YtDlpErrorSchema, MatchSettingsSchema, MATCH_SETTINGS_KEY, YTDLP_CRASH_PREFIX, DEFAULT_MATCH_SETTINGS"
      contains: "YTDLP_CRASH_PREFIX"
    - path: "src/modules/server/downloader/slug.ts"
      provides: "sourceSlug(name) + safeFilename(artist,title) helpers"
      contains: "export function sourceSlug"
    - path: "src/modules/server/downloader/slug.test.ts"
      provides: "Pure unit tests for slug + filename sanitization including Windows reserved names"
      contains: "describe"
    - path: "src/modules/server/downloader/index.ts"
      provides: "Barrel exporting schema + slug (downstream plans extend with additional exports)"
      contains: "export * from"
    - path: "drizzle/0001_*.sql"
      provides: "Generated SQLite migration adding album + kind columns"
      contains: "ALTER TABLE"
  key_links:
    - from: "src/modules/server/db/schema.ts"
      to: "live SQLite (data/db.sqlite)"
      via: "pnpm db:generate then pnpm db:push (BLOCKING task)"
      pattern: "pnpm db:push"
    - from: "src/modules/server/downloader/schema.ts"
      to: "src/modules/server/downloader/slug.ts"
      via: "co-located in same downloader module — no direct import yet (consumed by Plan 03-02 + 03-04)"
      pattern: "src/modules/server/downloader/"
    - from: "package.json"
      to: "node_modules"
      via: "pnpm install"
      pattern: "pnpm install"
---

<objective>
Lay the foundation that every other Phase 3 plan depends on: schema columns, dependencies, the W-1 schema constants module, the slug+filename helpers, the default match settings seed, and the Docker yt-dlp install. Includes the [BLOCKING] schema push task — without it, any later task that touches the new `album` or `kind` columns at runtime will fail with a SQLite error even though TypeScript will happily compile.

Purpose: Single Wave 1 plan that unblocks Wave 2 (`YtDlpBridge` + tagger/cover-art) and Wave 3 (`DownloadRunner`). Implements decisions D-05 (kind discriminator on invocations), D-10 (YT_DLP_BIN env var), D-13 (nullable album column + null-for-playlists rule), D-15 (filename sanitization), D-16 (match settings defaults). Lays groundwork for D-08 (probe envelope shape via Zod schemas).

Output: Schema migration applied, dependencies installed, two new files in `src/modules/server/downloader/` (`schema.ts` + `slug.ts` + `index.ts` + `slug.test.ts`), Docker images updated to install yt-dlp into the existing scraper venv, default match settings seeded, env validator extended.
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
@.planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md
@.claude/skills/spike-findings-spotdl-manager/SKILL.md
@CLAUDE.md
@src/modules/server/db/schema.ts
@src/modules/server/scraper/schema.ts
@src/modules/server/webhooks/repository.ts
@src/modules/server/webhooks/schema.ts
@src/env.ts
@src/modules/server/db/seed.ts
@Dockerfile
@Dockerfile.dev
@scraper/requirements.txt
@package.json
@drizzle/0000_tranquil_squadron_sinister.sql

<interfaces>
<!-- Existing types and patterns the executor must respect. Extracted from codebase. -->
<!-- Phase 1 lock — DO NOT modify (state enum, unique key); only ADD album column. -->
From src/modules/server/db/schema.ts (current shape):
```typescript
export const tracks = sqliteTable("tracks", {
    id, sourceId, spotifyTrackId, title, artist, durationMs,
    state: text("state", { enum: ["pending","matched","downloaded","skipped_low_confidence","failed"] })
        .default("pending").notNull(),
    ytVideoId, downloadPath, failureReason, position, createdAt, updatedAt,
}, (t) => [
    unique("tracks_source_spotify_unique").on(t.sourceId, t.spotifyTrackId),
    index("tracks_source_id_idx").on(t.sourceId),
    index("tracks_state_idx").on(t.state),
]);

export const invocations = sqliteTable("invocations", {
    id, playlistId, startedAt, finishedAt, exitCode,
    status: text("status", { enum: ["running","success","failed","canceled"] })
        .default("running").notNull(),
    logPath, syncFilePath, summary,
});

export const globalSettings = sqliteTable("global_settings", {
    key: text("key").primaryKey().notNull(),
    value: text("value").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull().default(sql`(unixepoch())`),
});
```

From src/modules/server/scraper/schema.ts — W-1 pattern to mirror:
```typescript
export const PYTHON_CRASH_PREFIX = "python crash:";
// Bridge writes the prefix; Runner detects via .startsWith(PYTHON_CRASH_PREFIX).
```

From src/modules/server/webhooks/schema.ts (settings JSON pattern):
```typescript
export const WEBHOOK_SETTINGS_KEY = "webhook";
export const WebhookSettingsSchema = z.object({ ... });
export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = WebhookSettingsSchema.parse({...});
```

From src/env.ts (current shape — extend, don't replace):
```typescript
export const env = createEnv({
    server: {
        SERVER_URL: z.url().optional(),
        PYTHON_BIN: z.string().min(1).optional(),
    },
    clientPrefix: "VITE_",
    client: { VITE_APP_TITLE: z.string().min(1).optional() },
    runtimeEnv: import.meta.env,
    emptyStringAsUndefined: true,
});
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Add album column to tracks + kind column to invocations + extend env validator</name>
  <files>src/modules/server/db/schema.ts, src/env.ts</files>
  <read_first>
    - src/modules/server/db/schema.ts (current shape — Phase 1 lock; only ADD; never touch state enum or tracks_source_spotify_unique)
    - src/env.ts (current shape — extend the `server: {}` block; do not replace)
    - .planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md (Phase 1 D-09 + D-10 locks)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-05, D-10, D-13)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "src/modules/server/db/schema.ts" — extend-only rule)
  </read_first>
  <behavior>
    - tracks.album: text column, nullable. Existing rows accept null without migration error.
    - invocations.kind: text enum column ['scrape', 'download'] with default 'scrape', NOT NULL — existing rows backfill to 'scrape' via DEFAULT.
    - env.YT_DLP_BIN: optional string (mirrors PYTHON_BIN); referenced by YtDlpBridge in Plan 03-02 with PATH fallback to "yt-dlp".
    - schema.ts file still exports the same TrackRow/NewTrackRow/InvocationRow/NewInvocationRow types via $inferSelect/$inferInsert — they automatically gain the new columns.
    - No change to state enum, tracks_source_spotify_unique, tracks_source_id_idx, tracks_state_idx.
  </behavior>
  <action>
    1. Edit `src/modules/server/db/schema.ts`:
       a. In the `tracks` sqliteTable definition (between `failureReason: text("failure_reason"),` and `position: integer("position").notNull(),`), add the line:
          ```typescript
          // Phase 3 D-13: nullable; populated by Phase 4 album sources, stays null for playlist tracks.
          album: text("album"),
          ```
       b. In the `invocations` sqliteTable definition (after `summary: text("summary"),`), add:
          ```typescript
          // Phase 3 D-05: discriminator so consumers can tell scrape rows apart from download rows.
          kind: text("kind", { enum: ["scrape", "download"] })
              .default("scrape")
              .notNull(),
          ```
       c. Update the docblock above `invocations` from "Phase 3 will rework the invocations table semantics." to "Phase 3 D-05: `kind` column added — defaults to 'scrape' so existing rows stay correctly classified."
    2. Edit `src/env.ts`:
       a. In the `server: { ... }` block, after `PYTHON_BIN: z.string().min(1).optional(),`, add:
          ```typescript
          /**
           * Phase 3 D-10: override the yt-dlp binary path. Default is "yt-dlp" (resolved via PATH).
           * Docker images set this to /app/scraper/.venv/bin/yt-dlp because yt-dlp installs into
           * the existing spotifyscraper venv (see scraper/requirements.txt).
           */
          YT_DLP_BIN: z.string().min(1).optional(),
          ```
    3. Run `pnpm typecheck` to confirm the new column types propagate cleanly through TrackRow / NewInvocationRow.
  </action>
  <verify>
    <automated>grep -q 'album: text("album")' src/modules/server/db/schema.ts &amp;&amp; grep -q 'kind: text("kind", { enum: \["scrape", "download"\] })' src/modules/server/db/schema.ts &amp;&amp; grep -q "YT_DLP_BIN: z.string().min(1).optional()" src/env.ts &amp;&amp; pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q 'album: text("album")' src/modules/server/db/schema.ts` exits 0
    - `grep -q 'kind: text("kind", { enum: \["scrape", "download"\] })' src/modules/server/db/schema.ts` exits 0
    - `grep -q '\.default("scrape")' src/modules/server/db/schema.ts` exits 0
    - `grep -q 'YT_DLP_BIN: z.string().min(1).optional()' src/env.ts` exits 0
    - `grep -q 'state: text("state"' src/modules/server/db/schema.ts` STILL exits 0 (Phase 1 lock not touched)
    - `grep -q 'tracks_source_spotify_unique' src/modules/server/db/schema.ts` STILL exits 0 (Phase 1 lock not touched)
    - `pnpm typecheck` exits 0
  </acceptance_criteria>
  <done>schema.ts gains exactly two new columns (album, kind); state enum + unique key untouched; env.ts gains YT_DLP_BIN validator; typecheck is green.</done>
</task>

<task type="auto">
  <name>Task 2: Install pnpm deps + add yt-dlp to scraper venv + wire YT_DLP_BIN in Docker</name>
  <files>package.json, pnpm-lock.yaml, scraper/requirements.txt, Dockerfile, Dockerfile.dev</files>
  <read_first>
    - package.json (current deps — add three more; do not touch unrelated lines)
    - scraper/requirements.txt (current single line: spotifyscraper==2.1.5)
    - Dockerfile (existing pip-into-venv layer at lines 70-73)
    - Dockerfile.dev (existing pip-into-venv layer at lines 31-33)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (sections "Standard Stack", "Installation", "Pinning yt-dlp" — recommended approach: requirements.txt)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "Dockerfile + Dockerfile.dev (MOD)")
  </read_first>
  <behavior>
    - package.json gains node-id3@0.2.9, p-limit@7.3.0, slugify@1.6.9 in dependencies. pnpm-lock.yaml updates accordingly.
    - scraper/requirements.txt has yt-dlp==2026.3.17 on a new line (spotifyscraper line untouched).
    - Both Dockerfiles set `ENV YT_DLP_BIN=/app/scraper/.venv/bin/yt-dlp` so the Node runtime resolves the binary deterministically inside the container.
    - The existing pip install line in both Dockerfiles automatically picks up the new requirements.txt entry — no Dockerfile pip-line edit needed.
    - `pnpm install` runs cleanly with no peer-dep errors. Biome stays happy (these libs are zero-config).
  </behavior>
  <action>
    1. Run `pnpm add node-id3@0.2.9 p-limit@7.3.0 slugify@1.6.9` from the repo root. This updates package.json `dependencies` and pnpm-lock.yaml. Confirm package.json shows all three at exactly those versions (per RESEARCH §Standard Stack — these are the verified latest stable versions).
    2. Edit `scraper/requirements.txt`:
       - Append a new line: `yt-dlp==2026.3.17`
       - Final file is two lines (spotifyscraper line first, yt-dlp line second). Trailing newline preserved.
    3. Edit `Dockerfile` — after the existing `RUN python3 -m venv /app/scraper/.venv ... && chown -R node:node /app/scraper` block (around line 73), add:
       ```dockerfile
       # Phase 3 D-10: pin yt-dlp binary path for the Node runtime (PATH-resolved fallback in dev).
       ENV YT_DLP_BIN=/app/scraper/.venv/bin/yt-dlp
       ```
    4. Edit `Dockerfile.dev` — after the existing `RUN python3 -m venv /app/scraper/.venv ... requirements.txt` block (around line 33), add:
       ```dockerfile
       # Phase 3 D-10: pin yt-dlp binary path for the Node runtime.
       ENV YT_DLP_BIN=/app/scraper/.venv/bin/yt-dlp
       ```
    5. Run `pnpm install --frozen-lockfile` to confirm the lockfile is consistent (regenerate via plain `pnpm install` if needed, then re-test).
    6. Run `pnpm typecheck` to confirm none of the new modules break TS resolution (node-id3 ships its own .d.ts; slugify and p-limit have @types or built-in typings).
  </action>
  <verify>
    <automated>grep -q '"node-id3"' package.json &amp;&amp; grep -q '"p-limit"' package.json &amp;&amp; grep -q '"slugify"' package.json &amp;&amp; grep -q '^yt-dlp==2026\.3\.17$' scraper/requirements.txt &amp;&amp; grep -q 'ENV YT_DLP_BIN=/app/scraper/\.venv/bin/yt-dlp' Dockerfile &amp;&amp; grep -q 'ENV YT_DLP_BIN=/app/scraper/\.venv/bin/yt-dlp' Dockerfile.dev &amp;&amp; pnpm install --frozen-lockfile &amp;&amp; pnpm typecheck</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q '"node-id3":' package.json` exits 0
    - `grep -q '"p-limit":' package.json` exits 0
    - `grep -q '"slugify":' package.json` exits 0
    - `grep -c 'spotifyscraper==' scraper/requirements.txt` returns 1
    - `grep -c 'yt-dlp==' scraper/requirements.txt` returns 1
    - `grep -q 'ENV YT_DLP_BIN=/app/scraper/\.venv/bin/yt-dlp' Dockerfile` exits 0
    - `grep -q 'ENV YT_DLP_BIN=/app/scraper/\.venv/bin/yt-dlp' Dockerfile.dev` exits 0
    - `pnpm install --frozen-lockfile` exits 0
    - `pnpm typecheck` exits 0
  </acceptance_criteria>
  <done>All three npm deps installed at pinned versions; yt-dlp pinned in requirements.txt; both Dockerfiles export YT_DLP_BIN; lockfile consistent; typecheck green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Create downloader/schema.ts (Zod schemas + W-1 constants) + downloader/slug.ts + tests + barrel</name>
  <files>src/modules/server/downloader/schema.ts, src/modules/server/downloader/slug.ts, src/modules/server/downloader/slug.test.ts, src/modules/server/downloader/index.ts</files>
  <read_first>
    - src/modules/server/scraper/schema.ts (W-1 PYTHON_CRASH_PREFIX pattern at lines 5-15 — copy structure exactly)
    - src/modules/server/scraper/index.ts (barrel pattern — single-line re-exports)
    - src/modules/server/webhooks/schema.ts (settings-defaults pattern: KEY constant + Schema + DEFAULT)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (sections "downloader/schema.ts", "downloader/slug.ts", "downloader/index.ts")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall 4 — Windows reserved names; recommended slug helper code; Pattern 4 — Match settings)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-15, D-16)
  </read_first>
  <behavior>
    schema.ts exports:
      - YTDLP_CRASH_PREFIX = "yt-dlp crash:" (W-1; bridge writes, runner detects via .startsWith)
      - YtDlpErrorSchema: z.object with type enum ["no_results","network_error","download_error","ffmpeg_error","ytdlp_crash","tagger_error"]
      - YtDlpProbeEnvelopeSchema: { videoId: string|null, durationSeconds: number|null, error: YtDlpError|null }
      - YtDlpDownloadEnvelopeSchema: { error: YtDlpError|null }
      - MATCH_SETTINGS_KEY = "match"
      - MatchSettingsSchema: { tolerance_seconds: int 0..60 default 3, parallel: 2|3|4 default 3 }
      - DEFAULT_MATCH_SETTINGS: MatchSettings (parsed from {})
      - All inferred types exported as well

    slug.ts exports two pure functions:
      - sourceSlug(name: string): string — uses slugify({lower:true, strict:true, trim:true}); falls back to "untitled" on empty
      - safeFilename(artist: string, title: string): string — strips filesystem-unsafe chars, handles Windows reserved names, caps at 200 chars total, appends ".mp3"

    slug.test.ts covers:
      - sourceSlug("Today's Top Hits") → "todays-top-hits"
      - sourceSlug("Daily Mix #1") → "daily-mix-1"
      - sourceSlug("") → "untitled"
      - sourceSlug("日本語 タイトル") → non-empty deterministic string (trans-literal or slugify default)
      - safeFilename("Artist", "Title") → "Artist - Title.mp3"
      - safeFilename("Bad/Char\\Name", "X*Y?Z") → no /,\,*,? in result; ends with .mp3
      - safeFilename("CON", "Test") → starts with "_" (Windows reserved name protection)
      - safeFilename("PRN", "X") → starts with "_"
      - safeFilename("AUX", "X") → starts with "_"
      - safeFilename("NUL", "X") → starts with "_"
      - safeFilename("COM1", "X") → starts with "_"
      - safeFilename("LPT9", "X") → starts with "_"
      - safeFilename("Trailing.", "Dots..") → no trailing dots before .mp3 extension
      - safeFilename(very-long-string, very-long-string) → length ≤ 204 chars (200 + ".mp3")
      - safeFilename returns same value for same input (deterministic)

    index.ts barrel exports schema + slug (NO YtDlpBridge / DownloadRunner / handler / tagger / cover-art / repository yet — those land in later plans).
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/schema.ts` with EXACT content:
       ```typescript
       import { z } from "zod";

       /**
        * Shared prefix for synthesized yt-dlp crash envelope messages.
        *
        * W-1: YtDlpBridge (Plan 03-02) writes this prefix in the synthesized error
        * envelope when yt-dlp exits non-zero without parseable stdout. DownloadRunner
        * (Plan 03-04) detects via `.startsWith(YTDLP_CRASH_PREFIX)` and reclassifies.
        * Bridge writes: `${YTDLP_CRASH_PREFIX} exit=N signal=... stderr=...`.
        */
       export const YTDLP_CRASH_PREFIX = "yt-dlp crash:";

       /**
        * Phase 3 D-08 / D-09: typed failure taxonomy for the YtDlpBridge envelope.
        * - no_results: empty stdout + exit 0 (yt-dlp ytsearch1 zero-hits, gh#8033)
        * - network_error: DNS / connection failure
        * - download_error: yt-dlp non-zero during download (e.g. 403, age-gated)
        * - ffmpeg_error: ffmpeg post-processor failure
        * - ytdlp_crash: unexpected non-zero exit / unparseable output
        * - tagger_error: node-id3 write failure (synthesized DownloadRunner-side, not bridge)
        */
       export const YtDlpErrorSchema = z.object({
           type: z.enum([
               "no_results",
               "network_error",
               "download_error",
               "ffmpeg_error",
               "ytdlp_crash",
               "tagger_error",
           ]),
           message: z.string(),
       });
       export type YtDlpError = z.infer<typeof YtDlpErrorSchema>;

       /**
        * Probe envelope: yt-dlp --print id --print duration --skip-download.
        * stdout shape: "<videoId>\n<durationSeconds>\n" parsed by the bridge into the fields below.
        */
       export const YtDlpProbeEnvelopeSchema = z.object({
           videoId: z.string().min(1).nullable(),
           durationSeconds: z.number().int().nonnegative().nullable(),
           error: YtDlpErrorSchema.nullable(),
       });
       export type YtDlpProbeEnvelope = z.infer<typeof YtDlpProbeEnvelopeSchema>;

       /**
        * Download envelope: success carries no payload, failure carries a typed error.
        */
       export const YtDlpDownloadEnvelopeSchema = z.object({
           error: YtDlpErrorSchema.nullable(),
       });
       export type YtDlpDownloadEnvelope = z.infer<typeof YtDlpDownloadEnvelopeSchema>;

       /**
        * Phase 3 D-16: match-settings JSON row in global_settings.
        * Read once at DownloadRunner.run start; mid-run setting changes do NOT apply.
        */
       export const MATCH_SETTINGS_KEY = "match" as const;

       export const MatchSettingsSchema = z.object({
           tolerance_seconds: z.number().int().min(0).max(60).default(3),
           parallel: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
       });
       export type MatchSettings = z.infer<typeof MatchSettingsSchema>;

       export const DEFAULT_MATCH_SETTINGS: MatchSettings = MatchSettingsSchema.parse({});
       ```
    2. Create `src/modules/server/downloader/slug.ts` with EXACT content:
       ```typescript
       /**
        * Phase 3 D-15: deterministic, cross-platform-safe path helpers.
        *
        * sourceSlug — folder name under data/music/<slug>/. slugify with strict mode
        * strips filesystem-unsafe chars and lowercases. Empty input → "untitled".
        *
        * safeFilename — "Artist - Title.mp3" filename with Windows reserved-name protection.
        */
       import slugify from "slugify";

       const FS_UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
       const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
       const MAX_FILENAME_LEN = 200;

       export function sourceSlug(name: string): string {
           const slug = slugify(name, { lower: true, strict: true, trim: true });
           return slug.length > 0 ? slug : "untitled";
       }

       export function safeFilename(artist: string, title: string): string {
           const sanitize = (s: string): string =>
               s.replace(FS_UNSAFE_CHARS, "_").trim().replace(/\.+$/, "");
           const safeArtist = sanitize(artist);
           const safeTitle = sanitize(title);
           let basename = `${safeArtist} - ${safeTitle}`;
           // Windows reserved name guard (case-insensitive, with or without extension).
           if (WINDOWS_RESERVED.test(safeArtist) || WINDOWS_RESERVED.test(basename)) {
               basename = `_${basename}`;
           }
           if (basename.length > MAX_FILENAME_LEN) {
               basename = basename.slice(0, MAX_FILENAME_LEN);
           }
           return `${basename}.mp3`;
       }
       ```
    3. Create `src/modules/server/downloader/slug.test.ts` with at least the 14 cases listed in the behavior block. Use Vitest's `describe`/`it`/`expect`. Tabs, double quotes, `import` syntax with `verbatimModuleSyntax`. Include at least one assertion that tests determinism (`expect(safeFilename("A","B")).toBe(safeFilename("A","B"))`).
    4. Create `src/modules/server/downloader/index.ts` with EXACT content:
       ```typescript
       export * from "./schema";
       export * from "./slug";
       ```
    5. Run `pnpm test src/modules/server/downloader/slug.test.ts` and confirm green.
    6. Run `pnpm typecheck` and `pnpm check` (Biome) — both must be green.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/schema.ts &amp;&amp; test -f src/modules/server/downloader/slug.ts &amp;&amp; test -f src/modules/server/downloader/slug.test.ts &amp;&amp; test -f src/modules/server/downloader/index.ts &amp;&amp; grep -q 'YTDLP_CRASH_PREFIX = "yt-dlp crash:"' src/modules/server/downloader/schema.ts &amp;&amp; grep -q 'MATCH_SETTINGS_KEY = "match"' src/modules/server/downloader/schema.ts &amp;&amp; grep -q 'export function sourceSlug' src/modules/server/downloader/slug.ts &amp;&amp; grep -q 'export function safeFilename' src/modules/server/downloader/slug.ts &amp;&amp; grep -q 'WINDOWS_RESERVED' src/modules/server/downloader/slug.ts &amp;&amp; pnpm test src/modules/server/downloader/slug.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/schema.ts` exits 0
    - `test -f src/modules/server/downloader/slug.ts` exits 0
    - `test -f src/modules/server/downloader/slug.test.ts` exits 0
    - `test -f src/modules/server/downloader/index.ts` exits 0
    - `grep -q 'YTDLP_CRASH_PREFIX = "yt-dlp crash:"' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'MATCH_SETTINGS_KEY = "match"' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'DEFAULT_MATCH_SETTINGS' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'YtDlpProbeEnvelopeSchema' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'YtDlpDownloadEnvelopeSchema' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'no_results' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'tagger_error' src/modules/server/downloader/schema.ts` exits 0
    - `grep -q 'WINDOWS_RESERVED' src/modules/server/downloader/slug.ts` exits 0
    - `grep -q 'CON|PRN|AUX|NUL|COM\[1-9\]|LPT\[1-9\]' src/modules/server/downloader/slug.ts` exits 0
    - `grep -q 'MAX_FILENAME_LEN = 200' src/modules/server/downloader/slug.ts` exits 0
    - `pnpm test src/modules/server/downloader/slug.test.ts` exits 0 (Vitest run, 14+ test cases pass)
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>downloader/schema.ts and slug.ts compile, tests pass, Biome happy. Schema constants and W-1 prefix are the single source of truth that Plan 03-02 + 03-04 will import from.</done>
</task>

<task type="auto">
  <name>Task 4: Seed default match settings row in global_settings</name>
  <files>src/modules/server/db/seed.ts</files>
  <read_first>
    - src/modules/server/db/seed.ts (current shape — extend `main()`; do not refactor existing seed inserts)
    - src/modules/server/webhooks/repository.ts (settings upsert pattern at lines 39-60 — copy onConflictDoUpdate vs onConflictDoNothing distinction)
    - src/modules/server/downloader/schema.ts (Task 3 output — import MATCH_SETTINGS_KEY + DEFAULT_MATCH_SETTINGS)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "src/modules/server/db/seed.ts (MOD)")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-16)
  </read_first>
  <behavior>
    - seed.ts main() inserts a row into global_settings with key="match", value=JSON.stringify(DEFAULT_MATCH_SETTINGS), updatedAt=now.
    - Insert uses onConflictDoNothing on globalSettings.key — re-running seed does NOT clobber a user's tuned values.
    - Existing source + invocation seed inserts are untouched.
    - The seed log line "Default match settings seeded." is printed.
  </behavior>
  <action>
    1. Edit `src/modules/server/db/seed.ts`:
       a. At the top with the other imports, add:
          ```typescript
          import { globalSettings } from "./schema";
          import {
              DEFAULT_MATCH_SETTINGS,
              MATCH_SETTINGS_KEY,
          } from "../downloader/schema";
          ```
          (Note: `globalSettings` may need to be added to the existing destructured import from `./schema` if that's the existing style — check current imports and match.)
       b. After the `db.insert(invocations).values(seedInvocations).onConflictDoNothing(...).run();` block (around line 123) and before the closing `}` of `main()`, add:
          ```typescript
          // Phase 3 D-16: default match settings (tolerance + parallel).
          // onConflictDoNothing — re-running seed must NOT clobber user-tuned values.
          db.insert(globalSettings)
              .values({
                  key: MATCH_SETTINGS_KEY,
                  value: JSON.stringify(DEFAULT_MATCH_SETTINGS),
                  updatedAt: now,
              })
              .onConflictDoNothing({ target: globalSettings.key })
              .run();
          console.log("Default match settings seeded.");
          ```
    2. Run `pnpm typecheck` and `pnpm check` — both must be green.
    3. Note: actual seed execution is gated by Task 5 (schema push) — running `pnpm seed` here would fail because the live DB doesn't yet have the new columns. Task 5 handles the schema push; manual seed verification is part of Plan 03-05's smoke test.
  </action>
  <verify>
    <automated>grep -q 'MATCH_SETTINGS_KEY' src/modules/server/db/seed.ts &amp;&amp; grep -q 'DEFAULT_MATCH_SETTINGS' src/modules/server/db/seed.ts &amp;&amp; grep -q 'onConflictDoNothing.*globalSettings' src/modules/server/db/seed.ts &amp;&amp; grep -q '"Default match settings seeded."' src/modules/server/db/seed.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `grep -q 'MATCH_SETTINGS_KEY' src/modules/server/db/seed.ts` exits 0
    - `grep -q 'DEFAULT_MATCH_SETTINGS' src/modules/server/db/seed.ts` exits 0
    - `grep -q 'JSON.stringify(DEFAULT_MATCH_SETTINGS)' src/modules/server/db/seed.ts` exits 0
    - `grep -q 'onConflictDoNothing' src/modules/server/db/seed.ts` exits 0
    - `grep -q '"Default match settings seeded."' src/modules/server/db/seed.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>seed.ts upserts the default match row using onConflictDoNothing; existing seed inserts unchanged; types and lints pass.</done>
</task>

<task type="auto">
  <name>Task 5: [BLOCKING] Generate Drizzle migration + push to live SQLite</name>
  <files>drizzle/0001_*.sql, drizzle/meta/_journal.json, drizzle/meta/0001_snapshot.json</files>
  <read_first>
    - drizzle/0000_tranquil_squadron_sinister.sql (current baseline migration — confirm what already exists)
    - drizzle/meta/_journal.json (current journal — Drizzle appends a new entry)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall 7 — SQLite ALTER TABLE limits; the new columns are simple ADD COLUMN ops with constant defaults)
  </read_first>
  <behavior>
    - `pnpm db:generate` produces a new file at `drizzle/0001_<random>.sql` containing two `ALTER TABLE ... ADD COLUMN` statements: one for `tracks.album` (nullable, no default), one for `invocations.kind` (NOT NULL, default 'scrape').
    - `pnpm db:push` applies the migration to `data/db.sqlite` cleanly. Note: `db:push` is the runtime contract for this repo (see package.json scripts and `pnpm dev` chaining).
    - The generated SQL is committed alongside the schema change so test fixtures (`createTestDb` reads the latest migration) pick up the new columns automatically (W-5 contract).
    - If Drizzle decides to recreate the table (CREATE TABLE __new + INSERT SELECT + DROP + RENAME) instead of plain ADD COLUMN, accept it — clean-break DB approach (Phase 1 D-05) makes data loss a non-issue. RESEARCH Pitfall 7 explicitly OKs this.
  </behavior>
  <action>
    1. Run `pnpm db:generate`. Drizzle should produce `drizzle/0001_<some-name>.sql` and update `drizzle/meta/_journal.json` + `drizzle/meta/0001_snapshot.json`. Do NOT hand-edit the generated SQL (CONVENTIONS.md: "drizzle/ — Generated: Yes; Rule: Never hand-edit").
    2. Inspect the generated SQL with `cat drizzle/0001_*.sql`. Confirm it contains:
       - `ALTER TABLE \`tracks\` ADD \`album\` text` (or a table-recreate that achieves the same result — both are acceptable per Pitfall 7)
       - `ALTER TABLE \`invocations\` ADD \`kind\` text DEFAULT 'scrape' NOT NULL` (or an equivalent table-recreate)
    3. Run `pnpm db:push`. This applies the migration to the live `data/db.sqlite`. If db.sqlite doesn't exist yet (fresh checkout), it will be created.
    4. Verify the live DB now has the columns:
       - `sqlite3 data/db.sqlite ".schema tracks"` (output must contain "album")
       - `sqlite3 data/db.sqlite ".schema invocations"` (output must contain "kind")
    5. If `db:push` fails with an interactive prompt (e.g. "Is this column added?" Drizzle sometimes asks for ambiguous changes), abort and re-run `pnpm db:generate` after deleting the empty 0001 file; if the prompt persists, mark the task `autonomous: false` and surface the prompt to the user.
    6. Commit message context: this is the schema-push moment that closes the [BLOCKING] gate. Plans 03-02..03-05 cannot pass verification without it.
  </action>
  <verify>
    <automated>ls drizzle/0001_*.sql 1> /dev/null 2>&amp;1 &amp;&amp; (grep -q 'album' drizzle/0001_*.sql || grep -q 'album' drizzle/meta/0001_snapshot.json) &amp;&amp; (grep -q 'kind' drizzle/0001_*.sql || grep -q 'kind' drizzle/meta/0001_snapshot.json) &amp;&amp; pnpm db:push &amp;&amp; sqlite3 data/db.sqlite ".schema tracks" | grep -q 'album' &amp;&amp; sqlite3 data/db.sqlite ".schema invocations" | grep -q 'kind'</automated>
  </verify>
  <acceptance_criteria>
    - `ls drizzle/0001_*.sql` exits 0 (new migration file created)
    - The new migration SQL OR `drizzle/meta/0001_snapshot.json` references both `album` and `kind` (`grep -q 'album' drizzle/0001_*.sql drizzle/meta/0001_snapshot.json` AND `grep -q 'kind' drizzle/0001_*.sql drizzle/meta/0001_snapshot.json`)
    - `pnpm db:push` exits 0 (migration applies cleanly without interactive prompts)
    - `sqlite3 data/db.sqlite ".schema tracks" | grep -q 'album'` exits 0
    - `sqlite3 data/db.sqlite ".schema invocations" | grep -q 'kind'` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm test` exits 0 (existing scraper repository.test.ts uses W-5 latest-migration loader and must still pass with the new schema)
  </acceptance_criteria>
  <done>Generated migration file committed; live SQLite schema includes album + kind columns; existing tests still pass under the new migration. The phase's runtime database is now consistent with schema.ts — Plans 03-02 through 03-05 can safely write to and read from the new columns.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| User input → DB schema | The schema/seed change is repo-controlled; no untrusted input enters here, but the seed-row pattern is reused in later plans where untrusted data crosses. |
| File path construction (slug + filename) | The Spotify-scraped artist + title (untrusted from filesystem-safety perspective) flow through slug.ts. This plan defines the sanitizer; downstream plans use it. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-3-02-A | Tampering | `safeFilename` in `slug.ts` | mitigate | Strip `[<>:"/\\|?*\x00-\x1F]` via `FS_UNSAFE_CHARS` regex; trim trailing dots; prepend `_` for Windows reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1-9`, `LPT1-9`); cap at 200 chars; deterministic. Unit test asserts each rule. Defense for T-3-02 path traversal in output filename. |
| T-3-02-B | Tampering | `sourceSlug` in `slug.ts` | mitigate | Use `slugify` library `strict: true` mode which strips all non-alphanumeric except hyphens; lowercase; fall back to `"untitled"` on empty result. |
| T-3-09 | Information Disclosure | yt-dlp binary path resolution | mitigate | `YT_DLP_BIN` env var pinned in Docker images to `/app/scraper/.venv/bin/yt-dlp` (deterministic absolute path inside the immutable layer); PATH fallback for dev convenience only. Mirrors PYTHON_BIN T-2-07 mitigation. |
| T-3-10 | Tampering | Drizzle migration generation | accept | `pnpm db:generate` is a developer-controlled step; the generated SQL is committed and reviewed before push. No external input crosses this boundary. |
| T-3-11 | Denial of Service | `MatchSettingsSchema` parallel field | mitigate | Zod `union([literal(2), literal(3), literal(4)])` constrains parallel concurrency to 2/3/4 — prevents a corrupted settings row from spawning unbounded yt-dlp processes. tolerance_seconds bounded 0..60. |
</threat_model>

<verification>
After all 5 tasks complete:

1. `pnpm typecheck` — clean
2. `pnpm check` — Biome happy (tabs, double quotes, no unused imports)
3. `pnpm test` — all existing tests pass + new slug.test.ts passes (~14 cases)
4. `sqlite3 data/db.sqlite ".schema tracks"` — includes `album`
5. `sqlite3 data/db.sqlite ".schema invocations"` — includes `kind` with default `'scrape'`
6. `cat package.json | grep -E '"node-id3"|"p-limit"|"slugify"'` — all three lines present
7. `cat scraper/requirements.txt` — two pins (spotifyscraper + yt-dlp)
8. `grep YT_DLP_BIN Dockerfile Dockerfile.dev` — both export the env var
9. `ls src/modules/server/downloader/` — schema.ts, slug.ts, slug.test.ts, index.ts (exactly 4 files)
</verification>

<success_criteria>
- All five Plan 03-01 tasks pass their automated verify
- Live SQLite schema matches `schema.ts` (column drift impossible)
- `src/modules/server/downloader/` is initialized as a sibling to `scraper/` with the schema + slug modules in place
- Plan 03-02 (YtDlpBridge) can import `YTDLP_CRASH_PREFIX`, `YtDlpProbeEnvelopeSchema`, `YtDlpErrorSchema` directly
- Plan 03-04 (DownloadRunner) can import `MATCH_SETTINGS_KEY`, `DEFAULT_MATCH_SETTINGS`, `MatchSettingsSchema`, `sourceSlug`, `safeFilename` directly
- Plan 03-05 (Docker integration test) has yt-dlp installed in the dev container after a Docker rebuild
</success_criteria>

<output>
After completion, create `.planning/phases/03-match-download-slice-end-to-end-mp3/03-01-SUMMARY.md`.
</output>
