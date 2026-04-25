---
phase: 03-match-download-slice-end-to-end-mp3
plan: 05
type: execute
wave: 4
depends_on: [03-01, 03-02, 03-03, 03-04]
files_modified:
  - src/modules/server/downloader/integration.test.ts
autonomous: false
requirements: [MATCH-01, MATCH-02, DOWNLOAD-01, DOWNLOAD-02, DOWNLOAD-03]
user_setup: []

must_haves:
  truths:
    - "A gated integration test (DOWNLOADER_INTEGRATION=1) exercises real yt-dlp + ffmpeg subprocesses inside the Docker dev container"
    - "The test fetches a known-good public-domain track on YouTube via real ytsearch1, verifies probe envelope shape, downloads the MP3, embeds tags via real node-id3, and reads back via NodeID3.read to verify TIT2/TPE1 round-trip"
    - "Network-failure paths are tolerated (logs a warning + skips shape asserts); only contract correctness is asserted when the live fetch succeeds"
    - "Manual end-to-end smoke (Success Criterion #5) is documented as a HUMAN-UAT checkpoint with exact step-by-step instructions"
    - "The Docker dev image rebuild picks up yt-dlp from scraper/requirements.txt and exposes YT_DLP_BIN=/app/scraper/.venv/bin/yt-dlp"
  artifacts:
    - path: "src/modules/server/downloader/integration.test.ts"
      provides: "Gated DOWNLOADER_INTEGRATION=1 integration test that hits real yt-dlp + ffmpeg + node-id3"
      contains: "DOWNLOADER_INTEGRATION"
      min_lines: 120
  key_links:
    - from: "src/modules/server/downloader/integration.test.ts"
      to: "yt-dlp + ffmpeg in /app/scraper/.venv/bin/"
      via: "real subprocess spawn via YtDlpBridge"
      pattern: "DOWNLOADER_INTEGRATION"
---

<objective>
Land the final two pieces of Phase 3 verification: a gated integration test that exercises the entire downloader pipeline with real yt-dlp + ffmpeg + node-id3 subprocesses (one short public-domain track end-to-end), and a HUMAN-UAT checkpoint that walks the user through the manual smoke (Success Criterion #5: a real Spotify playlist sync ends with at least one tagged MP3 on disk).

Purpose: Closes Success Criterion #5 from ROADMAP.md Phase 3 — "A complete sync on a single configured playlist ends with at least one real tagged MP3 on disk for a known-good track." The unit suite from Plans 03-02..03-04 provides Nyquist-rate feedback during execution; this plan provides the end-to-end contract validation that mocks cannot give.

Output: One gated integration test file + one human checkpoint with documented step-by-step instructions. After this plan, Phase 3 is ship-ready.
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
@.planning/phases/03-match-download-slice-end-to-end-mp3/03-VALIDATION.md
@CLAUDE.md
@src/modules/server/scraper/integration.test.ts
@src/modules/server/downloader/YtDlpBridge.ts
@src/modules/server/downloader/tagger.ts
@src/modules/server/downloader/cover-art.ts
@src/modules/server/downloader/slug.ts
@src/modules/server/downloader/index.ts
@Dockerfile
@Dockerfile.dev
@scraper/requirements.txt

<interfaces>
<!-- The integration test consumes these as production callers do (no DI / no mocks). -->

From src/modules/server/downloader/index.ts (Plan 03-04):
```typescript
export { YtDlpBridge, embedTags, fetchCoverArt, sourceSlug, safeFilename } from "...";
import NodeID3 from "node-id3"; // for read-back assertions
```

From src/modules/server/scraper/integration.test.ts — TEMPLATE TO MIRROR:
```typescript
const gated = process.env.SCRAPER_INTEGRATION === "1";
const d = gated ? describe : describe.skip;

d("SpotifyScraperBridge (gated — real Python subprocess)", () => { ... });
```
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Create gated integration test exercising real yt-dlp + ffmpeg + node-id3</name>
  <files>src/modules/server/downloader/integration.test.ts</files>
  <read_first>
    - src/modules/server/scraper/integration.test.ts (entire file — gating + tolerant-network branch + timeout patterns)
    - src/modules/server/downloader/YtDlpBridge.ts (Plan 03-02 — interfaces probe + download)
    - src/modules/server/downloader/tagger.ts (Plan 03-03 — embedTags)
    - src/modules/server/downloader/slug.ts (Plan 03-01 — safeFilename for output path)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-PATTERNS.md (section "downloader/integration.test.ts")
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-RESEARCH.md (Validation Architecture §gated integration; Sources verifying yt-dlp behavior)
    - .planning/phases/03-match-download-slice-end-to-end-mp3/03-VALIDATION.md
  </read_first>
  <behavior>
    Gate pattern (mirrors Phase 2 exactly):
    ```typescript
    const gated = process.env.DOWNLOADER_INTEGRATION === "1";
    const d = gated ? describe : describe.skip;
    d("YtDlpBridge + tagger (gated — real yt-dlp + ffmpeg + node-id3)", () => { ... });
    ```

    Test cases:
    1. **probe known-good track returns shaped envelope**: query a stable, well-indexed public-domain song (recommended: `"Kevin MacLeod Wallpaper"` or `"Big Buck Bunny audio"` — both reliably return YouTube hits without copyright issues; if ytsearch1 fails for any reason, log + tolerant-skip per Phase 2 pattern). Verify `probe.error === null`, `probe.videoId` is non-empty (~11 chars), `probe.durationSeconds > 0`.

    2. **probe deliberately-unmatchable returns no_results**: query something like `"qwerasdfzxcv impossible nonsense 12345 2026"`. Verify `probe.error.type === "no_results"` AND `probe.videoId === null`.

    3. **download produces a real MP3**: take a known-good videoId (or call probe inline first to get one), write to `path.join(tmpdir(), \`dl-${Date.now()}.mp3\`)`. Verify `dl.error === null`, file exists, file size > 1KB (a real MP3 — not an empty placeholder).

    4. **tag round-trip on the downloaded file**: call `embedTags(downloadedPath, { title: "Test Title", artist: "Test Artist" })`. Read back via `NodeID3.read(downloadedPath)`. Assert `read.title === "Test Title"`, `read.artist === "Test Artist"`. Skip APIC verification (cover art fetch needs a real CDN URL — not part of this test).

    5. **end-to-end smoke (optional)**: Use `safeFilename("Test Artist", "Test Title")` to compute a filename; verify the resulting path is sanitized; combine with the download from #3 + tag from #4 to verify the entire pipeline produces a tagged MP3 at the canonical path shape.

    Tolerant-network branches: each test handles `error.type === "network_error"` by logging a warning + returning early (Phase 2 pattern at integration.test.ts:38-45). Do NOT hard-fail on network unavailability — CI / sandboxed runs may not have YouTube access.

    Cleanup: `afterEach` unlinks the temp MP3 file. Catch ENOENT.

    Timeouts: probe 60s, download 120s (yt-dlp + ffmpeg can take real time on a longer track).

    The test file MUST run inside the Docker dev container after a rebuild (which picks up yt-dlp from scraper/requirements.txt and the ENV YT_DLP_BIN from Plan 03-01). Document this in the file's header docblock.
  </behavior>
  <action>
    1. Create `src/modules/server/downloader/integration.test.ts`. Mirror the structure of `src/modules/server/scraper/integration.test.ts` exactly:
       - Header docblock describing the gate, the env requirements, and the docker rebuild step
       - `const gated = process.env.DOWNLOADER_INTEGRATION === "1";`
       - `const d = gated ? describe : describe.skip;`
       - `d("YtDlpBridge + tagger + node-id3 (gated — real subprocesses)", () => { ... })` block containing the 4-5 tests above
    2. Choose a stable public-domain track for probe test #1. Recommended: `"Kevin MacLeod Carefree"` (Kevin MacLeod publishes royalty-free music; "Carefree" is widely available on YouTube). If the chosen query becomes unreliable in the future, the test should still detect `error.type === "network_error"` and skip gracefully.
    3. For test #3 (download), prefer chaining off the probe result in test #1 to avoid hard-coding a videoId that might disappear:
       ```typescript
       it("downloads a known-good track to disk", async () => {
           const bridge = new YtDlpBridge();
           const probe = await bridge.probe("Kevin MacLeod Carefree");
           if (probe.error?.type === "network_error") {
               console.warn("[integration] network_error in probe — skipping download test");
               return;
           }
           expect(probe.error).toBeNull();
           expect(probe.videoId).toBeTruthy();

           const targetPath = path.join(tmpdir(), `dl-test-${Date.now()}.mp3`);
           const dl = await bridge.download(probe.videoId!, targetPath);
           if (dl.error?.type === "network_error") { ... return; }
           expect(dl.error).toBeNull();

           const stats = await stat(targetPath);
           expect(stats.size).toBeGreaterThan(1024);

           await unlink(targetPath).catch(() => {});
       }, 120_000);
       ```
    4. Run the test in skip mode (the default) to confirm it doesn't hard-fail on a host without yt-dlp installed:
       ```bash
       pnpm test src/modules/server/downloader/integration.test.ts
       ```
       Expected: tests appear as skipped (since `DOWNLOADER_INTEGRATION` is not set).
    5. Run `pnpm typecheck` and `pnpm check` (the test file must compile cleanly even when the gate is off).
    6. **Optional gated run** (only if the executor has access to a Docker dev container with the rebuild applied): run inside the container:
       ```bash
       pnpm docker:dev   # in another shell, rebuilds with yt-dlp pinned
       docker exec <dev-container> sh -c "DOWNLOADER_INTEGRATION=1 pnpm test src/modules/server/downloader/integration.test.ts"
       ```
       This is OPTIONAL during plan execution — the gated run is part of `/gsd-verify-work` for the phase, not a per-task gate. The unit suite at this point is sufficient for the task to pass.
  </action>
  <verify>
    <automated>test -f src/modules/server/downloader/integration.test.ts &amp;&amp; grep -q 'DOWNLOADER_INTEGRATION' src/modules/server/downloader/integration.test.ts &amp;&amp; grep -q 'gated ? describe : describe.skip' src/modules/server/downloader/integration.test.ts &amp;&amp; grep -q 'YtDlpBridge' src/modules/server/downloader/integration.test.ts &amp;&amp; grep -q 'NodeID3.read\|embedTags' src/modules/server/downloader/integration.test.ts &amp;&amp; grep -q 'network_error' src/modules/server/downloader/integration.test.ts &amp;&amp; pnpm test src/modules/server/downloader/integration.test.ts &amp;&amp; pnpm typecheck &amp;&amp; pnpm check</automated>
  </verify>
  <acceptance_criteria>
    - `test -f src/modules/server/downloader/integration.test.ts` exits 0
    - `grep -q 'DOWNLOADER_INTEGRATION' src/modules/server/downloader/integration.test.ts` exits 0
    - `grep -q 'gated ? describe : describe.skip' src/modules/server/downloader/integration.test.ts` exits 0 (gating pattern matches Phase 2)
    - `grep -q 'YtDlpBridge' src/modules/server/downloader/integration.test.ts` exits 0
    - `grep -q 'embedTags\|NodeID3' src/modules/server/downloader/integration.test.ts` exits 0
    - `grep -q 'network_error' src/modules/server/downloader/integration.test.ts` exits 0 (tolerant-network branch present)
    - `grep -q '120_000\|60_000' src/modules/server/downloader/integration.test.ts` exits 0 (timeout values set)
    - `pnpm test src/modules/server/downloader/integration.test.ts` exits 0 with all integration tests SKIPPED (gate is off in default run)
    - `pnpm typecheck` exits 0
    - `pnpm check` exits 0
  </acceptance_criteria>
  <done>integration.test.ts is committed, skips cleanly when gate is off, and has 4-5 tests ready to run inside the Docker dev container after a rebuild via `pnpm docker:dev` + `DOWNLOADER_INTEGRATION=1`.</done>
</task>

<task type="checkpoint:human-verify" gate="blocking">
  <name>Task 2: HUMAN-UAT — End-to-end manual smoke (Success Criterion #5)</name>
  <what-built>
    Phase 3 is now wired end-to-end:
    - Schema migration applied (album + kind columns)
    - YtDlpBridge spawns yt-dlp argv-form (probe + download)
    - Tagger writes ID3 frames via node-id3; cover-art fetched HTTPS-only with safety guards
    - DownloadRunner orchestrates per-source pipeline with pLimit(N) + per-track state machine + per-track failure isolation
    - DownloadHandler subscribes to playlist.sync.completed; runningPlaylists lock survives the chain (D-06)
    - playlist.download.completed event fires at end of every download run
    - Default match settings seeded ({tolerance_seconds:3, parallel:3})
    - Docker images install yt-dlp into /app/scraper/.venv/bin and export YT_DLP_BIN
    - Gated integration test (DOWNLOADER_INTEGRATION=1) ready to run inside the dev container

    What this checkpoint validates: the entire chain works against real Spotify + real YouTube + real disk, producing at least one tagged MP3 file. This is Success Criterion #5 from the ROADMAP.
  </what-built>
  <how-to-verify>
    Run inside the Docker dev container (the Dockerfile updates from Plan 03-01 must take effect — fresh rebuild required).

    1. **Rebuild the dev container with the new yt-dlp install layer:**
       ```bash
       pnpm docker:down 2>/dev/null   # if a prior dev container is up
       pnpm docker:dev                # rebuilds + starts; yt-dlp is now in /app/scraper/.venv/bin
       ```
       Wait for the dev server log line "Local: http://0.0.0.0:3000".

    2. **Re-seed the DB if needed:** in another shell:
       ```bash
       docker exec <dev-container-name> sh -c "pnpm seed"
       ```
       Confirm console output includes "Default match settings seeded."

    3. **Open the UI:** browser → http://localhost:3000/

    4. **Configure a small public Spotify playlist source:**
       - Click "Add playlist" (or whatever the existing UI affordance is from Phase 2)
       - Use a known-good public Spotify playlist URL with 3-10 tracks and a clear cover art (e.g. a niche public mix you control, or a small genre playlist). Avoid Today's Top Hits — too many tracks slows the test.
       - Output dir: any value (Phase 3 uses `data/music/<slug>/` regardless per D-15 + DOWNLOAD-03)
       - Save the source.

    5. **Trigger a sync:**
       - Click the "Sync now" button on the playlist row.
       - Open the dev container logs in a third shell: `docker logs -f <dev-container-name>`
       - Expected sequence in logs:
         a. `playlist.sync.started` event logged (LoggingHandler in dev mode)
         b. `SyncRunner` invocation row created (kind=scrape)
         c. `playlist.sync.completed` event after scrape finishes
         d. `Download handler registered` entry confirmed at startup; on the event, `DownloadRunner` log lines (or empty-message info if zero tracks)
         e. Per-track logs: probe + download for each pending track
         f. `playlist.download.completed` event after the runner finishes

    6. **Verify output on disk:**
       ```bash
       docker exec <dev-container-name> sh -c "ls -la /app/data/music/"
       # Expected: a directory matching sourceSlug(playlist-name)
       docker exec <dev-container-name> sh -c "ls -la /app/data/music/<slug>/"
       # Expected: at least one .mp3 file matching "Artist - Title.mp3"
       docker exec <dev-container-name> sh -c "ls -la /app/data/music/<slug>/*.mp3 | head -1"
       # File size should be > 1MB for a typical 3-min track
       ```

    7. **Verify ID3 tags via ffprobe:**
       ```bash
       docker exec <dev-container-name> sh -c "ffprobe -v error -show_entries format_tags=title,artist,album '/app/data/music/<slug>/<file>.mp3'"
       # Expected: title=<spotify title>, artist=<spotify artist>
       # album: empty/absent for playlist sources (D-13 — null for v1)
       ```
       OR open the file in any music player (VLC, iTunes, etc.) and visually confirm the title + artist are populated. Cover art should be visible.

    8. **Verify the DB rows:**
       ```bash
       docker exec <dev-container-name> sh -c "sqlite3 /app/data/db.sqlite 'SELECT state, count(*) FROM tracks WHERE source_id = (SELECT id FROM sources LIMIT 1) GROUP BY state'"
       # Expected: at least one row with state=downloaded
       docker exec <dev-container-name> sh -c "sqlite3 /app/data/db.sqlite 'SELECT kind, status, summary FROM invocations ORDER BY started_at DESC LIMIT 4'"
       # Expected: kind=download row with status=success and summary JSON containing downloaded > 0
       ```

    9. **(Optional) Run the gated integration test inside the dev container:**
       ```bash
       docker exec -it <dev-container-name> sh -c "DOWNLOADER_INTEGRATION=1 pnpm test src/modules/server/downloader/integration.test.ts"
       ```
       Expected: 4-5 tests pass (or skip with "[integration] network_error..." warnings if YouTube is unreachable).

    Pass criteria:
    - At least one .mp3 file lands on disk under `/app/data/music/<slug>/`
    - The file is a valid MP3 (size > 1MB, plays in a music player)
    - ID3 tags TIT2 (title) and TPE1 (artist) are populated correctly from Spotify
    - Cover art (APIC) is embedded if the playlist had a cover_art_url (Phase 2 captured it)
    - The `tracks` table has at least one row with state='downloaded' and a populated `download_path`
    - The `invocations` table has both a kind='scrape' AND a kind='download' row, both status='success'
    - The Discord webhook handler did NOT crash (Phase 2 contract preserved)

    Document any deviations or partial successes in the checkpoint resume message. If the test reveals a bug (e.g. a yt-dlp version incompatibility, an unhandled stderr pattern, a slug-collision edge case), capture the failure mode and either:
    - Fix-forward in this plan (small fix), or
    - File a follow-up task and proceed (large fix — gap-closure plan can come later via `/gsd-plan-phase 3 --gaps`)
  </how-to-verify>
  <resume-signal>
    Type "approved" if the smoke test produces a tagged MP3 on disk with correct ID3 tags AND both invocation rows show success.

    Type "issue: <description>" if anything fails — e.g. "issue: yt-dlp returned no_results for all tracks", "issue: cover-art APIC frame missing despite cover_art_url being set", "issue: download succeeded but TALB present despite playlist source (D-13 violation)".

    Type "skip with note: <reason>" if the smoke test cannot be run in this environment (e.g. no Docker available, no internet access, sandboxed runner) — Phase verification will then defer to the next available run.
  </resume-signal>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Real YouTube API → real yt-dlp → real ffmpeg → disk | Every prior boundary mitigation (T-3-01..T-3-05) is exercised end-to-end here. The integration test is the only place these mitigations meet real adversarial input. |
| Public Spotify playlist URL → spotifyscraper → tracks table | Phase 2 boundary; Phase 3's smoke validates that the Phase 2 contract still works alongside the new Phase 3 download chain. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-3-19 | Information Disclosure | Integration test exposes a real query string in CI logs | accept | The query strings used (`"Kevin MacLeod Carefree"`, `"qwerasdf...impossible..."`) are public, generic, and contain no secrets. CI log retention is the user's concern; we don't introduce any new secret surface. |
| T-3-20 | Tampering | Integration test could pollute /tmp on shared CI runners | mitigate | Test uses `path.join(tmpdir(), \`dl-test-${Date.now()}.mp3\`)` for per-run uniqueness and unlinks in afterEach. Even if cleanup fails, the file lives in tmpdir and gets cleaned by OS. |
| T-3-21 | Denial of Service | Network unavailability hard-fails CI | mitigate | Tolerant branch on `error.type === "network_error"` skips shape asserts with a console.warn. Mirrors Phase 2 pattern. CI without network access still passes the unit suite. |
</threat_model>

<verification>
After both tasks complete:

1. `pnpm test` — full suite green; integration test skipped (gate off)
2. `pnpm typecheck` — clean
3. `pnpm check` — Biome happy
4. The HUMAN-UAT checkpoint produces a tagged MP3 on disk OR documents a specific failure that gets routed to gap closure

Phase 3 is now ready for `/gsd-verify-work` which will:
- Re-run the unit suite
- Recommend running the gated integration test inside Docker (`DOWNLOADER_INTEGRATION=1 pnpm test`)
- Reference the HUMAN-UAT checkpoint result to attest Success Criterion #5
</verification>

<success_criteria>
- integration.test.ts is committed and runs cleanly in skip mode in unit suite
- Manual smoke checkpoint produced at least one tagged MP3 on disk OR documented a clear bug for gap closure
- Phase 3 ready for transition (Plans 03-01..03-05 all complete; ROADMAP.md Plans line lists 5 plans)
</success_criteria>

<output>
After completion, create `.planning/phases/03-match-download-slice-end-to-end-mp3/03-05-SUMMARY.md`.
</output>
