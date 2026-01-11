import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PlaylistRow } from "../db/schema";

type MockCronInstance = {
	stop: ReturnType<typeof vi.fn>;
	callback: any;
};

const {
	mockCronInstances,
	mockDbSelect,
	mockInvocationCreate,
	mockInvocationUpdate,
	mockSpotdlRun,
} = vi.hoisted(() => ({
	mockCronInstances: new Map<string, MockCronInstance>(),
	mockDbSelect: vi.fn(),
	mockInvocationCreate: vi.fn(() => Promise.resolve({ id: "inv-1" })),
	mockInvocationUpdate: vi.fn(() => Promise.resolve({ id: "inv-1" })),
	mockSpotdlRun: vi.fn(() =>
		Promise.resolve({
			status: "success",
			exitCode: 0,
			runId: "run-1",
			startedAt: new Date().toISOString(),
			finishedAt: new Date().toISOString(),
			logPath: "/logs/test.log",
			syncFilePath: "/sync/test.spotdl",
			summary: "Downloaded 5 songs",
		}),
	),
}));

// Mock croner - must be before imports
vi.mock("croner", () => {
	const CronMock = vi.fn(function (
		this: MockCronInstance,
		pattern: string,
		callback?: any,
	) {
		this.stop = vi.fn();
		this.callback = callback;
		mockCronInstances.set(pattern, this);
	});

	return { Cron: CronMock };
});

// Mock the database module
vi.mock("../db", () => ({
	getDb: vi.fn(() => ({
		select: () => ({
			from: () => ({
				where: mockDbSelect,
			}),
		}),
	})),
	schema: {
		playlists: {
			scheduleEnabled: "schedule_enabled",
			status: "status",
		},
	},
}));

// Mock the InvocationRepository
vi.mock("../invocation/repository", () => ({
	InvocationRepository: {
		create: mockInvocationCreate,
		update: mockInvocationUpdate,
	},
}));

// Mock the SpotdlInvocator
vi.mock("../spotdl/repository/SpotdlInvocator", () => {
	const SpotdlInvocatorMock = vi.fn(function (this: {
		run: typeof mockSpotdlRun;
	}) {
		this.run = mockSpotdlRun;
	});

	return { SpotdlInvocator: SpotdlInvocatorMock };
});

// Mock crypto
vi.mock("node:crypto", () => ({
	randomUUID: vi.fn(() => "mock-uuid-123"),
}));

import { Cron } from "croner";
import { getScheduler, PlaylistScheduler } from "./PlaylistScheduler";

// Helper to create mock playlist
function createMockPlaylist(overrides: Partial<PlaylistRow> = {}): PlaylistRow {
	return {
		id: "playlist-1",
		name: "Test Playlist",
		sourceType: "playlist",
		sourceUrl: "https://open.spotify.com/playlist/123",
		outputDir: "/music/downloads",
		flagsOverwrite: false,
		flagsRetries: 3,
		flagsQuality: "high",
		flagsFormat: "mp3",
		scheduleEnabled: true,
		scheduleType: "cron",
		scheduleCron: "0 6 * * *",
		scheduleMinutes: 1440,
		status: "active",
		createdAt: new Date(),
		updatedAt: new Date(),
		...overrides,
	};
}

describe("PlaylistScheduler", () => {
	let scheduler: PlaylistScheduler;

	beforeEach(() => {
		vi.clearAllMocks();
		mockCronInstances.clear();
		mockDbSelect.mockResolvedValue([]);
		// Create a fresh scheduler for each test
		scheduler = new PlaylistScheduler();
	});

	afterEach(() => {
		if (scheduler) {
			scheduler.shutdown();
		}
		vi.clearAllMocks();
	});

	describe("intervalToCron", () => {
		it("should convert minutes less than 60 to every N minutes cron", () => {
			const playlist = createMockPlaylist({
				scheduleType: "interval",
				scheduleMinutes: 30,
			});

			scheduler.schedulePlaylist(playlist);

			expect(Cron).toHaveBeenCalledWith("*/30 * * * *", expect.any(Function));
		});

		it("should convert minutes between 60-1440 to hourly cron", () => {
			const playlist = createMockPlaylist({
				scheduleType: "interval",
				scheduleMinutes: 120, // 2 hours
			});

			scheduler.schedulePlaylist(playlist);

			expect(Cron).toHaveBeenCalledWith("0 */2 * * *", expect.any(Function));
		});

		it("should convert 1440 minutes (24 hours) to daily cron", () => {
			const playlist = createMockPlaylist({
				scheduleType: "interval",
				scheduleMinutes: 1440,
			});

			scheduler.schedulePlaylist(playlist);

			expect(Cron).toHaveBeenCalledWith("0 0 * * *", expect.any(Function));
		});

		it("should convert multi-day intervals to day-based cron", () => {
			const playlist = createMockPlaylist({
				scheduleType: "interval",
				scheduleMinutes: 10080, // 7 days
			});

			scheduler.schedulePlaylist(playlist);

			expect(Cron).toHaveBeenCalledWith("0 0 */7 * *", expect.any(Function));
		});
	});

	describe("schedulePlaylist", () => {
		it("should schedule a playlist with cron expression", () => {
			const playlist = createMockPlaylist({
				scheduleType: "cron",
				scheduleCron: "0 6 * * *",
			});

			scheduler.schedulePlaylist(playlist);

			expect(Cron).toHaveBeenCalledWith("0 6 * * *", expect.any(Function));
			expect(scheduler.isScheduled(playlist.id)).toBe(true);
			expect(scheduler.getScheduledCount()).toBe(1);
		});

		it("should schedule a playlist with interval", () => {
			const playlist = createMockPlaylist({
				scheduleType: "interval",
				scheduleMinutes: 60,
			});

			scheduler.schedulePlaylist(playlist);

			expect(Cron).toHaveBeenCalledWith("0 */1 * * *", expect.any(Function));
			expect(scheduler.isScheduled(playlist.id)).toBe(true);
		});

		it("should replace existing schedule when rescheduling", () => {
			const playlist = createMockPlaylist();

			scheduler.schedulePlaylist(playlist);
			scheduler.schedulePlaylist(playlist);

			// Should still only have 1 scheduled task
			expect(scheduler.getScheduledCount()).toBe(1);
		});

		it("should not schedule playlist with invalid cron", () => {
			// Make the Cron constructor throw for invalid patterns
			vi.mocked(Cron).mockImplementationOnce(() => {
				throw new Error("Invalid cron pattern");
			});

			const playlist = createMockPlaylist({
				scheduleCron: "invalid cron",
			});

			scheduler.schedulePlaylist(playlist);

			expect(scheduler.isScheduled(playlist.id)).toBe(false);
		});

		it("should not schedule playlist without schedule config", () => {
			const playlist = createMockPlaylist({
				scheduleType: "cron",
				scheduleCron: null,
			});

			scheduler.schedulePlaylist(playlist);

			expect(scheduler.isScheduled(playlist.id)).toBe(false);
		});
	});

	describe("unschedulePlaylist", () => {
		it("should remove a scheduled playlist", () => {
			const playlist = createMockPlaylist();
			scheduler.schedulePlaylist(playlist);

			expect(scheduler.isScheduled(playlist.id)).toBe(true);

			scheduler.unschedulePlaylist(playlist.id);

			expect(scheduler.isScheduled(playlist.id)).toBe(false);
			expect(scheduler.getScheduledCount()).toBe(0);
		});

		it("should handle unscheduling non-existent playlist gracefully", () => {
			expect(() => {
				scheduler.unschedulePlaylist("non-existent-id");
			}).not.toThrow();
		});
	});

	describe("initialize", () => {
		it("should load and schedule all enabled playlists from database", async () => {
			const mockPlaylists = [
				createMockPlaylist({ id: "pl-1", name: "Playlist 1" }),
				createMockPlaylist({ id: "pl-2", name: "Playlist 2" }),
			];

			mockDbSelect.mockResolvedValue(mockPlaylists);

			await scheduler.initialize();

			expect(scheduler.getScheduledCount()).toBe(2);
			expect(scheduler.isScheduled("pl-1")).toBe(true);
			expect(scheduler.isScheduled("pl-2")).toBe(true);
		});

		it("should handle empty playlist list", async () => {
			mockDbSelect.mockResolvedValue([]);

			await scheduler.initialize();

			expect(scheduler.getScheduledCount()).toBe(0);
		});
	});

	describe("reload", () => {
		it("should stop all tasks and reinitialize", async () => {
			const mockPlaylists = [createMockPlaylist({ id: "pl-1" })];
			mockDbSelect.mockResolvedValue(mockPlaylists);

			await scheduler.initialize();
			expect(scheduler.getScheduledCount()).toBe(1);

			// Change to different playlists
			const newPlaylists = [
				createMockPlaylist({ id: "pl-2" }),
				createMockPlaylist({ id: "pl-3" }),
			];
			mockDbSelect.mockResolvedValue(newPlaylists);

			await scheduler.reload();

			expect(scheduler.getScheduledCount()).toBe(2);
			expect(scheduler.isScheduled("pl-1")).toBe(false);
			expect(scheduler.isScheduled("pl-2")).toBe(true);
			expect(scheduler.isScheduled("pl-3")).toBe(true);
		});
	});

	describe("shutdown", () => {
		it("should stop all scheduled tasks", async () => {
			const mockPlaylists = [
				createMockPlaylist({ id: "pl-1" }),
				createMockPlaylist({ id: "pl-2" }),
			];
			mockDbSelect.mockResolvedValue(mockPlaylists);

			await scheduler.initialize();
			expect(scheduler.getScheduledCount()).toBe(2);

			scheduler.shutdown();

			expect(scheduler.getScheduledCount()).toBe(0);
		});
	});

	describe("executePlaylistSync", () => {
		it("should create invocation and run spotdl on trigger", async () => {
			const playlist = createMockPlaylist();

			scheduler.schedulePlaylist(playlist);

			// Get the callback and trigger it
			const cronInstance = mockCronInstances.get("0 6 * * *");
			expect(cronInstance).toBeDefined();

			await cronInstance!.callback();

			expect(mockInvocationCreate).toHaveBeenCalledWith(
				expect.objectContaining({
					id: "mock-uuid-123",
					playlistId: playlist.id,
					status: "running",
				}),
			);

			expect(mockInvocationUpdate).toHaveBeenCalledWith(
				"mock-uuid-123",
				expect.objectContaining({
					status: "success",
					exitCode: 0,
				}),
			);
		});

		it("should prevent concurrent runs of the same playlist", async () => {
			// Make the invocator slow
			let resolveRun: (value: any) => void;
			mockSpotdlRun.mockImplementation(
				() =>
					new Promise((resolve) => {
						resolveRun = resolve;
					}),
			);

			const playlist = createMockPlaylist();
			scheduler.schedulePlaylist(playlist);

			const cronInstance = mockCronInstances.get("0 6 * * *");
			expect(cronInstance).toBeDefined();

			// Trigger twice quickly
			const promise1 = cronInstance!.callback();
			cronInstance!.callback(); // Second call should be skipped

			// Resolve the first run
			resolveRun!({
				status: "success",
				exitCode: 0,
				finishedAt: new Date().toISOString(),
			});

			await promise1;

			// Should only have run once
			expect(mockSpotdlRun).toHaveBeenCalledTimes(1);
		});

		it("should handle invocation errors gracefully", async () => {
			mockSpotdlRun.mockRejectedValueOnce(new Error("spotdl crashed"));

			const playlist = createMockPlaylist();
			scheduler.schedulePlaylist(playlist);

			const cronInstance = mockCronInstances.get("0 6 * * *");
			expect(cronInstance).toBeDefined();

			await cronInstance!.callback();

			expect(mockInvocationUpdate).toHaveBeenCalledWith(
				"mock-uuid-123",
				expect.objectContaining({
					status: "failed",
					exitCode: -1,
					summary: "spotdl crashed",
				}),
			);
		});
	});

	describe("getScheduler singleton", () => {
		it("should return the same instance on multiple calls", () => {
			// Note: This test verifies the singleton behavior
			// Since we create fresh schedulers in beforeEach, we test the function directly
			const instance1 = getScheduler();
			const instance2 = getScheduler();

			expect(instance1).toBe(instance2);
		});
	});

	describe("multiple playlists with different schedules", () => {
		it("should schedule playlists with different cron expressions", () => {
			const playlists = [
				createMockPlaylist({
					id: "daily",
					scheduleCron: "0 6 * * *",
				}),
				createMockPlaylist({
					id: "hourly",
					scheduleType: "interval",
					scheduleMinutes: 60,
				}),
				createMockPlaylist({
					id: "weekly",
					scheduleCron: "0 0 * * 0",
				}),
			];

			for (const playlist of playlists) {
				scheduler.schedulePlaylist(playlist);
			}

			expect(scheduler.getScheduledCount()).toBe(3);
			expect(Cron).toHaveBeenCalledTimes(3);
		});
	});
});
