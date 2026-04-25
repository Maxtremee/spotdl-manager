---
phase: 03-match-download-slice-end-to-end-mp3
plan: 02
type: execute
wave: 2
depends_on: [03-01]
files_modified:
  - src/modules/server/downloader/YtDlpBridge.ts
  - src/modules/server/downloader/YtDlpBridge.test.ts
autonomous: true
requirements: [MATCH-01, DOWNLOAD-01, DOWNLOAD-05]
user_setup: []

must_haves:
  truths:
    - "YtDlpBridge.probe(query) spawns yt-dlp argv-form with --print id --print duration --skip-download and returns a typed YtDlpProbeEnvelope"
    - "YtDlpBridge.download(videoId, outputPath) spawns yt-dlp argv-form with -f bestaudio --extract-audio --audio-format mp3 -o <path> https://www.youtube.com/watch?v=<id> and returns a typed YtDlpDownloadEnvelope"
    - "Empty stdout + exit code 0 from probe is mapped to type='no_results' (Pitfall #1)"
    - "Non-zero exit from probe or download synthesizes a YTDLP_CRASH_PREFIX-tagged envelope; stderr is sliced to 500 chars max"
    - "spawn is invoked with shell:false (Node default — never explicitly true) and stdio:['pipe','pipe','pipe']"
    - "YT_DLP_BIN env override is honored; default is 'yt-dlp' on PATH"
    - "Search-term query is passed as a single argv element (ytsearch1:<query>); no shell interpolation"
    - "Mocked-spawn unit tests cover all 10 behaviors enumerated in PATTERNS.md"
  artifacts:
    - path: "src/modules/server/downloader/YtDlpBridge.ts"
      provides: "YtDlpBridge class with probe() + download() methods"
      contains: "export class YtDlpBridge"
      min_lines: 120
    - path: "src/modules/server/downloader/YtDlpBridge.test.ts"
      provides: "Mocked-spawn unit test suite (10+ tests)"
      contains: "vi.mock(\"node:child_process\""
      min_lines: 250
  key_links:
    - from: "src/modules/server/downloader/YtDlpBridge.ts"
      to: "src/modules/server/downloader/schema.ts"
      via: "imports YTDLP_CRASH_PREFIX, YtDlpProbeEnvelope, YtDlpDownloadEnvelope, YtDlpError"
      pattern: "from \"./schema\""
    - from: "src/modules/server/downloader/YtDlpBridge.ts"
      to: "src/env.ts"
      via: "imports env.YT_DLP_BIN"
      pattern: "from \"~/env\""
    - from: "src/modules/server/downloader/YtDlpBridge.ts"
      to: "node:child_process spawn"
      via: "argv-form spawn with shell:false"
      pattern: "spawn\\(this\\.ytDlpBin, \\["
---

<objective>
Implement `YtDlpBridge` — the Node-side wrapper around yt-dlp invocations. Mirrors `SpotifyScraperBridge`'s argv-form-spawn + typed-envelope pattern from Phase 2, adapted for two methods (probe + download) and the yt-dlp-specific failure modes (especially the `ytsearch1:` zero-results gotcha that exits 0 with empty stdout).

Purpose: Delivers MATCH-01 (yt-dlp ytsearch1 invocation), DOWNLOAD-01 (download + audio extraction argv shape), DOWNLOAD-05 (exit code + stderr tail captured in failure envelope). Implements D-08 (probe-then-download), D-09 (Node bridge mirrors SpotifyScraperBridge), D-10 (YT_DLP_BIN env var with PATH fallback).

Output: One bridge class + one comprehensive mocked-spawn test suite. No DownloadRunner orchestration here — that's Plan 03-04. No filesystem writes here — yt-dlp itself writes the file when called from `download()`; the bridge just spawns and returns. No tagging here — that's Plan 03-03.
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
@src/modules/server/scraper/SpotifyScraperBridge.ts
@src/modules/server/scraper/SpotifyScraperBridge.test.ts
@src/modules/server/scraper/schema.ts
@src/modules/server/downloader/schema.ts
@src/env.ts

<interfaces>
<!-- Schemas + constants the executor MUST import (created in Plan 03-01). -->

From src/modules/server/downloader/schema.ts (Plan 03-01 deliverable):
```typescript
export const YTDLP_CRASH_PREFIX = "yt-dlp crash:";

export const YtDlpErrorSchema = z.object({
    type: z.enum([
        "no_results", "network_error", "download_error",
        "ffmpeg_error", "ytdlp_crash", "tagger_error",
    ]),
    message: z.string(),
});
export type YtDlpError = z.infer<typeof YtDlpErrorSchema>;

export const YtDlpProbeEnvelopeSchema = z.object({
    videoId: z.string().min(1).nullable(),
    durationSeconds: z.number().int().nonnegative().nullable(),
    error: YtDlpErrorSchema.nullable(),
});
export type YtDlpProbeEnvelope = z.infer<typeof YtDlpProbeEnvelopeSchema>;

export const YtDlpDownloadEnvelopeSchema = z.object({
    error: YtDlpErrorSchema.nullable(),
});
export type YtDlpDownloadEnvelope = z.infer<typeof YtDlpDownloadEnvelopeSchema>;
```

From src/env.ts (Plan 03-01 deliverable):
```typescript
export const env = createEnv({
    server: {
        SERVER_URL: z.url().optional(),
        PYTHON_BIN: z.string().min(1).optional(),
        YT_DLP_BIN: z.string().min(1).optional(),
    },
    // ...
});
```

From src/modules/server/scraper/SpotifyScraperBridge.ts — TEMPLATE TO MIRROR:
```typescript
const child = spawn(this.pythonBin, [this.scriptPath], {
    stdio: ["pipe", "pipe", "pipe"],
    timeout: this.timeoutMs,
});
const stdoutChunks: Buffer[] = [];
const stderrChunks: Buffer[] = [];
child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
const [code, signal] = (await once(child, "close")) as [number | null, NodeJS.Signals | null];
const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Implement YtDlpBridge class with probe() and download() methods</name>
  <files>src/modules/server/downloader/YtDlpBridge.ts</files>
  <read_first>
    - src/modules/server/scraper/SpotifyScraperBridge.ts (entire file — 137 lines; THE TEMPLATE TO MIRROR)
    - src/modules/server/downloader/schema.ts (Plan 03-01 — types and constants to import)
    - src/env.ts (Plan 03-01 — YT_DLP_BIN added)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "src/modules/server/downloader/YtDlpBridge.ts" — pattern assignments + line-by-line analog from Phase 2)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall 1 — empty stdout + exit 0 = no_results; Pitfall 2 — query normalization; Code Examples §YtDlpBridge.probe + §YtDlpBridge.download)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-08, D-09, D-10)
  </read_first>
  <behavior>
    Class shape:
    ```typescript
    export interface YtDlpBridgeOptions {
        ytDlpBin?: string;
        probeTimeoutMs?: number;
        downloadTimeoutMs?: number;
        logger?: AppLogger;
    }
    export class YtDlpBridge {
        constructor(options?: YtDlpBridgeOptions);
        async probe(query: string): Promise<YtDlpProbeEnvelope>;
        async download(videoId: string, outputPath: string): Promise<YtDlpDownloadEnvelope>;
    }
    ```

    probe(query) behavior:
    1. Normalize query: NFC + replace curly quotes with straight quotes (Pitfall #2).
    2. Spawn `${ytDlpBin}` with argv `["--print","id","--print","duration","--skip-download","--no-warnings","-q","ytsearch1:" + normalizedQuery]`, opts `{stdio:["pipe","pipe","pipe"], timeout: probeTimeoutMs}`.
    3. Buffer stdout + stderr; await `once(child, "close")`.
    4. If exit code !== 0 → return `{ videoId: null, durationSeconds: null, error: { type: "ytdlp_crash", message: \`${YTDLP_CRASH_PREFIX} exit=${code} signal=${signal} stderr=${stderr.slice(0, 500)}\` } }`.
    5. If exit code === 0 AND stdout.trim() === "" → return `{ videoId: null, durationSeconds: null, error: { type: "no_results", message: \`ytsearch1: returned no results for ${query}\` } }`.
    6. If exit code === 0 with stdout: split stdout by \n, filter empty lines, expect 2+ lines. First line = videoId (validate non-empty), second line = durationSeconds (Number.parseInt; validate finite + >= 0).
    7. If parsing succeeds → return `{ videoId, durationSeconds, error: null }`.
    8. If parsing fails (less than 2 lines OR invalid duration) → return `{ videoId: null, durationSeconds: null, error: { type: "ytdlp_crash", message: \`${YTDLP_CRASH_PREFIX} unparseable probe output: ${stdout.slice(0, 200)}\` } }`.
    9. Validate the result against `YtDlpProbeEnvelopeSchema.parse` before return — defense-in-depth (matches SpotifyScraperBridge convention).

    download(videoId, outputPath) behavior:
    1. Spawn `${ytDlpBin}` with argv `["-f","bestaudio","--extract-audio","--audio-format","mp3","--audio-quality","0","--no-warnings","-q","-o", outputPath, "https://www.youtube.com/watch?v=" + videoId]`, opts `{stdio:["pipe","pipe","pipe"], timeout: downloadTimeoutMs}`.
    2. Buffer stderr only (stdout is silent under -q); await close.
    3. If exit code === 0 → return `{ error: null }`.
    4. If exit code !== 0:
       - Inspect stderr for /ffmpeg|ffprobe/i → type = "ffmpeg_error".
       - Otherwise → type = "download_error".
       - Synthesize `${YTDLP_CRASH_PREFIX} exit=${code} signal=${signal} stderr=${stderr.slice(0, 500)}` ONLY when stderr is empty/uninformative; otherwise the message is `exit=${code} ${stderr.slice(0, 500)}` (matches DOWNLOAD-05 contract).
    5. Validate against `YtDlpDownloadEnvelopeSchema.parse` before return.

    Constructor:
    - ytDlpBin defaults to `env.YT_DLP_BIN ?? "yt-dlp"`
    - probeTimeoutMs defaults to 30_000 (30s)
    - downloadTimeoutMs defaults to 600_000 (10min — yt-dlp + ffmpeg can take a while on long tracks)
    - logger defaults to `Logger.get("YtDlpBridge")`

    Security:
    - All argv elements are literal strings; ytsearch1:<query> is a single argv element. No shell interpolation. `shell` option NEVER explicitly set to true.
    - The class file SHOULD have a top-of-file comment block mirroring SpotifyScraperBridge.ts lines 1-18 explaining argv form + shell:false + buffering bounds (T-3-01 mitigation reference).
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/YtDlpBridge.ts` based on the template at `src/modules/server/scraper/SpotifyScraperBridge.ts`. Replace:
       - `pythonBin` → `ytDlpBin`
       - `scriptPath` (constant array element) → either `["--print","id",...,"ytsearch1:" + query]` for probe OR `["-f","bestaudio",...,"https://www.youtube.com/watch?v=" + videoId]` for download
       - `fetchPlaylist(url)` → `probe(query)` AND `download(videoId, outputPath)`
       - `PYTHON_CRASH_PREFIX` → `YTDLP_CRASH_PREFIX`
       - `PythonEnvelopeSchema` → `YtDlpProbeEnvelopeSchema` / `YtDlpDownloadEnvelopeSchema`
       - Constructor signature changes from positional args to options-bag form (cleaner with two timeouts):
         ```typescript
         constructor(options: YtDlpBridgeOptions = {}) {
             this.ytDlpBin = options.ytDlpBin ?? env.YT_DLP_BIN ?? DEFAULT_YT_DLP_BIN;
             this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
             this.downloadTimeoutMs = options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
             this.logger = options.logger ?? Logger.get("YtDlpBridge");
         }
         ```
       - Module-level constants:
         ```typescript
         const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
         const DEFAULT_DOWNLOAD_TIMEOUT_MS = 600_000;
         const DEFAULT_YT_DLP_BIN = "yt-dlp";
         const STDERR_SLICE_LIMIT = 500;
         ```
       - DO NOT call `child.stdin.end(...)` — yt-dlp does not read from stdin (Phase 2 wrote `{url, source_type}` to stdin; Phase 3 takes everything via argv).
       - probe() parses two lines instead of JSON.parse.
       - Add helper:
         ```typescript
         function normalizeQuery(s: string): string {
             return s
                 .normalize("NFC")
                 .replaceAll(/[‘’]/g, "'")
                 .replaceAll(/[“”]/g, '"');
         }
         ```
    2. Top-of-file docblock should reference: argv form, shell:false, buffer bounds (~50KB max for stdout under -q), W-1 prefix import, mitigations for T-3-01 (command injection) and T-3-03 (stderr leak truncation).
    3. Add detailed inline comments referencing D-08 (probe-then-download), D-09 (Node bridge), D-10 (env override + PATH fallback), Pitfall #1 (empty stdout = no_results), Pitfall #2 (query normalization).
    4. Do NOT modify `src/modules/server/downloader/index.ts` here — Plan 03-04 owns the consolidated barrel write to avoid Wave 2 file conflicts with Plan 03-03 (which lands in parallel). Consumers in Plan 03-04 (DownloadRunner.ts) import YtDlpBridge via the relative path `./YtDlpBridge`, not via the barrel.
    5. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q 'export class YtDlpBridge' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q 'spawn(this.ytDlpBin, \[' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q '"--skip-download"' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q '"--audio-format", "mp3"' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q 'no_results' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q 'env.YT_DLP_BIN' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; grep -q 'normalizeQuery\|normalize.*NFC' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; ! grep -q 'shell: true' src/modules/server/downloader/YtDlpBridge.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'export class YtDlpBridge' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'async probe(query: string)' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'async download(videoId: string, outputPath: string)' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (W-1 import — never duplicated literal)
    - `grep -q 'from "./schema"' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'spawn(this.ytDlpBin, \[' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (argv form)
    - `grep -q '"--skip-download"' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (probe argv)
    - `grep -q '"--audio-format", "mp3"' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (download argv)
    - `grep -q '"-q"' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (quiet flag)
    - `grep -q '"--no-warnings"' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q '"ytsearch1:"' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q '"https://www.youtube.com/watch?v="' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'no_results' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (Pitfall #1)
    - `grep -q 'env.YT_DLP_BIN' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'STDERR_SLICE_LIMIT = 500' src/modules/server/downloader/YtDlpBridge.ts` exits 0
    - `grep -q 'normalize("NFC")\|NFC' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (Pitfall #2)
    - `! grep -q 'shell: true' src/modules/server/downloader/YtDlpBridge.ts` exits 0 (security: never shell mode)
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>YtDlpBridge.ts exports a working class with probe() + download() methods, mirrors the SpotifyScraperBridge spawn pattern, imports W-1 constant from schema.ts, never sets shell:true, and exposes typed envelopes consumed by Plan 03-04.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: YtDlpBridge mocked-spawn unit test suite (10 behaviors)</name>
  <files>src/modules/server/downloader/YtDlpBridge.test.ts</files>
  <read_first>
    - src/modules/server/scraper/SpotifyScraperBridge.test.ts (entire file — 396 lines; THE TEMPLATE TO MIRROR for mocked-spawn pattern)
    - src/modules/server/downloader/YtDlpBridge.ts (Task 1 output — what we're testing)
    - src/modules/server/downloader/schema.ts (Plan 03-01 — for YTDLP_CRASH_PREFIX assertion)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "YtDlpBridge.test.ts" — fake-child factory + 10 test coverage targets)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall #1 reference; Validation Architecture §Test Map for MATCH-01, DOWNLOAD-01, DOWNLOAD-05)
  </read_first>
  <behavior>
    Test file structure copied from `SpotifyScraperBridge.test.ts`:
    - `vi.mock("node:child_process", () => ({ spawn: vi.fn() }))`
    - `vi.mock("~/env", () => ({ env: { YT_DLP_BIN: undefined } }))`
    - `vi.mock("~/logger", ...)` — silent mock loggers
    - `makeFakeChild()` factory returns an EventEmitter with stdout/stderr emitters and a stdin.end stub (stdin not used by yt-dlp but kept for parity)
    - `tick()` helper for microtask flushing

    Required test cases:
    1. **probe happy path** — emit `"abc123\n240\n"` to stdout, exit 0 → result has `videoId="abc123"`, `durationSeconds=240`, `error=null`.
    2. **probe no_results (Pitfall #1)** — emit `""` to stdout, exit 0 → result has `error.type="no_results"`, `videoId=null`, `durationSeconds=null`. CRITICAL: this is the gotcha — exit code is 0, not non-zero.
    3. **probe yt-dlp crash (non-zero exit)** — emit `"Traceback...\n"` to stderr, exit 1 → result has `error.type="ytdlp_crash"`, `error.message.startsWith(YTDLP_CRASH_PREFIX)` is true, message contains `exit=1`.
    4. **probe malformed stdout (only one line)** — emit `"only-one-line"` to stdout, exit 0 → result has `error.type="ytdlp_crash"`, message references "unparseable" or similar.
    5. **probe stderr truncation at 500 chars** — emit 2000 X chars to stderr, exit 1 → result.error.message contains `exit=1` and the stderr-portion of the message is at most 500 chars.
    6. **probe argv-form / shell:false assertion** — assert `spawn.mock.calls[0]` has args containing `"--skip-download"` and `"--print"` and a string starting with `"ytsearch1:"`; `opts.shell` is not `true`; `opts.stdio` is `["pipe","pipe","pipe"]`.
    7. **probe timeout option** — assert `spawn.mock.calls[0][2].timeout === 30_000` (default probe timeout).
    8. **download happy path** — exit 0 with no stderr → result has `error=null`.
    9. **download crash (non-zero exit, ffmpeg-related stderr)** — emit stderr containing "ffmpeg" or "ffprobe", exit 1 → result has `error.type="ffmpeg_error"`.
    10. **download crash (non-zero exit, generic)** — emit stderr like "ERROR: HTTP Error 403", exit 1 → result has `error.type="download_error"`, message contains `exit=1`.
    11. **W-1 prefix contract** — assert YTDLP_CRASH_PREFIX equals `"yt-dlp crash:"` AND that the synthesized crash messages from tests #3 and #5 start with the imported constant (not a literal duplicated in the test).
    12. **download argv assertion** — assert args contain `"--audio-format"`, `"mp3"`, `"--audio-quality"`, `"0"`, `"-o"`, the outputPath, and the URL `https://www.youtube.com/watch?v=<videoId>`.

    Test names include the requirement IDs they cover (MATCH-01, DOWNLOAD-01, DOWNLOAD-05) in `describe`/`it` titles for traceability.
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/YtDlpBridge.test.ts` mirroring `SpotifyScraperBridge.test.ts` structure (top-of-file imports + vi.mock blocks + makeFakeChild + tick + describe blocks). Tabs, double quotes.
    2. Cover all 12 test cases enumerated above. Each test should:
       - Construct a `new YtDlpBridge({ ytDlpBin: "yt-dlp", probeTimeoutMs: 30_000, downloadTimeoutMs: 600_000 })`.
       - Set up mock spawn return value via `vi.mocked(spawn).mockReturnValue(child as any)`.
       - Call `bridge.probe(query)` or `bridge.download(videoId, "/tmp/test.mp3")`.
       - Use `await tick()` before emitting events.
       - Emit stdout/stderr `data` events then close event with `child.emit("close", code, null)`.
       - Assert on the resolved envelope shape.
    3. For test #11 (W-1 contract), import `YTDLP_CRASH_PREFIX` directly: `import { YTDLP_CRASH_PREFIX } from "./schema";` and assert `expect(YTDLP_CRASH_PREFIX).toBe("yt-dlp crash:")` plus that crash-test messages start with the imported constant.
    4. Run `pnpm test src/modules/server/downloader/YtDlpBridge.test.ts` until green. Aim for 12+ test cases all passing.
    5. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/YtDlpBridge.test.ts &amp;&amp; grep -q 'vi.mock("node:child_process"' src/modules/server/downloader/YtDlpBridge.test.ts &amp;&amp; grep -q 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/YtDlpBridge.test.ts &amp;&amp; grep -q 'no_results' src/modules/server/downloader/YtDlpBridge.test.ts &amp;&amp; grep -q 'shell.*not.*true\|opts.shell' src/modules/server/downloader/YtDlpBridge.test.ts &amp;&amp; grep -q 'ffmpeg_error\|ffmpeg' src/modules/server/downloader/YtDlpBridge.test.ts &amp;&amp; pnpm test src/modules/server/downloader/YtDlpBridge.test.ts</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/YtDlpBridge.test.ts` exits 0
    - `grep -q 'vi.mock("node:child_process"' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0
    - `grep -q 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (imported, not literal)
    - `grep -q 'no_results' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (Pitfall #1 covered)
    - `grep -q 'opts.shell\|shell.*toBe' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (security assertion)
    - `grep -q 'ffmpeg_error\|ffmpeg' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (Pitfall #3)
    - `grep -q '"--skip-download"' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (probe argv assertion)
    - `grep -q '"--audio-format"' src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (download argv assertion)
    - `grep -c 'describe\|it(' src/modules/server/downloader/YtDlpBridge.test.ts` returns at least 12 (12+ test cases)
    - `pnpm test src/modules/server/downloader/YtDlpBridge.test.ts` exits 0 (all tests pass)
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>YtDlpBridge.test.ts has 12+ green tests covering MATCH-01, DOWNLOAD-01, DOWNLOAD-05 + the no_results gotcha + shell:false assertion + W-1 contract. Bridge is now contract-tested and ready to be consumed by DownloadRunner in Plan 03-04.</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Spotify-scraped artist+title → yt-dlp argv | Untrusted from a security standpoint; flows through `ytsearch1:<query>` as a single argv element. |
| yt-dlp stderr → failure_reason DB column | Untrusted output that will eventually reach the user-facing webhook. Must be capped + sanitized. |
| videoId → URL construction | yt-dlp returns a videoId via stdout that's then used to build a YouTube URL for the download call. |
| outputPath → yt-dlp -o argv | Constructed from sanitized slug + safeFilename in Plan 03-04. Bridge accepts as opaque string. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-3-01 | Tampering / Elevation | `YtDlpBridge.probe` and `.download` spawn calls | mitigate | Use argv-form `spawn(bin, [args...], opts)` with `shell: false` (Node default — never set to true). Query string flows as a single argv element (`ytsearch1:<query>`), never interpolated into a shell command. videoId flows as part of the URL argv element. Existing test asserts `opts.shell !== true`. Mirrors Phase 2 SpotifyScraperBridge T-2-01 mitigation. |
| T-3-03 | Information Disclosure | yt-dlp stderr → failure_reason persistence | mitigate | `STDERR_SLICE_LIMIT = 500` truncates stderr before incorporation into the synthesized envelope message. The 500-char tail is durably bounded; full stderr only logged via Logger.get("YtDlpBridge").error for debugging, never reaches webhook payload. Mirrors Phase 2 STDERR_SLICE_LIMIT pattern. |
| T-3-09 | Information Disclosure | yt-dlp binary resolution | mitigate | `env.YT_DLP_BIN` (validated via Zod) provides explicit override; PATH-resolved `"yt-dlp"` is the dev fallback. Docker images set the env var to the immutable layer path (`/app/scraper/.venv/bin/yt-dlp` per Plan 03-01). |
| T-3-12 | Tampering | Buffered stdout / stderr accumulation | mitigate | spawn `timeout` option (30s probe, 600s download) bounds the buffer accumulation window. Under `-q --no-warnings`, probe stdout is bounded to ~50 bytes (videoId + duration), download stdout is empty. Stderr capped by 30s/600s timeout + the 500-char slice on persistence. |
| T-3-13 | Tampering | URL injection via videoId | mitigate | videoId is read from yt-dlp stdout (its own `--print id`) and used to build the URL. yt-dlp's `--print id` returns the canonical 11-char video ID; even if a malicious search result returned weird characters, they'd be embedded in the URL argv element which is passed to yt-dlp itself (not a shell, not another command). The runner-side schema (`YtDlpProbeEnvelopeSchema`) requires videoId be a non-empty string but doesn't pin its character set — acceptable because the next operation is also yt-dlp, which validates the URL itself. |
| T-3-14 | DoS | Curly-quote / unicode mismatch causes mass no_results | mitigate | `normalizeQuery` (NFC + curly-to-straight quotes) reduces the false-no-results rate per Pitfall #2. Not security-critical but improves match yield. |
</threat_model>

<verification>
After both tasks complete:

1. `pnpm test src/modules/server/downloader/` — all downloader tests green (slug + YtDlpBridge)
2. `pnpm typecheck` — clean
3. `pnpm check` — Biome happy
4. `grep -rn 'YTDLP_CRASH_PREFIX' src/modules/server/downloader/` shows imports only (constant defined exactly once in schema.ts)
5. `grep -rn 'shell: true' src/modules/server/downloader/` returns zero matches (security)
6. `grep -rn 'spawn(' src/modules/server/downloader/YtDlpBridge.ts` returns argv-form calls only
</verification>

<success_criteria>
- YtDlpBridge.ts exports a working class with probe() + download() consumed by Plan 03-04
- 12+ unit tests cover MATCH-01, DOWNLOAD-01, DOWNLOAD-05, plus no_results gotcha (Pitfall #1), shell:false (T-3-01), stderr truncation (T-3-03), W-1 contract
- Mocked-spawn pattern mirrors Phase 2 exactly — no new test infrastructure needed
- Plan 03-04 will add `./YtDlpBridge` to the barrel; in Wave 2, the bridge is consumed via relative import `./YtDlpBridge` from inside the downloader/ folder only
</success_criteria>

<output>
After completion, create `.planning/phases/03-match-download-slice-end-to-end-mp3/03-02-SUMMARY.md`.
</output>
