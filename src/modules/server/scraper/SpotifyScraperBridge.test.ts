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

import { spawn } from "node:child_process";
import { SpotifyScraperBridge } from "./SpotifyScraperBridge";
import { PYTHON_CRASH_PREFIX } from "./schema";

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

describe("SpotifyScraperBridge", () => {
	describe("Test 1: happy path — valid envelope, exit 0", () => {
		it("returns a parsed PythonEnvelope with tracks when stdout is valid JSON and exit is 0", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			const envelope = {
				tracks: [
					{
						spotify_track_id: "track1",
						title: "Song One",
						artist: "Artist A",
						duration_ms: 200_000,
						position: 0,
					},
				],
				cover_art_url: "https://i.scdn.co/image/abc",
				error: null,
			};
			child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
			child.emit("close", 0, null);

			const result = await promise;

			expect(result.tracks).toHaveLength(1);
			expect(result.tracks?.[0]?.spotify_track_id).toBe("track1");
			expect(result.error).toBeNull();
		});
	});

	describe("Test 2: handled error envelope — not_found, exit 0", () => {
		it("returns error envelope verbatim without python_crash synthesis", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			const envelope = {
				tracks: null,
				cover_art_url: null,
				error: { type: "not_found", message: "Playlist not found" },
			};
			child.stdout.emit("data", Buffer.from(JSON.stringify(envelope)));
			child.emit("close", 0, null);

			const result = await promise;

			expect(result.tracks).toBeNull();
			expect(result.error?.type).toBe("not_found");
			expect(result.error?.message).toBe("Playlist not found");
		});
	});

	describe("Test 3: stdin closes with JSON payload", () => {
		it("calls child.stdin.end with a JSON string containing the URL and source_type", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			child.stdout.emit("data", Buffer.from(JSON.stringify({ tracks: [], cover_art_url: null, error: null })));
			child.emit("close", 0, null);

			await promise;

			expect(child.stdin.end).toHaveBeenCalledTimes(1);
			const [arg] = child.stdin.end.mock.calls[0];
			const parsed = JSON.parse(arg);
			expect(parsed).toMatchObject({
				url: "https://open.spotify.com/playlist/abc123",
				source_type: "playlist",
			});
		});
	});

	describe("Test 4: parse only on close — partial data events don't resolve", () => {
		it("does not resolve the promise on mid-stream data events (waits for close)", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			let resolved = false;
			promise.then(() => { resolved = true; });

			// Emit partial JSON chunks — should NOT resolve
			const envelope = { tracks: [], cover_art_url: null, error: null };
			const json = JSON.stringify(envelope);
			child.stdout.emit("data", Buffer.from(json.slice(0, 10)));
			child.stdout.emit("data", Buffer.from(json.slice(10, 20)));

			await tick();
			expect(resolved).toBe(false);

			// Now emit close — should resolve
			child.stdout.emit("data", Buffer.from(json.slice(20)));
			child.emit("close", 0, null);

			await promise;
			resolved = true;
			expect(resolved).toBe(true);
		});
	});

	describe("Test 5: python_crash — non-zero exit, no envelope", () => {
		it("synthesizes a python_crash envelope when Python exits non-zero with no parseable stdout", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			child.stderr.emit("data", Buffer.from("Traceback (most recent call last):\n  File ...\nException: something bad"));
			child.emit("close", 2, null);

			const result = await promise;

			expect(result.tracks).toBeNull();
			expect(result.cover_art_url).toBeNull();
			expect(result.error).not.toBeNull();
			expect(result.error?.message).toContain("exit=2");
			expect(result.error?.message.startsWith(PYTHON_CRASH_PREFIX)).toBe(true);
		});
	});

	describe("Test 6: python_crash — malformed JSON on stdout, exit 0", () => {
		it("synthesizes a crash envelope when stdout is not valid JSON", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			child.stdout.emit("data", Buffer.from("not valid json"));
			child.emit("close", 0, null);

			const result = await promise;

			expect(result.tracks).toBeNull();
			expect(result.error).not.toBeNull();
			expect(result.error?.message.startsWith(PYTHON_CRASH_PREFIX)).toBe(true);
		});
	});

	describe("Test 7: stderr truncation — capped at 500 chars", () => {
		it("truncates stderr to 500 chars in the synthesized envelope message", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			const longStderr = "X".repeat(2000);
			child.stderr.emit("data", Buffer.from(longStderr));
			child.emit("close", 1, null);

			const result = await promise;

			expect(result.error?.message.startsWith(PYTHON_CRASH_PREFIX)).toBe(true);
			expect(result.error?.message).toContain("exit=1");
			// The stderr slice in the message should be at most 500 chars
			const stderrPart = result.error?.message.split("stderr=")[1] ?? "";
			expect(stderrPart.length).toBeLessThanOrEqual(500);
		});
	});

	describe("Test 8: shell: false assertion", () => {
		it("calls spawn with argv-form (no shell:true) and stdio piped", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();
			child.emit("close", 0, null);
			child.stdout.emit("data", Buffer.from(JSON.stringify({ tracks: [], cover_art_url: null, error: null })));

			await promise.catch(() => {}); // May or may not fail — we just want the spawn call

			const [bin, args, opts] = vi.mocked(spawn).mock.calls[0] as [string, string[], Record<string, unknown>];
			expect(typeof bin).toBe("string");
			expect(Array.isArray(args)).toBe(true);
			expect(args).toContain("scraper/scraper.py");
			expect(opts?.shell).not.toBe(true);
			expect(opts?.stdio).toEqual(["pipe", "pipe", "pipe"]);
		});
	});

	describe("Test 9: timeout option passed to spawn", () => {
		it("passes timeout option to spawn", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();
			child.stdout.emit("data", Buffer.from(JSON.stringify({ tracks: [], cover_art_url: null, error: null })));
			child.emit("close", 0, null);

			await promise;

			const [, , opts] = vi.mocked(spawn).mock.calls[0] as [string, string[], Record<string, unknown>];
			expect(opts?.timeout).toBe(30_000);
		});
	});

	describe("Test 10: W-1 prefix contract — synthesized message uses imported PYTHON_CRASH_PREFIX", () => {
		it("the crash message in tests 5, 6, 7 always starts with the shared PYTHON_CRASH_PREFIX constant", async () => {
			const child = makeFakeChild();
			vi.mocked(spawn).mockReturnValue(child as any);

			const bridge = new SpotifyScraperBridge("python3", "scraper/scraper.py", 30_000);
			const promise = bridge.fetchPlaylist("https://open.spotify.com/playlist/abc123");

			await tick();

			// Empty stdout + non-zero exit → crash envelope
			child.emit("close", 3, null);

			const result = await promise;

			// W-1 assertion: the imported constant matches what the bridge wrote
			expect(result.error?.message.startsWith(PYTHON_CRASH_PREFIX)).toBe(true);
			// Also verify the constant itself is "python crash:" (pinned literal)
			expect(PYTHON_CRASH_PREFIX).toBe("python crash:");
		});
	});
});
