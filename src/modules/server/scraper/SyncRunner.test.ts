/**
 * SyncRunner tests — fake bridge, fake repos, mocked EventBus.
 *
 * All 12 behaviors specified in Plan 04 Task 2 are covered here.
 * No real Python is spawned — every bridge call returns a pre-canned envelope.
 * No real DB is touched — invocationRepo and scraperRepo are vitest fakes.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PYTHON_CRASH_PREFIX } from "./schema";
import { SyncRunner, isValidPlaylistUrl } from "./SyncRunner";
import type { SourceRow } from "../db/schema";

// ---------------------------------------------------------------------------
// Module-level mock: getEventBus — intercept all bus.emit() calls
// ---------------------------------------------------------------------------

const emitSpy = vi.fn().mockResolvedValue(undefined);

vi.mock("~/modules/server/events", () => ({
	getEventBus: () => ({ emit: emitSpy }),
}));

// ---------------------------------------------------------------------------
// Fake factory helpers
// ---------------------------------------------------------------------------

function fakeBridge(envelope: {
	tracks: Array<{
		spotify_track_id: string;
		title: string;
		artist: string;
		duration_ms: number;
		position: number;
	}> | null;
	cover_art_url: string | null;
	error: { type: "invalid_url" | "not_found" | "parse_error" | "network_error"; message: string } | null;
}) {
	return { fetchPlaylist: vi.fn().mockResolvedValue(envelope) } as unknown as import("./SpotifyScraperBridge").SpotifyScraperBridge;
}

function fakeBridgeThrows(err: Error) {
	return { fetchPlaylist: vi.fn().mockRejectedValue(err) } as unknown as import("./SpotifyScraperBridge").SpotifyScraperBridge;
}

function fakeInvocationRepo(opts: { createThrows?: Error } = {}) {
	return {
		create: opts.createThrows
			? vi.fn().mockRejectedValue(opts.createThrows)
			: vi.fn().mockResolvedValue({ id: "inv-1" }),
		update: vi.fn().mockResolvedValue({ id: "inv-1" }),
	} as unknown as import("../invocation/repository").InvocationRepository;
}

function fakeScraperRepo(opts: { upsertThrows?: Error } = {}) {
	return {
		upsertAll: opts.upsertThrows
			? vi.fn().mockRejectedValue(opts.upsertThrows)
			: vi.fn().mockResolvedValue(undefined),
		setCoverArtUrl: vi.fn().mockResolvedValue(undefined),
	} as unknown as import("./repository").ScraperRepository;
}

function sourceRow(overrides: Partial<SourceRow> = {}): SourceRow {
	return {
		id: "src-1",
		name: "Test Playlist",
		sourceType: "playlist",
		sourceUrl: "https://open.spotify.com/playlist/abc123",
		outputDir: "/data/music/test",
		coverArtUrl: null,
		scheduleEnabled: false,
		scheduleType: "interval",
		scheduleCron: null,
		scheduleMinutes: 1440,
		status: "active",
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

function makeTracks(count: number) {
	return Array.from({ length: count }, (_, i) => ({
		spotify_track_id: `track-${i}`,
		title: `Track ${i}`,
		artist: "Artist",
		duration_ms: 180000,
		position: i,
	}));
}

function happyEnvelope(trackCount = 3) {
	return {
		tracks: makeTracks(trackCount),
		cover_art_url: "https://covers.example.com/img.jpg",
		error: null,
	};
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
	emitSpy.mockClear();
});

describe("SyncRunner.run", () => {
	it("Test 1: happy path — started → invocation running → upsert → completed event", async () => {
		const bridge = fakeBridge(happyEnvelope(3));
		const invocationRepo = fakeInvocationRepo();
		const scraperRepo = fakeScraperRepo();
		const runner = new SyncRunner({ bridge, invocationRepo, scraperRepo });

		await runner.run(sourceRow());

		// started fires first
		expect(emitSpy.mock.calls[0][0].type).toBe("playlist.sync.started");

		// invocation row created with status=running
		expect(invocationRepo.create).toHaveBeenCalledWith(
			expect.objectContaining({ playlistId: "src-1", status: "running" }),
		);

		// repo.upsertAll called with 3 tracks
		expect(scraperRepo.upsertAll).toHaveBeenCalledWith(
			"src-1",
			expect.arrayContaining([expect.objectContaining({ spotifyTrackId: "track-0" })]),
			"https://covers.example.com/img.jpg",
		);
		const upsertCall = (scraperRepo.upsertAll as ReturnType<typeof vi.fn>).mock.calls[0];
		expect(upsertCall[1]).toHaveLength(3);

		// invocation updated to success
		expect(invocationRepo.update).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "success", exitCode: 0 }),
		);

		// completed event emitted with correct payload
		const completedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.completed",
		);
		expect(completedEvent).toBeDefined();
		expect(completedEvent![0].payload.trackCount).toBe(3);
		expect(completedEvent![0].payload.truncationSuspected).toBe(false);
		expect(completedEvent![0].payload.exitCode).toBe(0);
		expect(completedEvent![0].payload.duration).toBeGreaterThan(0);
	});

	it("Test 2: invalid_url — bridge never called, failure event emitted (T-2-04)", async () => {
		const bridge = fakeBridge(happyEnvelope());
		const invocationRepo = fakeInvocationRepo();
		const scraperRepo = fakeScraperRepo();
		const runner = new SyncRunner({ bridge, invocationRepo, scraperRepo });

		await runner.run(sourceRow({ sourceUrl: "https://evil.example.com/playlist/x" }));

		// Bridge must NOT be invoked
		expect(bridge.fetchPlaylist).not.toHaveBeenCalled();

		// Invocation updated to failed with invalid_url reason
		expect(invocationRepo.update).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				status: "failed",
				exitCode: 1,
				summary: expect.stringContaining('"failure_reason":"invalid_url"'),
			}),
		);

		// playlist.sync.failed with failureReason=invalid_url
		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(failedEvent![0].payload.failureReason).toBe("invalid_url");
	});

	it("Test 3: not_found error from bridge → failure event with failureReason=not_found", async () => {
		const bridge = fakeBridge({
			tracks: null,
			cover_art_url: null,
			error: { type: "not_found", message: "Playlist not found" },
		});
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(failedEvent![0].payload.failureReason).toBe("not_found");
	});

	it("Test 4: parse_error from bridge → failureReason=parse_error", async () => {
		const bridge = fakeBridge({
			tracks: null,
			cover_art_url: null,
			error: { type: "parse_error", message: "Unexpected shape" },
		});
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(failedEvent![0].payload.failureReason).toBe("parse_error");
	});

	it("Test 5: network_error from bridge → failureReason=network_error", async () => {
		const bridge = fakeBridge({
			tracks: null,
			cover_art_url: null,
			error: { type: "network_error", message: "ConnectionError()" },
		});
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(failedEvent![0].payload.failureReason).toBe("network_error");
	});

	it("Test 6: python_crash detection via W-1 shared constant — PYTHON_CRASH_PREFIX in message → reclassified as python_crash", async () => {
		// W-1: test fixture uses the imported constant — NOT a hand-typed string
		const crashEnvelope = {
			tracks: null,
			cover_art_url: null,
			error: {
				type: "network_error" as const,
				message: `${PYTHON_CRASH_PREFIX} exit=2 signal=null stderr=Traceback...`,
			},
		};
		const bridge = fakeBridge(crashEnvelope);
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		// SyncRunner must reclassify "network_error" with PYTHON_CRASH_PREFIX prefix to "python_crash"
		expect(failedEvent![0].payload.failureReason).toBe("python_crash");
	});

	it("Test 7: truncation >=100 — truncationSuspected=true, trackCount=100", async () => {
		const bridge = fakeBridge(happyEnvelope(100));
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const completedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.completed",
		);
		expect(completedEvent![0].payload.truncationSuspected).toBe(true);
		expect(completedEvent![0].payload.trackCount).toBe(100);

		// invocation summary also contains truncation_suspected=true
		const invocationRepo = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });
		// Just verify the event payload is sufficient — summary is tested below via update call
		const invUpdate = (new SyncRunner({
			bridge: fakeBridge(happyEnvelope(100)),
			invocationRepo: {
				create: vi.fn().mockResolvedValue({ id: "inv-1" }),
				update: vi.fn().mockResolvedValue({ id: "inv-1" }),
			} as unknown as import("../invocation/repository").InvocationRepository,
			scraperRepo: fakeScraperRepo(),
		}));
		const invocationRepoSpy = fakeInvocationRepo();
		const runner2 = new SyncRunner({
			bridge: fakeBridge(happyEnvelope(100)),
			invocationRepo: invocationRepoSpy,
			scraperRepo: fakeScraperRepo(),
		});
		emitSpy.mockClear();
		await runner2.run(sourceRow());

		expect(invocationRepoSpy.update).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({
				summary: expect.stringContaining('"truncation_suspected":true'),
			}),
		);
	});

	it("Test 8: exactly 99 tracks → truncationSuspected=false", async () => {
		const bridge = fakeBridge(happyEnvelope(99));
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const completedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.completed",
		);
		expect(completedEvent![0].payload.truncationSuspected).toBe(false);
		expect(completedEvent![0].payload.trackCount).toBe(99);
	});

	it("Test 9: exactly 100 tracks → truncationSuspected=true (>= boundary)", async () => {
		const bridge = fakeBridge(happyEnvelope(100));
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const completedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.completed",
		);
		expect(completedEvent![0].payload.truncationSuspected).toBe(true);
	});

	it("Test 10: repo.upsertAll throws → invocation failed + terminal event emitted (D-08 atomicity)", async () => {
		const bridge = fakeBridge(happyEnvelope(3));
		const dbErr = new Error("SQLITE_CONSTRAINT");
		const scraperRepo = fakeScraperRepo({ upsertThrows: dbErr });
		const invocationRepo = fakeInvocationRepo();
		const runner = new SyncRunner({ bridge, invocationRepo, scraperRepo });

		await runner.run(sourceRow());

		// Invocation updated to failed
		expect(invocationRepo.update).toHaveBeenCalledWith(
			expect.any(String),
			expect.objectContaining({ status: "failed", exitCode: 1 }),
		);

		// Terminal event must be a failed event
		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(failedEvent).toBeDefined();
	});

	it("Test 11: unexpected throw (invocationRepo.create throws) → terminal event always fires (Pitfall 8)", async () => {
		const bridge = fakeBridge(happyEnvelope());
		const invocationRepo = fakeInvocationRepo({ createThrows: new Error("DB gone") });
		const scraperRepo = fakeScraperRepo();
		const runner = new SyncRunner({ bridge, invocationRepo, scraperRepo });

		// Must not throw
		await expect(runner.run(sourceRow())).resolves.not.toThrow();

		// A terminal event (started + failed) must have been emitted
		const terminalEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(terminalEvent).toBeDefined();
	});

	it("Test 12: bridge returns null tracks without error → python_crash (defensive)", async () => {
		const bridge = fakeBridge({ tracks: null, cover_art_url: null, error: null });
		const runner = new SyncRunner({ bridge, invocationRepo: fakeInvocationRepo(), scraperRepo: fakeScraperRepo() });

		await runner.run(sourceRow());

		const failedEvent = emitSpy.mock.calls.find(
			(c: [{ type: string }]) => c[0].type === "playlist.sync.failed",
		);
		expect(failedEvent![0].payload.failureReason).toBe("python_crash");
	});
});

describe("isValidPlaylistUrl", () => {
	it("accepts valid Spotify playlist URL", () => {
		expect(isValidPlaylistUrl("https://open.spotify.com/playlist/abc123")).toBe(true);
	});

	it("accepts playlist URL with query string", () => {
		expect(isValidPlaylistUrl("https://open.spotify.com/playlist/abc?si=123")).toBe(true);
	});

	it("rejects album URL (Phase 2 only validates /playlist/)", () => {
		expect(isValidPlaylistUrl("https://open.spotify.com/album/abc123")).toBe(false);
	});

	it("rejects evil host", () => {
		expect(isValidPlaylistUrl("https://evil.example.com/playlist/abc")).toBe(false);
	});

	it("rejects subdomain of open.spotify.com", () => {
		expect(isValidPlaylistUrl("https://api.open.spotify.com/playlist/abc")).toBe(false);
	});

	it("rejects /track/ path", () => {
		expect(isValidPlaylistUrl("https://open.spotify.com/track/abc")).toBe(false);
	});

	it("rejects non-URL garbage", () => {
		expect(isValidPlaylistUrl("not-a-url")).toBe(false);
	});
});
