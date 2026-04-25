---
phase: 03-match-download-slice-end-to-end-mp3
plan: 03
type: execute
wave: 2
depends_on: [03-01]
files_modified:
  - src/modules/server/downloader/tagger.ts
  - src/modules/server/downloader/cover-art.ts
  - src/modules/server/downloader/tagger.test.ts
  - src/modules/server/downloader/cover-art.test.ts
  - src/modules/server/downloader/fixtures/silence.mp3
autonomous: true
requirements: [DOWNLOAD-02]
user_setup: []

must_haves:
  truths:
    - "embedTags(filepath, {title, artist, album?, coverArt?}) writes ID3v2 frames TIT2 (title), TPE1 (artist), TALB (album when set), APIC (cover art when set)"
    - "TALB frame is omitted entirely when album is undefined or null (D-13)"
    - "APIC frame is omitted entirely when coverArt is undefined or null (D-14)"
    - "node-id3 sync API write() return value is checked: true → success, Error → throw, anything else → throw (Pitfall #10)"
    - "fetchCoverArt(url) returns {buffer, mime} on 2xx, null on any non-2xx, null on network/timeout/abort error (Pitfall #8)"
    - "fetchCoverArt enforces a 10s timeout via AbortSignal.timeout AND a 5MB response-size cap"
    - "fetchCoverArt restricts protocol to https: only (no http://, no file://, no data:) — defense for T-3-04 cover-art SSRF"
    - "Cover-art mime type is restricted to image/jpeg or image/png; other content-types return null"
    - "Tagger and cover-art helpers are pure top-level functions (no class) — module-scope Logger singleton"
  artifacts:
    - path: "src/modules/server/downloader/tagger.ts"
      provides: "embedTags(filepath, tags) function — sync-API node-id3 wrapper"
      contains: "export function embedTags"
    - path: "src/modules/server/downloader/cover-art.ts"
      provides: "fetchCoverArt(url) function — HTTPS-only image fetch with size+mime guards"
      contains: "export async function fetchCoverArt"
    - path: "src/modules/server/downloader/tagger.test.ts"
      provides: "Fixture-driven tests verifying frame round-trip via NodeID3.read()"
      contains: "NodeID3.read"
    - path: "src/modules/server/downloader/cover-art.test.ts"
      provides: "Mocked-fetch tests for happy path, non-2xx, network error, size cap, mime guard, SSRF protocol guard"
      contains: "vi.stubGlobal\\(\"fetch\""
    - path: "src/modules/server/downloader/fixtures/silence.mp3"
      provides: "1-second silent MP3 fixture for tagger tests"
      contains: ""
  key_links:
    - from: "src/modules/server/downloader/tagger.ts"
      to: "node-id3 npm package (Plan 03-01)"
      via: "import NodeID3 from \"node-id3\""
      pattern: "node-id3"
    - from: "src/modules/server/downloader/cover-art.ts"
      to: "Node 22 global fetch (undici)"
      via: "fetch(url, { signal: AbortSignal.timeout(10_000) })"
      pattern: "AbortSignal.timeout"
---

<objective>
Build two independent utility modules consumed by `DownloadRunner` in Plan 03-04: the ID3 tagger (post-yt-dlp Node step) and the cover-art HTTP fetcher (per-track HTTPS GET with safety guards). Both are pure functions with module-scope loggers; neither is a class.

Purpose: Delivers DOWNLOAD-02 (ID3 tags TIT2/TPE1/TALB/APIC). Implements D-12 (separate Node tagging step after yt-dlp), D-13 (TALB omitted when album is null), D-14 (per-track cover-art fetch, silent skip on failure). Mitigates T-3-04 (cover-art SSRF) via HTTPS-only + mime allowlist + 5MB size cap.

Output: Two source modules + two co-located test suites + a tiny silent MP3 fixture file. No DB writes here, no orchestration here, no spawn here. The DownloadRunner in Plan 03-04 wires these together with the YtDlpBridge.
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
@CLAUDE.md
@src/modules/server/webhooks/service.ts

<interfaces>
<!-- Existing patterns the executor mirrors. -->

From src/modules/server/webhooks/service.ts (HTTP fetch + retry pattern — module-scope helpers, no class):
```typescript
import { Logger } from "~/logger";
const logger = Logger.get("DiscordWebhook");

export async function sendDiscordWebhook(url: string, message: string, log = logger): Promise<void> {
    const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content: message }),
    });
    if (!response.ok) { /* retry / throw */ }
}
```

From the node-id3 README (Context7-verified):
```typescript
import NodeID3 from "node-id3";

const tags: NodeID3.Tags = {
    title: "Song Title",
    artist: "Artist Name",
    album: "Album Name",       // omit by leaving undefined
    image: {                    // OBJECT FORM with imageBuffer (Pitfall #9)
        mime: "image/jpeg",
        type: { id: 3 },        // 3 = front cover (id3.org)
        description: "Cover",
        imageBuffer: someBuffer,
    },
};
const result = NodeID3.write(tags, filepath);  // returns true | Error (Pitfall #10)
if (result instanceof Error) { throw result; }
if (result !== true) { throw new Error("node-id3 write returned non-true"); }
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create silence.mp3 fixture for tagger tests</name>
  <files>src/modules/server/downloader/fixtures/silence.mp3</files>
  <read_first>
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "tagger.test.ts" — fixture path convention)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-VALIDATION.md (Wave 0 requirements — tagger fixture)
  </read_first>
  <behavior>
    A 1-second silent MP3 file at `src/modules/server/downloader/fixtures/silence.mp3` checked into git. Used by tagger.test.ts as the substrate for NodeID3.write/read round-trip tests. Each test copies the fixture to a tmp dir, mutates it, asserts via NodeID3.read.
  </behavior>
  <action>
    1. Create the directory: `mkdir -p src/modules/server/downloader/fixtures`
    2. Generate a 1-second silent MP3 using ffmpeg (already on host PATH per RESEARCH §Environment Availability — `/opt/homebrew/bin/ffmpeg` exists). Run:
       ```bash
       ffmpeg -y -f lavfi -i anullsrc=r=44100:cl=mono -t 1 -c:a libmp3lame -b:a 128k src/modules/server/downloader/fixtures/silence.mp3
       ```
    3. Verify the file exists and is a valid MP3 (file should be a few KB):
       ```bash
       test -f src/modules/server/downloader/fixtures/silence.mp3 && test $(wc -c < src/modules/server/downloader/fixtures/silence.mp3) -gt 1000
       ```
    4. The fixture should be small (~16 KB) — checked into git directly (no LFS needed).
    5. If ffmpeg is not available on the executor's host, fall back to checking in a known-small public-domain silent MP3. Recommended: download a 1-second silent MP3 from `https://github.com/anars/blank-audio/raw/master/1-second-of-silence.mp3` via `curl -L -o src/modules/server/downloader/fixtures/silence.mp3 https://github.com/anars/blank-audio/raw/master/1-second-of-silence.mp3`. Either approach is acceptable as long as the file is a valid MP3 ≥ 1 KB.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/fixtures/silence.mp3 &amp;&amp; test $(wc -c &lt; src/modules/server/downloader/fixtures/silence.mp3) -gt 1000</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/fixtures/silence.mp3` exits 0
    - `test $(wc -c < src/modules/server/downloader/fixtures/silence.mp3) -gt 1000` exits 0 (file is at least 1 KB — sanity check it's not empty/broken)
    - The file is a valid MP3 (first bytes should match MP3 sync pattern; this is verifiable in-test by feeding it through NodeID3.read which returns an object without errors)
  </acceptance_criteria>
  <done>silence.mp3 fixture committed to repo at the canonical path.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Implement tagger.ts (node-id3 wrapper) + tagger.test.ts</name>
  <files>src/modules/server/downloader/tagger.ts, src/modules/server/downloader/tagger.test.ts</files>
  <read_first>
    - src/modules/server/downloader/fixtures/silence.mp3 (Task 1 output)
    - src/modules/server/webhooks/service.ts (module-scope Logger pattern + top-level functions, no class)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "downloader/tagger.ts" + "downloader/tagger.test.ts")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall #9 — image object form with imageBuffer; Pitfall #10 — sync API returns true|Error; Code Examples §Tagger)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-12, D-13, D-14)
    - CLAUDE.md (Logger.get pattern; tabs + double quotes)
  </read_first>
  <behavior>
    tagger.ts shape:
    ```typescript
    import NodeID3 from "node-id3";
    import { Logger } from "~/logger";

    const logger = Logger.get("Tagger");

    export interface CoverArt {
        buffer: Buffer;
        mime: string; // "image/jpeg" | "image/png"
    }

    export interface TagInput {
        title: string;
        artist: string;
        album?: string | null;
        coverArt?: CoverArt | null;
    }

    export function embedTags(filepath: string, input: TagInput): void;
    ```

    embedTags behavior:
    1. Build NodeID3.Tags object:
       - Always set `title` and `artist`.
       - Set `album` ONLY when `input.album` is a non-empty string (omit otherwise — D-13).
       - Set `image` ONLY when `input.coverArt` is non-null and has a non-empty buffer (omit otherwise — D-14). Image uses object form with `imageBuffer` (Pitfall #9):
         ```typescript
         image: {
             mime: input.coverArt.mime,
             type: { id: 3 },        // 3 = front cover per id3.org
             description: "Cover",
             imageBuffer: input.coverArt.buffer,
         }
         ```
    2. Call `NodeID3.write(tags, filepath)`.
    3. Check return value (Pitfall #10):
       - `result === true` → success, return void
       - `result instanceof Error` → throw the Error
       - anything else → throw `new Error("node-id3 write returned non-true")`
    4. Log debug-level metadata about what was written: `logger.debug({ filepath, hasAlbum, hasCover }, "Embedded ID3 tags")`.

    tagger.test.ts coverage:
    1. **TIT2 + TPE1 round-trip** — copy fixture to tmp; embedTags({title:"Foo", artist:"Bar"}); NodeID3.read returns title="Foo", artist="Bar".
    2. **TALB present when album set** — embedTags with album; NodeID3.read returns album.
    3. **TALB omitted when album=undefined (D-13)** — embedTags without album; NodeID3.read returns album as undefined or empty string. Assert it is NOT a meaningful album value.
    4. **TALB omitted when album=null** — embedTags({album: null, ...}); same as above.
    5. **APIC present when coverArt set** — embedTags with cover buffer; NodeID3.read returns image with buffer length > 0.
    6. **APIC omitted when coverArt=undefined (D-14)** — embedTags without coverArt; NodeID3.read.image is undefined or empty.
    7. **APIC omitted when coverArt=null** — same as #6 with explicit null.
    8. **node-id3 returns Error** — pass an unwritable filepath (e.g. `/dev/full` on Linux, OR an unwritable directory). Expect embedTags to throw. (Use a simpler approach: pass a non-existent filepath in a non-existent dir like `/tmp/nope-${Date.now()}/file.mp3` — node-id3 returns Error for missing files.)
    9. **Determinism / Idempotence** — embedTags twice with same input on the same file; second read returns same values.

    Each test uses `beforeEach` to copy the fixture to `path.join(tmpdir(), \`tagger-test-${Date.now()}-${Math.random()}.mp3\`)` and `afterEach` to unlink (catch ENOENT).
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/tagger.ts` with the shape and behavior described above. Use:
       ```typescript
       import NodeID3 from "node:" // NO — actually: import NodeID3 from "node-id3";
       import type { AppLogger } from "~/logger";
       import { Logger } from "~/logger";
       ```
       Logger pattern: module-scope `const logger = Logger.get("Tagger")` (NOT a class field — see webhooks/service.ts).
    2. Create `src/modules/server/downloader/tagger.test.ts` with at least 9 test cases. Use `import { copyFile, unlink } from "node:fs/promises"`, `import { tmpdir } from "node:os"`, `import path from "node:path"`, `import NodeID3 from "node-id3"`. Tabs + double quotes. Resolve fixture path via `path.resolve("src/modules/server/downloader/fixtures/silence.mp3")` (run from repo root via `pnpm test`).
    3. Do NOT modify `src/modules/server/downloader/index.ts` here — Plan 03-04 owns the consolidated barrel write to avoid Wave 2 file conflicts with Plan 03-02. Plan 03-04 will add `export * from "./tagger";` to the barrel. DownloadRunner.ts (in Plan 03-04) imports via the relative path `./tagger` regardless.
    4. Run `pnpm test src/modules/server/downloader/tagger.test.ts` until green (all 9 tests pass).
    5. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/tagger.ts &amp;&amp; test -f src/modules/server/downloader/tagger.test.ts &amp;&amp; grep -q 'export function embedTags' src/modules/server/downloader/tagger.ts &amp;&amp; grep -q 'NodeID3.write' src/modules/server/downloader/tagger.ts &amp;&amp; grep -q 'result instanceof Error' src/modules/server/downloader/tagger.ts &amp;&amp; grep -q 'imageBuffer' src/modules/server/downloader/tagger.ts &amp;&amp; grep -q 'type: { id: 3 }' src/modules/server/downloader/tagger.ts &amp;&amp; pnpm test src/modules/server/downloader/tagger.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/tagger.ts` exits 0
    - `test -f src/modules/server/downloader/tagger.test.ts` exits 0
    - `grep -q 'export function embedTags' src/modules/server/downloader/tagger.ts` exits 0
    - `grep -q 'import NodeID3 from "node-id3"' src/modules/server/downloader/tagger.ts` exits 0
    - `grep -q 'NodeID3.write' src/modules/server/downloader/tagger.ts` exits 0
    - `grep -q 'result instanceof Error' src/modules/server/downloader/tagger.ts` exits 0 (Pitfall #10)
    - `grep -q 'imageBuffer' src/modules/server/downloader/tagger.ts` exits 0 (Pitfall #9 — object form)
    - `grep -q 'type: { id: 3 }' src/modules/server/downloader/tagger.ts` exits 0 (front cover marker)
    - `grep -q 'Logger.get("Tagger")' src/modules/server/downloader/tagger.ts` exits 0
    - `grep -c 'it(' src/modules/server/downloader/tagger.test.ts` returns at least 9
    - `pnpm test src/modules/server/downloader/tagger.test.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>tagger.ts is a clean ID3v2 tag writer; 9+ tests verify TIT2/TPE1/TALB/APIC behavior including the omit-when-null branches; the embed function never crashes silently — it always throws on node-id3 failure (Pitfall #10).</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Implement cover-art.ts (HTTPS-only fetch with safety guards) + cover-art.test.ts</name>
  <files>src/modules/server/downloader/cover-art.ts, src/modules/server/downloader/cover-art.test.ts</files>
  <read_first>
    - src/modules/server/webhooks/service.ts (HTTP fetch + retry pattern — pure-function shape with module-scope logger)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "downloader/cover-art.ts")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Pitfall #8 — fetch failure must not abort track; Code Examples §cover-art; Security Domain §Cover-art SSRF)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-CONTEXT.md (D-14)
  </read_first>
  <behavior>
    cover-art.ts shape:
    ```typescript
    import type { AppLogger } from "~/logger";
    import { Logger } from "~/logger";
    import type { CoverArt } from "./tagger"; // re-use the same interface

    const logger = Logger.get("CoverArtFetcher");

    const FETCH_TIMEOUT_MS = 10_000;
    const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // 5MB
    const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

    export async function fetchCoverArt(
        url: string | null,
        log: AppLogger = logger,
    ): Promise<CoverArt | null>;
    ```

    fetchCoverArt behavior (T-3-04 mitigation):
    1. If `url` is null or empty string → return null silently (no log).
    2. Parse the URL. If parsing throws OR `URL.protocol !== "https:"` → log warn and return null. NEVER fetch http://, file://, data:, ftp://, etc.
    3. Call `fetch(url, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) })`. Wrap in try/catch.
    4. If non-2xx response → log warn `{ url, status: res.status }` and return null.
    5. Read `content-type` header. If MIME (before any `;` separator) is NOT in `ALLOWED_MIME_TYPES` → log warn and return null.
    6. Read response body via `await res.arrayBuffer()`. Check byte length > MAX_RESPONSE_BYTES → log warn and return null. (Note: content-length pre-check would be slightly cheaper but not all CDNs send content-length; the post-check is safer.)
    7. On success → return `{ buffer: Buffer.from(arrayBuffer), mime: contentTypeRaw }`.
    8. On any thrown error (timeout, DNS, connection) → log warn `{ url, err }` and return null. NEVER throw.

    cover-art.test.ts coverage:
    1. **happy path JPEG** — mock fetch to return 200 + image/jpeg + small Buffer; assert returns `{ buffer, mime: "image/jpeg" }`.
    2. **happy path PNG** — mock 200 + image/png; returns `{ ..., mime: "image/png" }`.
    3. **null url returns null** — `fetchCoverArt(null)` returns null without calling fetch.
    4. **empty string url returns null** — same.
    5. **non-2xx (404) returns null** — mock 404; returns null; logger.warn called.
    6. **non-https URL rejected (T-3-04 SSRF guard)** — `fetchCoverArt("http://evil.example.com/foo.jpg")` returns null without calling fetch.
    7. **file:// URL rejected** — `fetchCoverArt("file:///etc/passwd")` returns null without calling fetch.
    8. **data: URL rejected** — `fetchCoverArt("data:image/jpeg;base64,...")` returns null without calling fetch.
    9. **invalid MIME type rejected** — mock 200 + content-type: text/html; returns null.
    10. **size cap (>5MB)** — mock 200 + image/jpeg + 6MB buffer; returns null.
    11. **network error returns null** — mock fetch to throw an Error; returns null without throwing.
    12. **timeout returns null** — mock AbortError thrown; returns null.
    13. **invalid URL string** — `fetchCoverArt("not a url")` returns null without throwing.

    Mock pattern (vitest stubGlobal):
    ```typescript
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn());
    });
    afterEach(() => { vi.unstubAllGlobals(); });
    ```
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/cover-art.ts`:
       ```typescript
       import type { AppLogger } from "~/logger";
       import { Logger } from "~/logger";
       import type { CoverArt } from "./tagger";

       const logger = Logger.get("CoverArtFetcher");
       const FETCH_TIMEOUT_MS = 10_000;
       const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // T-3-04: 5MB cap
       const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

       /**
        * Phase 3 D-14: per-track cover-art fetch with HTTPS-only + size + MIME guards.
        *
        * Returns null on ANY failure (no throws — Pitfall #8). The track's tag step
        * proceeds without an APIC frame; the track is NOT marked failed.
        *
        * Security (T-3-04 cover-art SSRF mitigation):
        *  - Protocol whitelist: https: only
        *  - MIME whitelist: image/jpeg, image/png
        *  - Response size cap: 5MB
        *  - Timeout: 10s via AbortSignal.timeout
        */
       export async function fetchCoverArt(
           url: string | null,
           log: AppLogger = logger,
       ): Promise<CoverArt | null> {
           if (!url) { return null; }

           let parsed: URL;
           try {
               parsed = new URL(url);
           } catch {
               log.warn({ url }, "cover-art URL is not parseable — skipping APIC");
               return null;
           }
           if (parsed.protocol !== "https:") {
               log.warn(
                   { url, protocol: parsed.protocol },
                   "cover-art URL must use https: — skipping APIC (T-3-04 SSRF guard)",
               );
               return null;
           }

           try {
               const response = await fetch(url, {
                   signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
               });
               if (!response.ok) {
                   log.warn(
                       { url, status: response.status },
                       "cover-art fetch returned non-2xx — skipping APIC",
                   );
                   return null;
               }

               const contentTypeHeader = response.headers.get("content-type") ?? "";
               const mime = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "";
               if (!ALLOWED_MIME_TYPES.has(mime)) {
                   log.warn(
                       { url, mime: contentTypeHeader },
                       "cover-art content-type not in allowlist — skipping APIC",
                   );
                   return null;
               }

               const arrayBuffer = await response.arrayBuffer();
               if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
                   log.warn(
                       { url, bytes: arrayBuffer.byteLength },
                       "cover-art exceeds 5MB cap — skipping APIC",
                   );
                   return null;
               }

               return { buffer: Buffer.from(arrayBuffer), mime };
           } catch (err) {
               log.warn({ url, err }, "cover-art fetch failed — skipping APIC");
               return null;
           }
       }
       ```
    2. Create `src/modules/server/downloader/cover-art.test.ts` with 13+ test cases. Use `vi.stubGlobal("fetch", vi.fn())` and a `Response`-like mock object with `.ok`, `.status`, `.headers.get`, `.arrayBuffer()`. For the protocol/SSRF tests, assert `fetch` was NOT called (`expect(fetch).not.toHaveBeenCalled()`).
    3. Do NOT modify `src/modules/server/downloader/index.ts` here — Plan 03-04 owns the consolidated barrel write. Plan 03-04 will add `export * from "./cover-art";`. Internal consumers (DownloadRunner.ts in Plan 03-04) import via `./cover-art` directly.
    4. Run `pnpm test src/modules/server/downloader/cover-art.test.ts` until green.
    5. Run `pnpm typecheck` and `pnpm check`.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/cover-art.ts &amp;&amp; test -f src/modules/server/downloader/cover-art.test.ts &amp;&amp; grep -q 'export async function fetchCoverArt' src/modules/server/downloader/cover-art.ts &amp;&amp; grep -q 'AbortSignal.timeout' src/modules/server/downloader/cover-art.ts &amp;&amp; grep -q 'parsed.protocol !== "https:"' src/modules/server/downloader/cover-art.ts &amp;&amp; grep -q 'MAX_RESPONSE_BYTES = 5 \* 1024 \* 1024' src/modules/server/downloader/cover-art.ts &amp;&amp; grep -q 'image/jpeg' src/modules/server/downloader/cover-art.ts &amp;&amp; grep -q 'image/png' src/modules/server/downloader/cover-art.ts &amp;&amp; pnpm test src/modules/server/downloader/cover-art.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/cover-art.ts` exits 0
    - `test -f src/modules/server/downloader/cover-art.test.ts` exits 0
    - `grep -q 'export async function fetchCoverArt' src/modules/server/downloader/cover-art.ts` exits 0
    - `grep -q 'AbortSignal.timeout' src/modules/server/downloader/cover-art.ts` exits 0 (10s timeout)
    - `grep -q 'parsed.protocol !== "https:"' src/modules/server/downloader/cover-art.ts` exits 0 (T-3-04 SSRF mitigation)
    - `grep -q 'MAX_RESPONSE_BYTES = 5 \* 1024 \* 1024' src/modules/server/downloader/cover-art.ts` exits 0 (5MB cap)
    - `grep -q 'image/jpeg' src/modules/server/downloader/cover-art.ts` exits 0
    - `grep -q 'image/png' src/modules/server/downloader/cover-art.ts` exits 0
    - `grep -q 'ALLOWED_MIME_TYPES' src/modules/server/downloader/cover-art.ts` exits 0 (mime whitelist)
    - `grep -q 'Logger.get("CoverArtFetcher")' src/modules/server/downloader/cover-art.ts` exits 0
    - `grep -c 'it(' src/modules/server/downloader/cover-art.test.ts` returns at least 13
    - `grep -q 'http://' src/modules/server/downloader/cover-art.test.ts` exits 0 (SSRF protocol test exists)
    - `grep -q 'file://' src/modules/server/downloader/cover-art.test.ts` exits 0 (SSRF file: test exists)
    - `pnpm test src/modules/server/downloader/cover-art.test.ts` exits 0
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>cover-art.ts fetches HTTPS-only URLs with size + MIME + timeout guards; returns null on any failure (never throws); 13+ tests cover happy paths and security guards including the SSRF protocol whitelist (T-3-04).</done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| `source.cover_art_url` (DB) → `fetchCoverArt` | Set by spotifyscraper from Spotify CDN; trusted source but defense-in-depth required (T-3-04). |
| Network response → tagger image buffer | Untrusted bytes embedded into MP3 file. node-id3 handles binary safely; we cap upstream so a 1GB malicious response can't OOM the runner. |
| `node-id3` library → MP3 file mutation | Trusted library; sync API; we check the return value (Pitfall #10). |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-3-04 | Information Disclosure / SSRF | `cover-art.ts fetchCoverArt` | mitigate | Protocol whitelist (`https:` only) — rejects `http:`, `file:`, `data:`, `ftp:`. MIME allowlist (`image/jpeg`, `image/png`) — rejects HTML/text/exotic types. 5MB response size cap. 10s `AbortSignal.timeout`. URL parse-failure → return null. Defense-in-depth even though spotifyscraper supplies the URL. Unit tests assert each guard. |
| T-3-15 | DoS | Cover-art response size | mitigate | `MAX_RESPONSE_BYTES = 5 * 1024 * 1024` post-check on `arrayBuffer().byteLength` rejects oversize images. 10s timeout bounds the time window for accumulating bytes. |
| T-3-16 | Tampering | node-id3 silent failure | mitigate | tagger.ts checks `NodeID3.write` return value (Pitfall #10). `true` → success; `Error` → throw; anything else → throw. Never silently drops a failed write. |
| T-3-17 | Denial of Service | Tagger crashes runner | accept | tagger throws on failure; `DownloadRunner.processTrack` (Plan 03-04) catches and marks the track failed without aborting the run (D-03 per-track isolation). Tagger itself has no further mitigation; the per-track try/catch in the runner is the boundary. |
</threat_model>

<verification>
After all 3 tasks complete:

1. `pnpm test src/modules/server/downloader/` — slug + tagger + cover-art tests all green
2. `pnpm typecheck` — clean
3. `pnpm check` — Biome happy
4. `ls src/modules/server/downloader/` — fixtures/, schema.ts, slug.ts, slug.test.ts, tagger.ts, tagger.test.ts, cover-art.ts, cover-art.test.ts (Plan 03-02 in parallel may have added YtDlpBridge.*; Plan 03-04 consolidates the barrel)
5. No `shell: true` anywhere in the new code
</verification>

<success_criteria>
- tagger.ts and cover-art.ts compile cleanly and integrate with downstream consumers via the index.ts barrel
- Tagger covers all four ID3 frames (TIT2/TPE1/TALB/APIC) with explicit omit-when-null behavior verified by tests
- Cover-art fetcher has T-3-04 SSRF mitigation tested (https-only + MIME allowlist + size cap)
- DownloadRunner (Plan 03-04) imports tagger + cover-art via relative paths (`./tagger`, `./cover-art`); the consolidated barrel write happens in Plan 03-04
</success_criteria>

<output>
After completion, create `.planning/phases/03-match-download-slice-end-to-end-mp3/03-03-SUMMARY.md`.
</output>
