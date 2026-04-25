/**
 * YtDlpBridge mocked-spawn unit tests.
 *
 * Mirrors src/modules/server/scraper/SpotifyScraperBridge.test.ts pattern exactly:
 *  - vi.mock("node:child_process") to intercept all spawn calls
 *  - EventEmitter-based fake child with stdout/stderr sub-emitters
 *  - tick() to flush microtask queue before emitting events
 *
 * Coverage targets (12 tests):
 *  Test  1: probe happy path (MATCH-01)
 *  Test  2: probe no_results — exit 0 + empty stdout (MATCH-01, Pitfall #1)
 *  Test  3: probe yt-dlp crash — non-zero exit (DOWNLOAD-05)
 *  Test  4: probe malformed stdout — only one line (DOWNLOAD-05)
 *  Test  5: probe stderr truncation at 500 chars (DOWNLOAD-05, T-3-03)
 *  Test  6: probe argv-form / shell:false assertion (MATCH-01, T-3-01)
 *  Test  7: probe timeout option passed to spawn
 *  Test  8: download happy path (DOWNLOAD-01)
 *  Test  9: download crash — ffmpeg-related stderr (DOWNLOAD-01, DOWNLOAD-05)
 *  Test 10: download crash — generic error (DOWNLOAD-05)
 *  Test 11: W-1 prefix contract — YTDLP_CRASH_PREFIX imported, not literal
 *  Test 12: download argv assertion (DOWNLOAD-01, T-3-01)
 */

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
}));

vi.mock("~/env", () => ({
	env: { YT_DLP_BIN: undefined },
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

import { spawn } from "node:child_process";
import { YTDLP_CRASH_PREFIX } from "./schema";
import { YtDlpBridge } from "./YtDlpBridge";

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

/**
 * Flush microtask queue so the bridge can attach listeners before we emit.
 */
async function tick(): Promise<void> {
	await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
	vi.mocked(spawn).mockReset();
});

afterEach(() => {
	vi.clearAllMocks();
});

describe("YtDlpBridge", () => {
	describe("probe()", () => {
		describe("Test 1 (MATCH-01): happy path — valid videoId + duration, exit 0", () => {
			it("returns videoId and durationSeconds when stdout has two lines and exit is 0", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({
					ytDlpBin: "yt-dlp",
					probeTimeoutMs: 30_000,
				});
				const promise = bridge.probe("Artist - Title");

				await tick();

				child.stdout.emit("data", Buffer.from("abc123\n240\n"));
				child.emit("close", 0, null);

				const result = await promise;

				expect(result.videoId).toBe("abc123");
				expect(result.durationSeconds).toBe(240);
				expect(result.error).toBeNull();
			});
		});

		describe("Test 2 (MATCH-01, Pitfall #1): no_results — exit 0 + empty stdout", () => {
			it("returns no_results error when stdout is empty and exit is 0 (yt-dlp zero-hits gotcha)", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.probe("Some Obscure Track");

				await tick();

				// Emit empty stdout — this is the Pitfall #1 case: exit 0 but no match.
				child.stdout.emit("data", Buffer.from(""));
				child.emit("close", 0, null);

				const result = await promise;

				expect(result.videoId).toBeNull();
				expect(result.durationSeconds).toBeNull();
				expect(result.error).not.toBeNull();
				expect(result.error?.type).toBe("no_results");
			});
		});

		describe("Test 3 (DOWNLOAD-05): yt-dlp crash — non-zero exit", () => {
			it("synthesizes ytdlp_crash envelope when yt-dlp exits non-zero", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.probe("Some Track");

				await tick();

				child.stderr.emit(
					"data",
					Buffer.from(
						"Traceback (most recent call last):\n  File ...\nException: something bad",
					),
				);
				child.emit("close", 1, null);

				const result = await promise;

				expect(result.videoId).toBeNull();
				expect(result.durationSeconds).toBeNull();
				expect(result.error).not.toBeNull();
				expect(result.error?.type).toBe("ytdlp_crash");
				expect(result.error?.message.startsWith(YTDLP_CRASH_PREFIX)).toBe(true);
				expect(result.error?.message).toContain("exit=1");
			});
		});

		describe("Test 4 (DOWNLOAD-05): probe malformed stdout — only one line", () => {
			it("synthesizes crash envelope when stdout has fewer than 2 lines", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.probe("Some Track");

				await tick();

				// Only one line — missing duration
				child.stdout.emit("data", Buffer.from("only-one-line"));
				child.emit("close", 0, null);

				const result = await promise;

				expect(result.videoId).toBeNull();
				expect(result.durationSeconds).toBeNull();
				expect(result.error).not.toBeNull();
				expect(result.error?.type).toBe("ytdlp_crash");
				// Message should reference unparseable output
				expect(result.error?.message).toContain("unparseable");
			});
		});

		describe("Test 5 (DOWNLOAD-05, T-3-03): stderr truncation at 500 chars", () => {
			it("truncates stderr to 500 chars in the synthesized crash envelope message", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.probe("Some Track");

				await tick();

				const longStderr = "X".repeat(2000);
				child.stderr.emit("data", Buffer.from(longStderr));
				child.emit("close", 1, null);

				const result = await promise;

				expect(result.error?.message.startsWith(YTDLP_CRASH_PREFIX)).toBe(true);
				expect(result.error?.message).toContain("exit=1");
				// The stderr slice in the message should be at most 500 chars
				const stderrPart = result.error?.message.split("stderr=")[1] ?? "";
				expect(stderrPart.length).toBeLessThanOrEqual(500);
			});
		});

		describe("Test 6 (MATCH-01, T-3-01): argv-form / shell:false assertion", () => {
			it("calls spawn with argv-form (no shell:true), stdio piped, and --skip-download in args", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.probe("Artist - Title");

				await tick();

				child.stdout.emit("data", Buffer.from("abc123\n180\n"));
				child.emit("close", 0, null);

				await promise;

				const [bin, args, opts] = vi.mocked(spawn).mock.calls[0] as [
					string,
					string[],
					Record<string, unknown>,
				];

				expect(typeof bin).toBe("string");
				expect(Array.isArray(args)).toBe(true);
				expect(args).toContain("--skip-download");
				expect(args).toContain("--print");
				// The last arg should start with "ytsearch1:"
				expect(args.some((a) => a.startsWith("ytsearch1:"))).toBe(true);
				// Security: opts.shell must NOT be true (T-3-01)
				expect(opts?.shell).not.toBe(true);
				expect(opts?.stdio).toEqual(["pipe", "pipe", "pipe"]);
			});
		});

		describe("Test 7: probe timeout option passed to spawn", () => {
			it("passes probeTimeoutMs as timeout option to spawn", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({
					ytDlpBin: "yt-dlp",
					probeTimeoutMs: 30_000,
				});
				const promise = bridge.probe("Artist - Title");

				await tick();

				child.stdout.emit("data", Buffer.from("abc123\n200\n"));
				child.emit("close", 0, null);

				await promise;

				const [, , opts] = vi.mocked(spawn).mock.calls[0] as [
					string,
					string[],
					Record<string, unknown>,
				];
				expect(opts?.timeout).toBe(30_000);
			});
		});
	});

	describe("download()", () => {
		describe("Test 8 (DOWNLOAD-01): happy path — exit 0, no stderr", () => {
			it("returns error=null when yt-dlp exits 0", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({
					ytDlpBin: "yt-dlp",
					downloadTimeoutMs: 600_000,
				});
				const promise = bridge.download("abc123", "/tmp/test.mp3");

				await tick();

				// Under -q, download stdout is empty; only stderr matters
				child.emit("close", 0, null);

				const result = await promise;

				expect(result.error).toBeNull();
			});
		});

		describe("Test 9 (DOWNLOAD-01, DOWNLOAD-05): download crash — ffmpeg-related stderr", () => {
			it("returns ffmpeg_error when stderr contains 'ffmpeg' and exit is non-zero", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.download("abc123", "/tmp/test.mp3");

				await tick();

				child.stderr.emit(
					"data",
					Buffer.from(
						"ERROR: ffmpeg was not found. Please install it to use -x\nffmpeg: No such file or directory",
					),
				);
				child.emit("close", 1, null);

				const result = await promise;

				expect(result.error).not.toBeNull();
				expect(result.error?.type).toBe("ffmpeg_error");
			});
		});

		describe("Test 10 (DOWNLOAD-05): download crash — generic non-zero exit", () => {
			it("returns download_error with exit code in message when stderr has no ffmpeg reference", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.download("abc123", "/tmp/test.mp3");

				await tick();

				child.stderr.emit(
					"data",
					Buffer.from("ERROR: HTTP Error 403: Forbidden"),
				);
				child.emit("close", 1, null);

				const result = await promise;

				expect(result.error).not.toBeNull();
				expect(result.error?.type).toBe("download_error");
				expect(result.error?.message).toContain("exit=1");
			});
		});

		describe("Test 11: W-1 prefix contract — YTDLP_CRASH_PREFIX imported, not literal", () => {
			it("verifies YTDLP_CRASH_PREFIX equals 'yt-dlp crash:' and crash messages start with imported constant", async () => {
				// Pin the constant value per W-1 contract
				expect(YTDLP_CRASH_PREFIX).toBe("yt-dlp crash:");

				// Verify Test 3's crash message uses the imported constant
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({ ytDlpBin: "yt-dlp" });
				const promise = bridge.probe("Some Track");

				await tick();
				child.emit("close", 3, null);

				const result = await promise;

				// W-1 assertion: the imported constant matches what the bridge wrote
				expect(result.error?.message.startsWith(YTDLP_CRASH_PREFIX)).toBe(true);
			});
		});

		describe("Test 12 (DOWNLOAD-01, T-3-01): download argv assertion", () => {
			it("calls spawn with correct audio download args and the YouTube URL", async () => {
				const child = makeFakeChild();
				vi.mocked(spawn).mockReturnValue(child as any);

				const bridge = new YtDlpBridge({
					ytDlpBin: "yt-dlp",
					downloadTimeoutMs: 600_000,
				});
				const videoId = "abc123";
				const outputPath = "/tmp/Artist - Title.mp3";
				const promise = bridge.download(videoId, outputPath);

				await tick();

				child.emit("close", 0, null);

				await promise;

				const [bin, args, opts] = vi.mocked(spawn).mock.calls[0] as [
					string,
					string[],
					Record<string, unknown>,
				];

				expect(typeof bin).toBe("string");
				// Argv contains required flags
				expect(args).toContain("--audio-format");
				expect(args).toContain("mp3");
				expect(args).toContain("--audio-quality");
				expect(args).toContain("0");
				expect(args).toContain("-o");
				expect(args).toContain(outputPath);
				// URL must contain the video ID
				expect(args.some((a) => a.includes(`watch?v=${videoId}`))).toBe(true);
				// Security: shell must NOT be true (T-3-01)
				expect(opts?.shell).not.toBe(true);
				expect(opts?.stdio).toEqual(["pipe", "pipe", "pipe"]);
				expect(opts?.timeout).toBe(600_000);
			});
		});
	});
});
