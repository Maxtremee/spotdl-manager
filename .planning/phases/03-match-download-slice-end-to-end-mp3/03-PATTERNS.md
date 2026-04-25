# Phase 3: Match + download slice (end-to-end MP3) — Pattern Map

**Mapped:** 2026-04-25
**Files analyzed:** 22 (12 NEW + 10 MODIFIED)
**Analogs found:** 21 / 22 (1 file — `tagger.ts` — has no direct analog; pure-helper module shape borrowed from `webhooks/service.ts`)

---

## Executive Summary — Phase 2 Isomorphism

Phase 3 is a structural mirror of Phase 2's `scraper/` slice. The triad
`SpotifyScraperBridge` → `SyncRunner` → `ScraperRepository` (+ `schema.ts`,
`integration.test.ts`, `index.ts`) maps almost 1:1 onto
`YtDlpBridge` → `DownloadRunner` → `DownloadRepository`.

**Key isomorphisms (copy these shapes):**

1. **Bridge spawn shape** — argv-form `child_process.spawn`, `shell: false`, `stdio: ["pipe","pipe","pipe"]`, `timeout` option, `await once(child, "close")`, accumulated `Buffer[]` chunks. Exact pattern at `src/modules/server/scraper/SpotifyScraperBridge.ts:67-93`.
2. **W-1 shared-constant convention** — `PYTHON_CRASH_PREFIX` is exported from `schema.ts` and imported by both bridge and runner. Phase 3's analog is `YTDLP_NO_RESULTS_MARKER` (or `YTDLP_CRASH_PREFIX`) defined once in `downloader/schema.ts`, imported by `YtDlpBridge` (writes the marker) and `DownloadRunner` (detects via `.startsWith`).
3. **Typed envelope on stdout** — `PythonEnvelopeSchema` (Zod) at `src/modules/server/scraper/schema.ts:45-52`. Phase 3 mirrors with `YtDlpProbeEnvelopeSchema` for `--print id --print duration` output.
4. **Lifecycle wrapper around bridge call** — `SyncRunner.run()` opens an invocation row (`status=running`), invokes bridge, classifies result, finalizes (`success` or `failed`), always emits a terminal event. `DownloadRunner.run()` follows the same skeleton but **with a divergent loop body** (per-track p-limit fan-out, per-track failure isolation — see Pattern Assignments below).
5. **Gated integration test** — `process.env.SCRAPER_INTEGRATION === "1"` at `src/modules/server/scraper/integration.test.ts:28-29`. Phase 3 adds `process.env.DOWNLOADER_INTEGRATION === "1"` gate.
6. **In-memory SQLite + latest-migration test setup** — `repository.test.ts` reads `drizzle/<latest>.sql` and execs into `:memory:` via `better-sqlite3` (W-5: never hand-write CREATE TABLE). Pattern at `src/modules/server/scraper/repository.test.ts:18-32`.
7. **Mocked-spawn unit tests** — `vi.mock("node:child_process")` + `EventEmitter`-based fake child. Pattern at `src/modules/server/scraper/SpotifyScraperBridge.test.ts:1-46`.
8. **Settings JSON in `globalSettings` row** — single key, JSON value, Zod-parsed on read with safe defaults on parse failure. Pattern at `src/modules/server/webhooks/repository.ts:13-61`.

**Critical divergences (do NOT blindly copy):**

- `SyncRunner` does an **atomic-on-failure** upsert (D-08 Phase 2): all tracks written in one transaction or none. `DownloadRunner` is **per-track-isolated** (D-03 Phase 3): each track has independent state writes; one track's failure does not abort the run, and the invocation finishes `status=success` so long as the runner itself didn't crash.
- `SyncRunner` does **one bridge call per run**. `DownloadRunner` does **two spawns per accepted track** (probe + download) and zero-spawn-on-skip (idempotent skip-if-exists).
- `SyncRunner` reads no settings. `DownloadRunner` snapshots `match` settings (`tolerance_seconds` + `parallel`) at run start (D-11/D-16) — settings UI is the same `globalSettings` JSON row pattern as `webhooks`.
- The Phase 2 invocation row is **kind-implicit** (`scrape`). Phase 3 introduces `kind: text(...).default('scrape')` on `invocations` so consumers can disambiguate the two rows per sync (D-05).

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/modules/server/downloader/YtDlpBridge.ts` | bridge (subprocess wrapper class) | request-response (one-shot spawn → typed envelope) | `src/modules/server/scraper/SpotifyScraperBridge.ts` | **exact** — both wrap argv-form spawn + Zod envelope + W-1 shared constant |
| `src/modules/server/downloader/YtDlpBridge.test.ts` | test (unit, mocked spawn) | event-driven (EventEmitter fake) | `src/modules/server/scraper/SpotifyScraperBridge.test.ts` | **exact** |
| `src/modules/server/downloader/DownloadRunner.ts` | runner (orchestrator class) | batch (per-track p-limit fan-out) | `src/modules/server/scraper/SyncRunner.ts` | **role-match, divergent loop body** |
| `src/modules/server/downloader/DownloadRunner.test.ts` | test (unit, fake bridge/repo) | mocked event bus + DI | `src/modules/server/scraper/SyncRunner.test.ts` | **exact (test surface), divergent expectations** |
| `src/modules/server/downloader/repository.ts` | repository (data-access class) | CRUD (per-track UPDATE; settings GET/UPSERT) | `src/modules/server/scraper/repository.ts` + `src/modules/server/webhooks/repository.ts` | **role-match (combines two analogs: track-row write + settings JSON)** |
| `src/modules/server/downloader/repository.test.ts` | test (Drizzle in-memory) | DB | `src/modules/server/scraper/repository.test.ts` | **exact** |
| `src/modules/server/downloader/tagger.ts` | utility (pure Node helper, no class) | file-I/O (read/write MP3 frames) | `src/modules/server/webhooks/service.ts` (shape: top-level functions, no class) | **role-only** — node-id3 has no prior consumer in repo |
| `src/modules/server/downloader/tagger.test.ts` | test (fixture-driven) | file-I/O fixture | `src/modules/server/webhooks/service.test.ts` (function-export tests) | **role-only** |
| `src/modules/server/downloader/cover-art.ts` | utility (HTTP fetch helper) | request-response (Node global `fetch`) | `src/modules/server/webhooks/service.ts:70-138` (`sendDiscordWebhook`) | **role-match** |
| `src/modules/server/downloader/slug.ts` | utility (pure helper) | transform | none in repo (pure-fn module is a fresh shape) | **role-only** |
| `src/modules/server/downloader/handler.ts` | handler (event subscriber) | event-driven (`playlist.sync.completed` → run) | `src/modules/server/webhooks/handler.ts` (`registerDiscordWebhookHandler`) | **exact** — same `bus.on(...)` + unsubscribe-fn return shape |
| `src/modules/server/downloader/integration.test.ts` | test (gated integration) | external process | `src/modules/server/scraper/integration.test.ts` | **exact** |
| `src/modules/server/downloader/schema.ts` | schema (Zod + shared constants) | static config | `src/modules/server/scraper/schema.ts` | **exact** |
| `src/modules/server/downloader/index.ts` | barrel | n/a | `src/modules/server/scraper/index.ts` | **exact** |
| `src/modules/server/db/schema.ts` (MOD) | model | DDL | self (Phase 2 lock; ADD only) | **exact (extend, no breaking changes)** |
| `src/modules/server/events/schema.ts` (MOD) | event-schema | static config | `PlaylistSyncCompletedEventSchema` definition (same file) | **exact** |
| `src/modules/server/events/handlers.ts` (MOD) — OR new `downloader/handler.ts` | handler | event-driven | `registerDiscordWebhookHandler` (`webhooks/handler.ts`) | **exact** (research recommends `downloader/handler.ts`) |
| `server/plugins/events.ts` (MOD) | plugin (Nitro startup) | boot | self (existing handler registrations) | **exact (append one line)** |
| `src/modules/server/scheduler/PlaylistScheduler.ts` (MOD) | runner (cron + lock) | event-driven | self — research finding: **no code change**; lock automatically spans because `executePlaylistSync` already `await`s `syncRunner.run` and the new handler runs inside the bus emit chain awaited inside SyncRunner. Plan adds a focused unit test only. |
| `src/modules/server/invocation/repository.ts` (MOD) | repository | CRUD | self (existing `create` / `update`) | **exact (extend `NewInvocationRow` shape via schema change; methods need no body change)** |
| `src/modules/server/db/seed.ts` (MOD) | seed | DDL/DML | self + `webhooks/repository.ts:39-60` (settings upsert) | **role-match** |
| `package.json` (MOD) | config | static | self | n/a |
| `Dockerfile` + `Dockerfile.dev` (MOD) | config | static | self (existing pip-into-venv install layer) | **exact (extend existing pip line)** |
| `drizzle/<new>.sql` (MOD) | migration (auto-gen) | DDL | self | n/a — `pnpm db:generate` produces it |

---

## Pattern Assignments

### `src/modules/server/downloader/YtDlpBridge.ts` (bridge, request-response)

**Analog:** `src/modules/server/scraper/SpotifyScraperBridge.ts` (entire file — 137 lines)

**Imports pattern** (lines 20-30):
```typescript
import { spawn } from "node:child_process";
import { once } from "node:events";
import { env } from "~/env";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import {
	PYTHON_CRASH_PREFIX,
	type PythonEnvelope,
	PythonEnvelopeSchema,
	type ScrapeRequest,
} from "./schema";
```
For Phase 3: replace with `YTDLP_CRASH_PREFIX`, `YtDlpProbeEnvelope`, `YtDlpProbeEnvelopeSchema`, etc.

**Module-level constants pattern** (lines 32-35):
```typescript
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PYTHON_BIN = "scraper/.venv/bin/python";
const DEFAULT_SCRIPT_PATH = "scraper/scraper.py";
const STDERR_SLICE_LIMIT = 500;
```
Phase 3 analog: `DEFAULT_PROBE_TIMEOUT_MS = 30_000;` `DEFAULT_DOWNLOAD_TIMEOUT_MS = 600_000;` `DEFAULT_YT_DLP_BIN = "yt-dlp";` `STDERR_SLICE_LIMIT = 500;`.

**Class shell + DI constructor** (lines 37-53):
```typescript
export class SpotifyScraperBridge {
	private readonly pythonBin: string;
	private readonly scriptPath: string;
	private readonly timeoutMs: number;
	private readonly logger: AppLogger;

	constructor(
		pythonBin?: string,
		scriptPath?: string,
		timeoutMs?: number,
		logger?: AppLogger,
	) {
		this.pythonBin = pythonBin ?? env.PYTHON_BIN ?? DEFAULT_PYTHON_BIN;
		this.scriptPath = scriptPath ?? DEFAULT_SCRIPT_PATH;
		this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.logger = logger ?? Logger.get("SpotifyScraperBridge");
	}
}
```
Phase 3: `class YtDlpBridge { ytDlpBin, probeTimeoutMs, downloadTimeoutMs, logger }` — read `env.YT_DLP_BIN ?? "yt-dlp"`. **Add `YT_DLP_BIN` to `src/env.ts` mirroring `PYTHON_BIN` (already there at line 14).**

**Core spawn pattern** (lines 67-93) — THE TEMPLATE:
```typescript
async fetchPlaylist(url: string): Promise<PythonEnvelope> {
	const child = spawn(this.pythonBin, [this.scriptPath], {
		stdio: ["pipe", "pipe", "pipe"],
		timeout: this.timeoutMs,
	});

	const stdoutChunks: Buffer[] = [];
	const stderrChunks: Buffer[] = [];

	child.stdout.on("data", (chunk: Buffer) => {
		stdoutChunks.push(chunk);
	});

	child.stderr.on("data", (chunk: Buffer) => {
		stderrChunks.push(chunk);
	});

	// Phase 2: stdin write (Phase 3 SKIPS THIS — yt-dlp takes argv only)
	const req: ScrapeRequest = { url, source_type: "playlist" };
	child.stdin.end(`${JSON.stringify(req)}\n`);

	// Wait for the process to finish — parse ONLY after close fires (Pitfall 2 prevention).
	const [code, signal] = (await once(child, "close")) as [
		number | null,
		NodeJS.Signals | null,
	];

	const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
	const stderrFull = Buffer.concat(stderrChunks).toString("utf8").trim();
```
**Phase 3 adaptation:** two methods, `probe(query)` and `download(videoId, outputPath)`, both follow this exact template. Differences: (a) no stdin write (yt-dlp takes argv only); (b) probe uses `--print id --print duration --skip-download --no-warnings -q ytsearch1:<query>`; (c) download uses `-f bestaudio --extract-audio --audio-format mp3 --audio-quality 0 -o <path> https://www.youtube.com/watch?v=<id>`.

**Envelope-parse pattern** (lines 98-115):
```typescript
if (stdout.length > 0) {
	try {
		const raw: unknown = JSON.parse(stdout);
		const parsed = PythonEnvelopeSchema.safeParse(raw);
		if (parsed.success) {
			return parsed.data;
		}
		this.logger.error(
			{ validationErrors: parsed.error.message, code, signal },
			"SpotifyScraperBridge: stdout present but Zod validation failed — synthesizing crash envelope",
		);
	} catch (jsonErr) {
		this.logger.error(
			{ jsonErr, code, signal, stdoutPreview: stdout.slice(0, 200) },
			"SpotifyScraperBridge: stdout present but JSON.parse threw — synthesizing crash envelope",
		);
	}
}
```
**Phase 3 adaptation for probe:** stdout is `<videoId>\n<durationSeconds>\n` (NOT JSON). Parse via `stdout.split("\n").filter(Boolean)` and extract `[videoId, durationStr]`. Validate via `YtDlpProbeEnvelopeSchema`. **Empty stdout + exit 0 = `no_results`** (research Pitfall 1: yt-dlp does NOT exit non-zero on zero search hits).

**Crash-envelope synthesis** (lines 117-135) — THE W-1 PATTERN:
```typescript
// W-1: `PYTHON_CRASH_PREFIX` is imported from "./schema" — NOT a string literal.
// SyncRunner (Plan 04) detects this prefix via `.startsWith(PYTHON_CRASH_PREFIX)`
// and overrides `error.type` to `"python_crash"` in the FailureReason enum.
const stderr = stderrFull.slice(0, STDERR_SLICE_LIMIT);

return {
	tracks: null,
	cover_art_url: null,
	error: {
		type: "network_error",
		message: `${PYTHON_CRASH_PREFIX} exit=${code} signal=${signal} stderr=${stderr}`,
	},
};
```
**Phase 3 W-1 contract:** define `YTDLP_CRASH_PREFIX = "yt-dlp crash:"` (and optionally `YTDLP_NO_RESULTS_MARKER = "yt-dlp no_results"` for the empty-stdout-exit-0 case) in `downloader/schema.ts`. Bridge writes the prefix; `DownloadRunner` detects via `.startsWith`. **Never duplicate the literal.**

**Security note from analog (lines 9-13):** `shell: false` is the default and must NEVER be set to `true`. Phase 3 mirror — argv-form spawn defends against title/artist injection (apostrophes, semicolons, etc.).

---

### `src/modules/server/downloader/YtDlpBridge.test.ts` (test, mocked spawn)

**Analog:** `src/modules/server/scraper/SpotifyScraperBridge.test.ts` (entire file — 396 lines, 10 tests)

**Mock-setup pattern** (lines 1-21):
```typescript
import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

vi.mock("~/env", () => ({
	env: { PYTHON_BIN: undefined },
}));

vi.mock("~/logger", () => ({
	Logger: {
		get: vi.fn(() => ({
			info: vi.fn(),
			error: vi.fn(),
			debug: vi.fn(),
			warn: vi.fn(),
		})),
	},
}));
```

**Fake-child factory** (lines 27-39):
```typescript
type FakeChild = {
	stdout: EventEmitter;
	stderr: EventEmitter;
	stdin: { end: ReturnType<typeof vi.fn> };
} & EventEmitter;

function makeFakeChild(): FakeChild {
	const child = new EventEmitter() as FakeChild;
	child.stdout = new EventEmitter();
	child.stderr = new EventEmitter();
	child.stdin = { end: vi.fn() };
	return child;
}

async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}
```

**Test-1 happy path template** (lines 56-95):
```typescript
const child = makeFakeChild();
vi.mocked(spawn).mockReturnValue(child as any);
const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
const promise = bridge.fetchPlaylist("https://...");

await tick();

const envelope = { tracks: [...], cover_art_url: "...", error: null };
child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
child.emit("close", 0, null);

const result = await promise;
expect(result.tracks).toHaveLength(1);
```

**`shell: false` assertion pattern** (lines 320-331):
```typescript
const [bin, args, opts] = vi.mocked(spawn).mock.calls[0] as [
	string,
	string[],
	Record<string, unknown>,
];
expect(typeof bin).toBe("string");
expect(Array.isArray(args)).toBe(true);
expect(args).toContain("scraper/scraper.py");
expect(opts?.shell).not.toBe(true);
expect(opts?.stdio).toEqual(["pipe", "pipe", "pipe"]);
```
Phase 3 adaptation: assert `args` contains `"--skip-download"` (probe) or `"--audio-format"` (download). Assert no shell.

**W-1 prefix-contract test** (lines 368-393): mirror exactly with `YTDLP_CRASH_PREFIX`.

**Test-coverage targets to mirror:**
1. happy path (probe success → typed envelope)
2. zero-results (empty stdout + exit 0 → `no_results` typed envelope) **← NEW for Phase 3 (Pitfall 1)**
3. yt-dlp crash (exit non-zero → `YTDLP_CRASH_PREFIX` synthesized)
4. malformed stdout (e.g. only one line where two expected) → crash envelope
5. stderr truncation at 500 chars
6. argv-form / `shell: false` assertion
7. timeout option passed through
8. download success path (file presumed to exist after spawn close — actual fs check belongs in `DownloadRunner` not bridge)
9. download crash (ffmpeg error → typed envelope)
10. W-1 prefix imported from schema (not literal)

---

### `src/modules/server/downloader/DownloadRunner.ts` (runner, batch with per-track isolation)

**Analog:** `src/modules/server/scraper/SyncRunner.ts` (entire file — 290 lines)

**CRITICAL DIVERGENCE — read this first:** `SyncRunner` runs **one bridge call** per run and writes tracks **atomically** (D-08: all tracks or none). `DownloadRunner` runs **per-track work** through a **`pLimit(N)` pool** and writes **per-track state at three transition points** (D-02: pending→matched→downloaded). A per-track failure is **isolated** (D-03): the track row gets `state=failed`, but the runner continues and the invocation finishes `status=success`. The skeleton below is shared; the loop body is fundamentally different.

**Imports pattern** (lines 21-30):
```typescript
import { randomUUID } from "node:crypto";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import type { SourceRow } from "../db/schema";
import { getEventBus } from "../events";
import type { FailureReason } from "../events/schema";
import { InvocationRepository } from "../invocation/repository";
import { ScraperRepository } from "./repository";
import { SpotifyScraperBridge } from "./SpotifyScraperBridge";
import { PYTHON_CRASH_PREFIX } from "./schema"; // W-1: shared constant — do NOT duplicate literal
```
Phase 3: add `import pLimit from "p-limit";` and `import { access, mkdir } from "node:fs/promises";` and `import path from "node:path";`.

**DI constructor pattern** (lines 56-78):
```typescript
export interface SyncRunnerDeps {
	bridge?: SpotifyScraperBridge;
	invocationRepo?: InvocationRepository;
	scraperRepo?: ScraperRepository;
	logger?: AppLogger;
	clock?: () => Date;
}

export class SyncRunner {
	private readonly bridge: SpotifyScraperBridge;
	private readonly invocationRepo: InvocationRepository;
	private readonly scraperRepo: ScraperRepository;
	private readonly logger: AppLogger;
	private readonly clock: () => Date;

	constructor(deps: SyncRunnerDeps = {}) {
		this.bridge = deps.bridge ?? new SpotifyScraperBridge();
		this.invocationRepo = deps.invocationRepo ?? new InvocationRepository();
		this.scraperRepo = deps.scraperRepo ?? new ScraperRepository();
		this.logger = deps.logger ?? Logger.get("SyncRunner");
		this.clock = deps.clock ?? (() => new Date());
	}
}
```
Phase 3 deps: `bridge?: YtDlpBridge`, `repo?: DownloadRepository`, `invocationRepo?: InvocationRepository`, `tagger?: typeof embedTags`, `coverArtFetcher?: typeof fetchCoverArt`, `logger?`, `clock?`. **All injected for testability** (test surface mocks the bridge interface — see SyncRunner.test.ts pattern).

**Lifecycle skeleton** (lines 86-117) — COPY THIS:
```typescript
async run(source: SourceRow): Promise<void> {
	const invocationId = randomUUID();
	const startedAt = this.clock();
	const eventBus = getEventBus();

	try {
		// 1. Emit started — metrics/webhook consumers see the lifecycle begin.
		await eventBus.emit({
			type: "playlist.sync.started",
			payload: { ... },
		});

		// 2. Write the invocation row so we have a durable record even if we crash later.
		await this.invocationRepo.create({
			id: invocationId,
			playlistId: source.id,
			startedAt,
			status: "running",
		});
		// ... bridge call + finalize ...
	} catch (unexpected) {
		// Pitfall 8: always emit a terminal event — never leave a lifecycle half-started.
		// ... finalizeFailure with synthesized error ...
	}
}
```
Phase 3 adaptations:
- New event: `playlist.download.started` (or reuse `playlist.sync.completed` since the existing handler is the trigger; CONTEXT D-05 leans toward NOT inventing a new "started" event — research recommends adding a `playlist.download.completed` variant with download counters per RESEARCH Open Question #3). **Decision still planner-level** but the events `schema.ts` analog is the same `BaseEventSchema.extend(...)` pattern — see `events/schema.ts` lines 41-57 for `PlaylistSyncCompletedEventSchema`.
- Invocation row: `playlistId: source.id`, **`kind: 'download'`** (after schema migration).
- Skip the URL re-validation step (Phase 2 lines 113-121) — Phase 3 has no equivalent input check on the source.

**Loop body — DIVERGES from SyncRunner — Phase 3 net-new pattern:**
```typescript
// 3. Snapshot match settings (D-11/D-16).
const settings = await this.repo.getMatchSettings();
//    settings.tolerance_seconds (default 3) and settings.parallel (default 3)

// 4. Read tracks needing work (D-07).
const tracks = await this.repo.getTracksToProcess(source.id);
//    SELECT ... WHERE source_id = ? AND state IN ('pending', 'matched')

// 5. Construct the pool.
const limit = pLimit(settings.parallel);

// 6. Lazy mkdir for source-slug dir (D-15) — once, BEFORE first task.
const sourceSlug = sourceSlug(source.name); // from ./slug
const sourceDir = path.join(process.cwd(), "data", "music", sourceSlug);
await mkdir(sourceDir, { recursive: true });

// 7. Fan out per-track work.
const results = await Promise.allSettled(
	tracks.map((track) =>
		limit(() => this.processTrack(track, source, settings, sourceDir)),
	),
);

// 8. Tally counters from the settled results.
const counters = results.reduce((acc, r) => { /* tally by terminal state */ }, INIT);

// 9. Finalize success on the invocation row (D-03: per-track failures don't fail the run).
await this.finalizeSuccess(invocationId, source, counters, startedAt);
```

**Per-track state-machine pattern (NET-NEW — codebase has no analog):**
```typescript
private async processTrack(track, source, settings, sourceDir): Promise<TrackResult> {
	const targetPath = path.join(sourceDir, safeFilename(track.artist, track.title));

	// (a) skip-if-exists (D-15 idempotent)
	try {
		await access(targetPath);
		await this.repo.markDownloaded(track.id, targetPath);
		return { state: "downloaded" };
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code !== "ENOENT") { throw err; }
		// proceed
	}

	// (b) probe — skip if already matched (MATCH-04 / D-02)
	let videoId = track.ytVideoId;
	if (track.state === "pending") {
		const probe = await this.bridge.probe(`${track.artist} ${track.title}`);
		if (probe.error) {
			await this.repo.markFailed(track.id, probe.error.type, probe.error.message);
			return { state: "failed" };
		}
		// (c) duration gate
		const deltaSeconds = Math.abs(probe.durationSeconds - track.durationMs / 1000);
		if (deltaSeconds > settings.tolerance_seconds) {
			await this.repo.markSkippedLowConfidence(
				track.id,
				`delta=${deltaSeconds}s, tolerance=${settings.tolerance_seconds}s`,
			);
			return { state: "skipped_low_confidence" };
		}
		// (d) persist match BEFORE download
		await this.repo.markMatched(track.id, probe.videoId);
		videoId = probe.videoId;
	}

	// (e) download
	const dl = await this.bridge.download(videoId, targetPath);
	if (dl.error) {
		await this.repo.markFailed(track.id, dl.error.type, dl.error.message);
		return { state: "failed" };
	}

	// (f) cover-art fetch (per-track, D-14)
	const cover = source.coverArtUrl
		? await fetchCoverArt(source.coverArtUrl)
		: null;

	// (g) tag (D-12, D-13)
	try {
		await embedTags(targetPath, {
			title: track.title,
			artist: track.artist,
			album: track.album ?? undefined, // D-13: TALB omitted when null
			coverArtBuffer: cover?.buffer,
		});
	} catch (tagErr) {
		await this.repo.markFailed(track.id, "tagger_error", tagErr.message);
		return { state: "failed" };
	}

	// (h) terminal success
	await this.repo.markDownloaded(track.id, targetPath);
	return { state: "downloaded" };
}
```

**Failure-finalize pattern** (lines 261-289) — copy structure but change error-message origin:
```typescript
private async finalizeFailure(
	invocationId: string,
	source: SourceRow,
	failureReason: FailureReason,
	errorMessage: string,
): Promise<void> {
	await this.invocationRepo.update(invocationId, {
		finishedAt: this.clock(),
		exitCode: 1,
		status: "failed",
		summary: JSON.stringify({
			failure_reason: failureReason, // snake_case in summary
			error: errorMessage,
		}),
	});

	await getEventBus().emit({
		type: "playlist.sync.failed", // OR "playlist.download.failed" if Phase 3 adds it
		payload: { ... failureReason ... },
	});
}
```
Phase 3 only finalizes the **whole invocation** as failed if the runner itself crashes (e.g. settings read fails, `getTracksToProcess` throws, `mkdir` fails). Per-track failures are NOT routed through `finalizeFailure` — they go to per-track `repo.markFailed(...)` and the invocation finalizes `success` with counters.

**Always-emit-terminal pattern (Pitfall 8)** at lines 198-217: copy verbatim. The outer `try { ... } catch (unexpected) { finalizeFailure(...) }` is the durability guarantee.

---

### `src/modules/server/downloader/DownloadRunner.test.ts` (test, fake bridge + DI)

**Analog:** `src/modules/server/scraper/SyncRunner.test.ts` (lines 1-250 of 12 tests)

**Module-level event-bus mock pattern** (lines 16-21):
```typescript
const emitSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("../events", () => ({
	getEventBus: () => ({ emit: emitSpy }),
}));
```

**Fake-bridge factory pattern** (lines 27-50):
```typescript
function fakeBridge(envelope: { tracks: ..., error: ... }) {
	return {
		fetchPlaylist: vi.fn().mockResolvedValue(envelope),
	} as unknown as import("./SpotifyScraperBridge").SpotifyScraperBridge;
}
```
Phase 3 adaptation: fake `YtDlpBridge` exposes both `probe` and `download` mocks. Each test sets up the mocks per-track.

**Fake-repo factory pattern** (lines 52-68):
```typescript
function fakeInvocationRepo(opts: { createThrows?: Error } = {}) {
	return {
		create: opts.createThrows ? vi.fn().mockRejectedValue(opts.createThrows) : vi.fn().mockResolvedValue({ id: "inv-1" }),
		update: vi.fn().mockResolvedValue({ id: "inv-1" }),
	} as unknown as import("../invocation/repository").InvocationRepository;
}
```

**SourceRow factory pattern** (lines 70-88) — copy with no changes; reuse for Phase 3.

**Test-coverage targets to mirror (DownloadRunner-specific behaviors):**
1. happy path — N tracks all succeed, invocation `status=success`, summary counters match
2. mixed result — 2 succeed, 1 duration-gated to `skipped_low_confidence`, 1 yt-dlp-crash → `failed`. Invocation still `success`. Counters: `downloaded=2, skipped_low_confidence=1, failed=1`.
3. settings snapshot — settings change mid-run (mock the repo) does NOT affect in-flight pool
4. lock-spans-handler test — verify `runningPlaylists` is still set when DownloadRunner finishes (research-recommended)
5. skip-if-exists — pre-create file, verify zero spawns and direct `markDownloaded`
6. matched-skip-search — track row state=`matched` with `ytVideoId` already set → no probe call
7. zero pending+matched rows — invocation row created, `status=success`, summary counters all zero, no spawns
8. tagger fails — track marked `failed` with `tagger_error`
9. cover-art HTTP fails — `embedTags` called with `coverArtBuffer: undefined`, NOT `failed` (D-14: silent skip)
10. runner crash — settings read throws → `finalizeFailure` called → `playlist.sync.failed` (or download.failed) emitted with `python_crash`-equivalent reason

---

### `src/modules/server/downloader/repository.ts` (repository, CRUD + settings JSON)

**Analog (track-row writes):** `src/modules/server/scraper/repository.ts` (lines 17-132)
**Analog (settings JSON):** `src/modules/server/webhooks/repository.ts` (lines 13-61)

**Class shell + DI constructor pattern** (lines 31-41):
```typescript
export class ScraperRepository {
	private readonly db: TDatabase;
	private readonly logger: AppLogger;

	constructor(
		db: TDatabase = getDb(),
		logger: AppLogger = Logger.get("ScraperRepository"),
	) {
		this.db = db;
		this.logger = logger;
	}
}
```
Phase 3 mirror: `class DownloadRepository { db, logger }` — same DI shape so tests can inject in-memory DB.

**Per-track UPDATE pattern (NEW — repository.ts has only `upsertAll`):**
```typescript
// Phase 3 net-new — no direct copy; use Drizzle's update().set().where() form
async getTracksToProcess(sourceId: string): Promise<TrackRow[]> {
	return this.db
		.select()
		.from(schema.tracks)
		.where(
			and(
				eq(schema.tracks.sourceId, sourceId),
				inArray(schema.tracks.state, ["pending", "matched"]), // D-07
			),
		);
}

async markMatched(trackId: string, videoId: string): Promise<void> {
	await this.db
		.update(schema.tracks)
		.set({ state: "matched", ytVideoId: videoId, updatedAt: new Date() })
		.where(eq(schema.tracks.id, trackId));
}

async markDownloaded(trackId: string, downloadPath: string): Promise<void> {
	await this.db
		.update(schema.tracks)
		.set({ state: "downloaded", downloadPath, updatedAt: new Date() })
		.where(eq(schema.tracks.id, trackId));
}

async markFailed(trackId: string, errorType: string, message: string): Promise<void> {
	const tail = message.slice(0, 500); // mirror STDERR_SLICE_LIMIT
	await this.db
		.update(schema.tracks)
		.set({
			state: "failed",
			failureReason: `${errorType}: ${tail}`,
			updatedAt: new Date(),
		})
		.where(eq(schema.tracks.id, trackId));
}

async markSkippedLowConfidence(trackId: string, reason: string): Promise<void> { /* same shape */ }
```

**Settings GET/UPSERT pattern from `webhooks/repository.ts:13-61`:**
```typescript
import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";

export const WebhookRepository = {
	async getSettings(): Promise<WebhookSettings> {
		const db = getDb();
		const [row] = await db
			.select()
			.from(schema.globalSettings)
			.where(eq(schema.globalSettings.key, WEBHOOK_SETTINGS_KEY));

		if (!row) {
			return DEFAULT_WEBHOOK_SETTINGS;
		}

		try {
			const parsed = JSON.parse(row.value);
			return WebhookSettingsSchema.parse(parsed);
		} catch {
			return DEFAULT_WEBHOOK_SETTINGS;
		}
	},

	async saveSettings(settings: WebhookSettings): Promise<WebhookSettings> {
		const db = getDb();
		const validated = WebhookSettingsSchema.parse(settings);
		const value = JSON.stringify(validated);

		await db
			.insert(schema.globalSettings)
			.values({ key: WEBHOOK_SETTINGS_KEY, value, updatedAt: new Date() })
			.onConflictDoUpdate({
				target: schema.globalSettings.key,
				set: { value, updatedAt: sql`(unixepoch())` },
			});

		return validated;
	},
};
```
**Phase 3 mirror exactly** — `getMatchSettings()` + `saveMatchSettings()`. Defaults via `MatchSettingsSchema.parse({})` — see `MatchSettingsSchema` definition under `downloader/schema.ts` plan (Pattern 4 in RESEARCH).

**Note on style:** `ScraperRepository` is a CLASS (DI-friendly), `WebhookRepository` is an OBJECT LITERAL (stateless helper). Phase 3 should use **CLASS** form to match the bridge/runner DI pattern — but exposing settings methods on the same class is fine (both shapes coexist per CONVENTIONS.md).

---

### `src/modules/server/downloader/repository.test.ts` (test, Drizzle in-memory)

**Analog:** `src/modules/server/scraper/repository.test.ts` (lines 1-272)

**W-5 in-memory DB setup (lines 18-32) — COPY VERBATIM:**
```typescript
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "../db/schema";

function createTestDb() {
	const sqlite = new Database(":memory:");
	const migrationDir = path.resolve("drizzle");
	const latestMigration = fs
		.readdirSync(migrationDir)
		.filter((f) => f.endsWith(".sql"))
		.sort()
		.pop()!;
	const migrationSql = fs
		.readFileSync(path.join(migrationDir, latestMigration), "utf8")
		.replace(/--> statement-breakpoint/g, "");
	sqlite.exec(migrationSql);
	return drizzle(sqlite, { schema });
}
```
**W-5 contract:** never hand-write `CREATE TABLE` in tests. Always read the latest migration. After Phase 3's migration generates, this same pattern picks it up automatically.

**Source + track seeding helpers** (lines 38-65) — copy with addition of `state` setup helpers:
```typescript
async function seedSource(db, id = "src-1") { /* lines 57-64 */ }

// Phase 3 NEW: seed tracks at specific states for state-transition tests
async function seedTrack(db, overrides = {}) {
	await db.insert(schema.tracks).values({
		id: "trk-1",
		sourceId: "src-1",
		spotifyTrackId: "stid-1",
		title: "T",
		artist: "A",
		durationMs: 180_000,
		position: 0,
		state: "pending",
		...overrides,
	});
}
```

**Test coverage targets:**
1. `getTracksToProcess` returns only `pending` + `matched` rows for given sourceId
2. `getTracksToProcess` excludes `downloaded`, `failed`, `skipped_low_confidence` (D-07)
3. `markMatched` writes state + ytVideoId; preserves other fields
4. `markDownloaded` writes state + downloadPath
5. `markFailed` truncates message to 500 chars and prefixes error type
6. `markSkippedLowConfidence` writes state + failure_reason; downloadPath stays null
7. `getMatchSettings` returns defaults when no row exists
8. `getMatchSettings` returns parsed JSON when row exists
9. `getMatchSettings` returns defaults on JSON.parse failure (graceful)
10. `saveMatchSettings` upserts (insert then update on second call)

---

### `src/modules/server/downloader/tagger.ts` (utility, file-I/O — no class)

**Analog (shape only — node-id3 has no prior consumer):** `src/modules/server/webhooks/service.ts` (lines 35-65, 70-138 — top-level functions, no class)

**Module shape (top-level functions, NOT a class):**
```typescript
// Pattern from webhooks/service.ts: top-level helpers + one default-exported function
import NodeID3 from "node-id3"; // CommonJS-style; verified to work in this repo per RESEARCH
import { Logger } from "~/logger";

const logger = Logger.get("Tagger");

export interface TagInput {
	title: string;
	artist: string;
	album?: string; // D-13: TALB frame omitted when undefined
	coverArtBuffer?: Buffer; // D-14: APIC frame omitted when undefined
}

export async function embedTags(filepath: string, input: TagInput): Promise<void> {
	const tags: NodeID3.Tags = {
		title: input.title,
		artist: input.artist,
	};
	if (input.album !== undefined && input.album !== "") {
		tags.album = input.album;
	}
	if (input.coverArtBuffer !== undefined) {
		tags.image = {
			mime: "image/jpeg",
			type: { id: 3, name: "front cover" },
			description: "",
			imageBuffer: input.coverArtBuffer,
		};
	}
	const result = NodeID3.write(tags, filepath);
	if (result !== true) {
		// node-id3 returns Error on failure (per its API)
		throw result instanceof Error ? result : new Error("node-id3 write failed");
	}
}
```

**Logging pattern (mirror webhooks/service.ts:73 lines):**
```typescript
const logger: AppLogger = Logger.get("Tagger");
logger.debug({ filepath, hasAlbum: !!input.album, hasCover: !!input.coverArtBuffer }, "Embedding ID3 tags");
```

---

### `src/modules/server/downloader/tagger.test.ts` (test, fixture-driven)

**Analog (closest):** `src/modules/server/webhooks/service.test.ts` exists in the repo with function-export tests; for fs-fixture mocking specifically, no perfect analog exists.

**Pattern:** copy a real fixture MP3 (~50KB seed file) into `src/modules/server/downloader/fixtures/silence.mp3`, then in each test:
```typescript
import { copyFile, unlink, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import NodeID3 from "node-id3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { embedTags } from "./tagger";

const FIXTURE = path.join(__dirname, "fixtures", "silence.mp3");

describe("embedTags", () => {
	let testFile: string;

	beforeEach(async () => {
		testFile = path.join(tmpdir(), `tagger-test-${Date.now()}.mp3`);
		await copyFile(FIXTURE, testFile);
	});

	afterEach(async () => {
		await unlink(testFile).catch(() => {}); // ignore ENOENT
	});

	it("writes title and artist frames", async () => {
		await embedTags(testFile, { title: "Foo", artist: "Bar" });
		const read = NodeID3.read(testFile);
		expect(read.title).toBe("Foo");
		expect(read.artist).toBe("Bar");
	});

	it("omits TALB when album is undefined (D-13)", async () => {
		await embedTags(testFile, { title: "T", artist: "A" });
		const read = NodeID3.read(testFile);
		expect(read.album).toBeUndefined();
	});

	it("embeds APIC when coverArtBuffer is provided (D-14)", async () => { /* ... */ });
	it("skips APIC silently when coverArtBuffer is undefined", async () => { /* ... */ });
	it("throws when filepath is unwritable", async () => { /* ... */ });
});
```

---

### `src/modules/server/downloader/cover-art.ts` (utility, HTTP fetch)

**Analog:** `src/modules/server/webhooks/service.ts:70-138` (`sendDiscordWebhook` — global `fetch` + retry/error pattern)

**Pattern:**
```typescript
import { Logger } from "~/logger";

const logger = Logger.get("CoverArtFetcher");
const FETCH_TIMEOUT_MS = 10_000;

export interface CoverArt {
	buffer: Buffer;
	mime: string;
}

export async function fetchCoverArt(url: string): Promise<CoverArt | null> {
	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});
		if (!response.ok) {
			logger.warn({ url, status: response.status }, "Cover art fetch returned non-OK; skipping");
			return null;
		}
		const arrayBuffer = await response.arrayBuffer();
		const mime = response.headers.get("content-type") ?? "image/jpeg";
		return { buffer: Buffer.from(arrayBuffer), mime };
	} catch (err) {
		// D-14: skip silently on any failure — no APIC, no failure on track
		logger.warn({ url, err }, "Cover art fetch failed; skipping APIC frame");
		return null;
	}
}
```
**Note:** `webhooks/service.ts` does retry on 5xx; cover-art does NOT retry (D-14: skip silently). Use the simpler one-shot variant.

---

### `src/modules/server/downloader/slug.ts` (utility, pure helpers)

**Analog:** none in repo (no existing slug helper).

**Pattern:** keep as a pure module — no class, no I/O, no logger. Sample shape:
```typescript
import slugify from "slugify";

const FS_UNSAFE_CHARS = /[/\\:*?"<>|]/g;

export function sourceSlug(name: string): string {
	return slugify(name, { lower: true, strict: true, trim: true });
}

export function safeFilename(artist: string, title: string): string {
	const sanitize = (s: string) => s.replace(FS_UNSAFE_CHARS, "").trim();
	return `${sanitize(artist)} - ${sanitize(title)}.mp3`;
}
```

**Test shape:** straight-line pure-function tests; no DB, no fs. Only test file in `downloader/` that doesn't need fixtures or fakes.

---

### `src/modules/server/downloader/handler.ts` (handler, event subscriber)

**Analog:** `src/modules/server/webhooks/handler.ts` (lines 19-84, `registerDiscordWebhookHandler`)

**Imports + signature pattern** (lines 1-22):
```typescript
import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getEventBus } from "../events";
import type { PlaylistSyncCompletedEvent } from "../events/schema";
// ... feature imports ...

export function registerDiscordWebhookHandler(
	logger: AppLogger = Logger.get("DiscordWebhook"),
): () => void {
	const bus = getEventBus();
	// ... subscriptions ...
}
```

**Subscription + unsubscribe-fn pattern** (lines 49-74):
```typescript
const unsubscribeCompleted = bus.on(
	"playlist.sync.completed",
	async (event: PlaylistSyncCompletedEvent) => {
		await handleEvent(...);
	},
);

logger.info("Discord webhook handler registered");

return () => {
	unsubscribeCompleted();
	// ... others ...
	logger.info("Discord webhook handler unregistered");
};
```

**Phase 3 mirror:**
```typescript
import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getDb } from "../db";
import { sources } from "../db/schema";
import { eq } from "drizzle-orm";
import { getEventBus } from "../events";
import type { PlaylistSyncCompletedEvent } from "../events/schema";
import { DownloadRunner } from "./DownloadRunner";

export function registerDownloadHandler(
	logger: AppLogger = Logger.get("DownloadHandler"),
): () => void {
	const bus = getEventBus();
	const runner = new DownloadRunner();

	const unsubscribeCompleted = bus.on(
		"playlist.sync.completed",
		async (event: PlaylistSyncCompletedEvent) => {
			try {
				const [source] = await getDb()
					.select()
					.from(sources)
					.where(eq(sources.id, event.payload.playlistId));
				if (!source) {
					logger.warn({ sourceId: event.payload.playlistId }, "Source not found — skipping download");
					return;
				}
				await runner.run(source);
			} catch (err) {
				// D-03: per-track failures are isolated; runner-level crashes are logged here
				logger.error({ err, sourceId: event.payload.playlistId }, "DownloadRunner crashed");
			}
		},
	);

	logger.info("Download handler registered");
	return () => {
		unsubscribeCompleted();
		logger.info("Download handler unregistered");
	};
}
```

**LOCK-SPAN GUARANTEE (D-06):** EventBus.emit `await Promise.allSettled(promises)` (verified at `EventBus.ts:177`). As long as `bus.on(...)` registers an async handler that returns a Promise (not fire-and-forget), `eventBus.emit("playlist.sync.completed", ...)` inside `SyncRunner.finalizeSuccess` already awaits this handler. Since `executePlaylistSync` already `await`s `syncRunner.run`, the lock automatically spans both runners. **No PlaylistScheduler code change needed** — research finding.

---

### `src/modules/server/downloader/integration.test.ts` (test, gated)

**Analog:** `src/modules/server/scraper/integration.test.ts` (entire file — 79 lines)

**Gate pattern (lines 28-29) — COPY VERBATIM, only change env var name:**
```typescript
const gated = process.env.SCRAPER_INTEGRATION === "1";
const d = gated ? describe : describe.skip;

d("SpotifyScraperBridge (gated — real Python subprocess)", () => { ... });
```
Phase 3:
```typescript
const gated = process.env.DOWNLOADER_INTEGRATION === "1";
const d = gated ? describe : describe.skip;

d("YtDlpBridge + tagger (gated — real yt-dlp + ffmpeg subprocess)", () => { ... });
```

**Header comment block (lines 1-18) — copy structure:**
```typescript
/**
 * Phase 3 integration test — real yt-dlp + ffmpeg subprocesses.
 *
 * GATED on DOWNLOADER_INTEGRATION=1. Requires yt-dlp + ffmpeg installed and
 * on PATH (or YT_DLP_BIN env override) — guaranteed inside the Docker dev
 * container after Phase 3's Dockerfile additions.
 *
 * Run locally:
 *   pnpm docker:dev  # in another shell
 *   docker exec -it <dev-container> sh -c "DOWNLOADER_INTEGRATION=1 pnpm test -- integration"
 *
 * Fail modes handled: network/YouTube unavailability is tolerated (test logs +
 * skips shape asserts); the test asserts contract correctness WHEN the live
 * fetch succeeds.
 */
```

**Tolerant-network branch (lines 38-45):**
```typescript
if (envelope.error?.type === "network_error") {
	console.warn("[integration] network_error — YouTube may be unreachable; skipping shape asserts", envelope.error.message.slice(0, 200));
	return;
}
```

**Timeout pattern** (line 65: `60_000`): bump to `120_000` for full download (yt-dlp + ffmpeg can take 60s+ on a real audio extract).

**Test coverage:**
1. probe known-good YouTube ID returns `{ videoId, durationSeconds }` with realistic values
2. probe deliberately-unmatchable query returns `no_results` typed envelope
3. download known-good short video → file exists at expected path, MP3 size > 0
4. embedTags after download → `NodeID3.read(file).title === "..."` round-trips
5. (optional) full DownloadRunner.run on a single seed source with one track — end-to-end smoke

---

### `src/modules/server/downloader/schema.ts` (schema, Zod + W-1)

**Analog:** `src/modules/server/scraper/schema.ts` (entire file — 67 lines)

**W-1 shared-constant pattern (lines 5-15) — COPY STRUCTURE EXACTLY:**
```typescript
/**
 * Shared prefix for synthesized python_crash envelope messages.
 *
 * W-1 (plan-checker review): bridge (this plan) and SyncRunner (Plan 04)
 * MUST import this constant rather than hand-duplicating the literal
 * string. Single source of truth — renaming it here forces the compiler
 * to flag every consumer.
 *
 * The bridge writes: `{PYTHON_CRASH_PREFIX} exit=N signal=... stderr=...`.
 * SyncRunner detects via `envelope.error.message.startsWith(PYTHON_CRASH_PREFIX)`.
 */
export const PYTHON_CRASH_PREFIX = "python crash:";
```

**Phase 3 W-1 constants:**
```typescript
/**
 * Shared prefix for synthesized yt-dlp crash envelope messages.
 *
 * W-1: YtDlpBridge writes this prefix; DownloadRunner detects via
 * `.startsWith(YTDLP_CRASH_PREFIX)` and reclassifies to `ytdlp_crash`.
 */
export const YTDLP_CRASH_PREFIX = "yt-dlp crash:";

/**
 * Shared marker for empty-stdout-exit-0 case (zero search results).
 * yt-dlp does NOT exit non-zero on `ytsearch1:` returning zero hits
 * (research Pitfall 1). The bridge writes a typed `no_results` envelope
 * directly — no marker string parsing needed for this branch — but the
 * constant is exported for tests asserting the W-1 contract.
 */
export const YTDLP_NO_RESULTS_MARKER = "yt-dlp no_results";
```

**Error enum pattern (lines 25-29) — copy with Phase 3 enum values:**
```typescript
// Phase 2:
export const PythonErrorSchema = z.object({
	type: z.enum(["invalid_url", "not_found", "parse_error", "network_error"]),
	message: z.string(),
});

// Phase 3:
export const YtDlpErrorSchema = z.object({
	type: z.enum([
		"no_results",       // empty stdout + exit 0
		"network_error",    // DNS, connection
		"download_error",   // yt-dlp non-zero exit during download (e.g. 403)
		"ffmpeg_error",     // ffmpeg post-processor failure
		"ytdlp_crash",      // unexpected non-zero exit / unparseable output
		"tagger_error",     // node-id3 write failure (DownloadRunner-side, not bridge)
	]),
	message: z.string(),
});
```

**Envelope schema pattern (lines 45-52) — copy structure:**
```typescript
export const PythonEnvelopeSchema = z.object({
	tracks: z.array(PythonTrackSchema).nullable(),
	cover_art_url: z.string().min(1).nullable(),
	error: PythonErrorSchema.nullable(),
});
export type PythonEnvelope = z.infer<typeof PythonEnvelopeSchema>;
```

**Phase 3 envelopes (probe + download):**
```typescript
export const YtDlpProbeEnvelopeSchema = z.object({
	videoId: z.string().min(1).nullable(),
	durationSeconds: z.number().int().nonnegative().nullable(),
	error: YtDlpErrorSchema.nullable(),
});
export type YtDlpProbeEnvelope = z.infer<typeof YtDlpProbeEnvelopeSchema>;

export const YtDlpDownloadEnvelopeSchema = z.object({
	error: YtDlpErrorSchema.nullable(), // null on success; download has no other return data
});
export type YtDlpDownloadEnvelope = z.infer<typeof YtDlpDownloadEnvelopeSchema>;
```

**MatchSettings schema (Phase 3 net-new — pattern from RESEARCH.md Pattern 4):**
```typescript
export const MATCH_SETTINGS_KEY = "match" as const;

export const MatchSettingsSchema = z.object({
	tolerance_seconds: z.number().int().min(0).max(60).default(3),
	parallel: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});
export type MatchSettings = z.infer<typeof MatchSettingsSchema>;

export const DEFAULT_MATCH_SETTINGS: MatchSettings = MatchSettingsSchema.parse({});
```

---

### `src/modules/server/downloader/index.ts` (barrel)

**Analog:** `src/modules/server/scraper/index.ts` (lines 1-4):
```typescript
export * from "./schema";
export * from "./SpotifyScraperBridge";
export * from "./repository";
export * from "./SyncRunner";
```

**Phase 3 mirror:**
```typescript
export * from "./schema";
export * from "./YtDlpBridge";
export * from "./repository";
export * from "./DownloadRunner";
export * from "./tagger";
export * from "./cover-art";
export * from "./slug";
export * from "./handler";
```

---

### `src/modules/server/db/schema.ts` (model, MOD — extend only)

**Analog:** self (existing file — Phase 1 lock).

**Existing tracks table** (lines 60-98) — extend with one new column:
```typescript
// CURRENT (Phase 1):
export const tracks = sqliteTable("tracks", {
	id: text("id").primaryKey().notNull(),
	sourceId: text("source_id").notNull().references(() => sources.id, { onDelete: "cascade" }),
	spotifyTrackId: text("spotify_track_id").notNull(),
	title: text("title").notNull(),
	artist: text("artist").notNull(),
	durationMs: integer("duration_ms").notNull(),
	state: text("state", { enum: ["pending", "matched", "downloaded", "skipped_low_confidence", "failed"] }).default("pending").notNull(),
	ytVideoId: text("yt_video_id"),
	downloadPath: text("download_path"),
	failureReason: text("failure_reason"),
	position: integer("position").notNull(),
	createdAt: ..., updatedAt: ...,
}, (t) => [
	unique("tracks_source_spotify_unique").on(t.sourceId, t.spotifyTrackId),
	index("tracks_source_id_idx").on(t.sourceId),
	index("tracks_state_idx").on(t.state),
]);

// PHASE 3 ADDITION (D-13):
album: text("album"), // NULLABLE — TALB frame omitted when null (Phase 3) or filled by Phase 4 album sources
```

**DO NOT TOUCH** (Phase 1 D-09 + D-10 lock):
- `state` enum
- `tracks_source_spotify_unique` unique key

**Existing invocations table** (lines 109-125) — extend with `kind` column:
```typescript
// PHASE 3 ADDITION (D-05):
kind: text("kind", { enum: ["scrape", "download"] }).default("scrape").notNull(),
```
Default `'scrape'` so existing Phase 2 rows (after migration) keep their meaning. New Phase 3 download rows are written with `kind: 'download'`.

**Migration pattern:** `pnpm db:generate` → produces `drizzle/0003_*.sql` — never hand-edit (CONVENTIONS.md: "drizzle/ — Generated: Yes; Rule: Never hand-edit").

---

### `src/modules/server/events/schema.ts` (event-schema, MOD)

**Analog:** `PlaylistSyncCompletedEventSchema` definition in same file (lines 41-57).

**Pattern to copy:**
```typescript
export const PlaylistSyncCompletedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.completed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		duration: z.number().positive(),
		exitCode: z.number(),
		summary: z.string().optional(),
		// Phase 2 D-10/D-11: surfaces when spotifyscraper's 100-track cap was hit.
		truncationSuspected: z.boolean().optional(),
		// Phase 2: informational count for webhook formatting.
		trackCount: z.number().int().nonnegative().optional(),
	}),
});
```

**Phase 3 addition (recommended per RESEARCH Open Question #3):**
```typescript
export const PlaylistDownloadCompletedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.download.completed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		duration: z.number().positive(),
		// Phase 3 D-03: per-track counters
		total: z.number().int().nonnegative(),
		downloaded: z.number().int().nonnegative(),
		matchedOnly: z.number().int().nonnegative(),
		skippedLowConfidence: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
	}),
});
export type PlaylistDownloadCompletedEvent = z.infer<typeof PlaylistDownloadCompletedEventSchema>;
```

**Add to discriminated union** (lines 137-146):
```typescript
export const EventSchema = z.discriminatedUnion("type", [
	PlaylistSyncStartedEventSchema,
	PlaylistSyncCompletedEventSchema,
	PlaylistSyncFailedEventSchema,
	PlaylistSyncCanceledEventSchema,
	PlaylistCreatedEventSchema,
	PlaylistUpdatedEventSchema,
	PlaylistDeletedEventSchema,
	SchedulerReloadEventSchema,
	PlaylistDownloadCompletedEventSchema, // ← Phase 3
]);
```

---

### `server/plugins/events.ts` (plugin, MOD — append one registration)

**Analog:** self (existing file, lines 19-80).

**Existing handler-registration pattern** (lines 30-56):
```typescript
// Existing — Discord webhook
registerDiscordWebhookHandler(eventHandlerLogger);
pluginLogger.info("Discord webhook handler registered");
```

**Phase 3 addition — APPEND one block:**
```typescript
import { registerDownloadHandler } from "../../src/modules/server/downloader";

// ... inside default export, after existing handlers ...
registerDownloadHandler(Logger.get("DownloadHandler"));
pluginLogger.info("Download handler registered");
```

---

### `src/modules/server/scheduler/PlaylistScheduler.ts` (MOD — verify only)

**Analog:** self (existing file, lines 84-106).

**Research finding (RESEARCH.md "Component Responsibilities" line):**
> "No code change should be needed in scheduler — just verify the chain. Plan should add a focused unit test for 'lock held across handler chain.'"

**Existing lock pattern** (lines 84-106) — already does the right thing:
```typescript
private async executePlaylistSync(source: SourceRow): Promise<void> {
	if (this.runningPlaylists.has(source.id)) { /* skip */ return; }
	this.runningPlaylists.add(source.id);
	try {
		await this.syncRunner.run(source);
	} catch (err) { /* log */ }
	finally {
		this.runningPlaylists.delete(source.id);
	}
}
```

`syncRunner.run(source)` calls `eventBus.emit("playlist.sync.completed", ...)` which awaits all handlers via `Promise.allSettled` (`EventBus.ts:177`). Since `registerDownloadHandler` registers an **async** handler that `await`s `runner.run(source)`, the await chain is:

```
executePlaylistSync.await (runningPlaylists held)
  → syncRunner.run.await
    → eventBus.emit("playlist.sync.completed").await
      → Promise.allSettled([downloadHandler(event), ...other handlers])
        → downloadHandler.await
          → DownloadRunner.run.await  (full match+download)
        ↩
      ↩
    ↩
  ↩
↩ (now finally{} releases runningPlaylists.delete)
```

**Plan adds one test** asserting `scheduler.isRunning(sourceId)` returns `true` while a slow `DownloadRunner` is mid-pool, and `false` after.

---

### `src/modules/server/invocation/repository.ts` (MOD — extend `kind`-aware)

**Analog:** self (existing file).

**Existing `create` pattern** (lines 40-47) — no body change needed:
```typescript
async create(data: NewInvocationRow) {
	const [row] = await this.db
		.insert(schema.invocations)
		.values(data)
		.returning();
	return row;
}
```

**Phase 3 effect:** `NewInvocationRow` (inferred type via `typeof schema.invocations.$inferInsert`) automatically gains the `kind` field after `db/schema.ts` adds the column. Callers (`SyncRunner` writes `kind: 'scrape'`, new `DownloadRunner` writes `kind: 'download'`).

**Optional new query method** (planner discretion — Phase 5 may extend, but the column is index-friendly):
```typescript
async listByKind(playlistId: string, kind: 'scrape' | 'download') {
	return this.db
		.select()
		.from(schema.invocations)
		.where(and(
			eq(schema.invocations.playlistId, playlistId),
			eq(schema.invocations.kind, kind),
		))
		.orderBy(desc(schema.invocations.startedAt));
}
```

---

### `src/modules/server/db/seed.ts` (MOD — add default match settings row)

**Analog (settings upsert):** `src/modules/server/webhooks/repository.ts:39-60`.

**Pattern:**
```typescript
// Phase 3 addition to seed.ts main():
import { globalSettings } from "./schema";

const defaultMatchSettings = JSON.stringify({
	tolerance_seconds: 3,
	parallel: 3,
});

db.insert(globalSettings)
	.values({
		key: "match",
		value: defaultMatchSettings,
		updatedAt: now,
	})
	.onConflictDoNothing({ target: globalSettings.key })
	.run();

console.log("Default match settings seeded.");
```

Use `onConflictDoNothing` (not `DoUpdate`) so re-running seed doesn't clobber a user's tuned values.

---

### `Dockerfile` + `Dockerfile.dev` (MOD — extend existing pip layer)

**Analog:** self (existing Phase 2 layer).

**Existing pattern in Dockerfile.dev (lines 22-25):**
```dockerfile
COPY scraper ./scraper
RUN python3 -m venv /app/scraper/.venv \
    && /app/scraper/.venv/bin/pip install --no-cache-dir -r /app/scraper/requirements.txt
```

**Phase 3 strategy (per RESEARCH Standard Stack section, recommended approach):**
1. Add `yt-dlp==2026.3.17` to `scraper/requirements.txt`
2. The existing pip line already installs from the requirements file — no Dockerfile change needed if requirements.txt is updated
3. Verify `ffmpeg` is in apt list (already line 5 of both Dockerfiles — yes)
4. Optionally set `ENV YT_DLP_BIN=/app/scraper/.venv/bin/yt-dlp` for explicit path resolution

**ENV var addition (mirror PYTHON_BIN pattern in src/env.ts:14):**
```typescript
// src/env.ts addition:
YT_DLP_BIN: z.string().min(1).optional(),
```

---

### `package.json` (MOD — three new deps)

**Pattern:** standard `pnpm add` — no analog needed.
- `node-id3@0.2.9`
- `p-limit@7.3.0`
- `slugify@1.6.9`

All three are ESM-friendly and confirmed compatible with the repo's `"type": "module"` setting (RESEARCH).

---

## Shared Patterns (cross-cutting)

### Logger Namespacing
**Source:** `src/logger.ts` + every server class
**Apply to:** All new server-side files in `downloader/`
**Pattern (from `SpotifyScraperBridge.ts:52`):**
```typescript
this.logger = logger ?? Logger.get("SpotifyScraperBridge"); // class file
// OR
const logger = Logger.get("Tagger"); // module-scope logger
```
Phase 3 namespaces (per CONTEXT D-discretion list):
- `Logger.get("YtDlpBridge")` — bridge class
- `Logger.get("DownloadRunner")` — runner class
- `Logger.get("DownloadRepository")` — repo class
- `Logger.get("DownloadHandler")` — event handler
- `Logger.get("Tagger")` — module-scope (no class)
- `Logger.get("CoverArtFetcher")` — module-scope (no class)

**Rule (from CONVENTIONS.md):** structured data first, message second:
```typescript
logger.warn({ url, status: response.status }, "Cover art fetch returned non-OK; skipping");
```

### W-1 Shared-Constant Convention
**Source:** `src/modules/server/scraper/schema.ts:5-15` (`PYTHON_CRASH_PREFIX`)
**Apply to:** All bridge ↔ runner string-marker boundaries in `downloader/`
**Pattern:**
1. Define the constant in `schema.ts` only (single source of truth)
2. Bridge imports + writes it
3. Runner imports + detects via `.startsWith`
4. Test asserts `import` from `./schema`, never literal duplication

Phase 3 constants:
- `YTDLP_CRASH_PREFIX = "yt-dlp crash:"` — bridge synthesizes on unparseable yt-dlp output
- `YTDLP_NO_RESULTS_MARKER = "yt-dlp no_results"` — optional; bridge writes typed `no_results` envelope directly so runner-side `.startsWith` not strictly required

### Error Handling — Unknown Narrowing
**Source:** `src/modules/server/scraper/SyncRunner.ts:209-211` + CONVENTIONS.md "Error Handling"
**Apply to:** All new catch blocks in `downloader/`
**Pattern:**
```typescript
} catch (err) {
	const message = err instanceof Error ? err.message : String(err);
	// ...
}
```
For ENOENT (skip-if-exists check):
```typescript
} catch (err) {
	if ((err as NodeJS.ErrnoException).code === "ENOENT") {
		// proceed with download
	} else {
		throw err; // unexpected fs error
	}
}
```

### Always-Emit-Terminal-Event (Pitfall 8)
**Source:** `src/modules/server/scraper/SyncRunner.ts:198-218`
**Apply to:** `DownloadRunner.run` outer try/catch
**Pattern:**
```typescript
async run(source: SourceRow): Promise<void> {
	try {
		// ... happy path ending in finalizeSuccess
	} catch (unexpected) {
		this.logger.error({ err: unexpected, sourceId: source.id }, "DownloadRunner: unexpected crash");
		try {
			await this.finalizeFailure(invocationId, source, "ytdlp_crash", err.message);
		} catch (terminalErr) {
			this.logger.error({ err: terminalErr }, "DownloadRunner: failed to emit terminal event");
		}
	}
}
```

### W-5 Test-Migration Convention
**Source:** `src/modules/server/scraper/repository.test.ts:18-32`
**Apply to:** All Drizzle in-memory tests (`repository.test.ts`)
**Rule:** Read `drizzle/<latest>.sql` and exec into `:memory:`. Never hand-write `CREATE TABLE`. Migration auto-generation owns the schema.

### CONVENTIONS.md Tooling Constraints (apply globally)
- Tabs not spaces (`biome.jsonc` formatter)
- Double quotes only
- `import type { ... }` for type-only imports (`verbatimModuleSyntax`)
- File names: `PascalCase.ts` for class-mapped files (`YtDlpBridge.ts`, `DownloadRunner.ts`); `kebab-case.ts` (or `lowercase.ts`) for utilities (`tagger.ts`, `cover-art.ts`, `slug.ts`, `handler.ts`, `repository.ts`, `schema.ts`, `index.ts`)
- Path alias: `~/` for `./src/*`; relative imports inside the same feature folder
- Logger via `Logger.get("ModuleName")` — never the bare singleton

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `src/modules/server/downloader/tagger.ts` | utility | file-I/O (ID3 frames) | No prior `node-id3` consumer in repo. Module **shape** (top-level exported async function with logger) borrowed from `webhooks/service.ts` lines 70-138, but the API surface is unique. Planner should base implementation on RESEARCH §"node-id3" + Context7 docs verified there. |
| `src/modules/server/downloader/slug.ts` | utility | transform | No prior slug helper. Module shape is a fresh pure-fn module. RESEARCH §"Don't Hand-Roll" recommends `slugify@1.6.9` + thin regex wrapper. |
| `src/modules/server/downloader/cover-art.ts` | utility | request-response | Closest is `webhooks/service.ts:70-138` (`sendDiscordWebhook`) — but that file does retry/backoff, while D-14 says skip silently on any fetch failure. Planner should adapt to the simpler one-shot variant shown above. |

---

## Metadata

**Analog search scope:**
- `/Users/maksymilianzadka/repos/spotdl-manager/src/modules/server/scraper/` (Phase 2 — primary mirror)
- `/Users/maksymilianzadka/repos/spotdl-manager/src/modules/server/webhooks/` (event-handler + settings-JSON patterns)
- `/Users/maksymilianzadka/repos/spotdl-manager/src/modules/server/events/` (EventBus + handlers + schema discriminated union)
- `/Users/maksymilianzadka/repos/spotdl-manager/src/modules/server/invocation/` (InvocationRepository class shape)
- `/Users/maksymilianzadka/repos/spotdl-manager/src/modules/server/scheduler/` (PlaylistScheduler lock semantics)
- `/Users/maksymilianzadka/repos/spotdl-manager/src/modules/server/db/` (schema, seed)
- `/Users/maksymilianzadka/repos/spotdl-manager/server/plugins/` (Nitro plugin registration)

**Files read for pattern extraction:**
- `src/modules/server/scraper/SpotifyScraperBridge.ts` (137 lines, full)
- `src/modules/server/scraper/SyncRunner.ts` (290 lines, full)
- `src/modules/server/scraper/repository.ts` (132 lines, full)
- `src/modules/server/scraper/schema.ts` (67 lines, full)
- `src/modules/server/scraper/SpotifyScraperBridge.test.ts` (396 lines, full)
- `src/modules/server/scraper/SyncRunner.test.ts` (lines 1-250 — first 12 tests)
- `src/modules/server/scraper/repository.test.ts` (272 lines, full)
- `src/modules/server/scraper/integration.test.ts` (79 lines, full)
- `src/modules/server/scraper/index.ts` (4 lines, full)
- `src/modules/server/events/schema.ts` (181 lines, full)
- `src/modules/server/events/handlers.ts` (250 lines, full)
- `src/modules/server/events/EventBus.ts` (lines 160-220 — emit semantics)
- `src/modules/server/webhooks/handler.ts` (84 lines, full)
- `src/modules/server/webhooks/service.ts` (143 lines, full)
- `src/modules/server/webhooks/repository.ts` (62 lines, full)
- `src/modules/server/webhooks/schema.ts` (36 lines, full)
- `src/modules/server/invocation/repository.ts` (264 lines, full)
- `src/modules/server/scheduler/PlaylistScheduler.ts` (292 lines, full)
- `src/modules/server/db/schema.ts` (143 lines, full)
- `src/modules/server/db/seed.ts` (135 lines, full)
- `src/env.ts` (47 lines, full)
- `server/plugins/events.ts` (80 lines, full)
- `Dockerfile` + `Dockerfile.dev` (first 50 lines each)

**Pattern extraction date:** 2026-04-25
