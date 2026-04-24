import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRow } from "../db/schema";
import {
	PlaylistSyncCompletedEventSchema,
	PlaylistSyncStartedEventSchema,
} from "../events/schema";

type MockCronInstance = {
	stop: ReturnType<typeof vi.fn>;
	callback: any;
};

const { mockCronInstances, mockDbSelect, mockEventBusEmit } = vi.hoisted(
	() => ({
		mockCronInstances: new Map<string, MockCronInstance>(),
		mockDbSelect: vi.fn(),
		// Typed as accepting the emit envelope so `.mock.calls[i][0]` is well-typed.
		mockEventBusEmit: vi.fn((_event: { type: string; payload: any }) =>
			Promise.resolve(),
		),
	}),
);

// Mock croner — must be hoisted before imports
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

// Mock the database module — schema.sources only (no schema.playlists)
vi.mock("../db", () => ({
	getDb: vi.fn(() => ({
		select: () => ({
			from: () => ({
				where: mockDbSelect,
			}),
		}),
	})),
	schema: {
		sources: {
			scheduleEnabled: "schedule_enabled",
			status: "status",
		},
	},
}));

// Mock the event bus — stub emits via getEventBus().emit(...)
vi.mock("../events", () => ({
	getEventBus: vi.fn(() => ({ emit: mockEventBusEmit })),
}));

// Mock crypto — deterministic invocationId for schema assertions
vi.mock("node:crypto", () => ({
	randomUUID: vi.fn(() => "00000000-0000-4000-8000-000000000001"),
}));

import { Cron } from "croner";
import { getScheduler, PlaylistScheduler } from "./PlaylistScheduler";

// Helper to create mock source row
function createMockSource(overrides: Partial<SourceRow> = {}): SourceRow {
	return {
		id: "source-1",
		name: "Test Source",
		sourceType: "playlist",
		sourceUrl: "https://open.spotify.com/playlist/123",
		outputDir: "/music/downloads",
		coverArtUrl: null,
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

describe("PlaylistScheduler (Phase 1 stub)", () => {
	let scheduler: PlaylistScheduler;

	beforeEach(() => {
		vi.clearAllMocks();
		mockCronInstances.clear();
		mockDbSelect.mockResolvedValue([]);
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
			const source = createMockSource({
				scheduleType: "interval",
				scheduleMinutes: 30,
			});

			scheduler.schedulePlaylist(source);

			expect(Cron).toHaveBeenCalledWith("*/30 * * * *", expect.any(Function));
		});

		it("should convert minutes between 60-1440 to hourly cron", () => {
			const source = createMockSource({
				scheduleType: "interval",
				scheduleMinutes: 120, // 2 hours
			});

			scheduler.schedulePlaylist(source);

			expect(Cron).toHaveBeenCalledWith("0 */2 * * *", expect.any(Function));
		});

		it("should convert 1440 minutes (24 hours) to daily cron", () => {
			const source = createMockSource({
				scheduleType: "interval",
				scheduleMinutes: 1440,
			});

			scheduler.schedulePlaylist(source);

			expect(Cron).toHaveBeenCalledWith("0 0 * * *", expect.any(Function));
		});

		it("should convert multi-day intervals to day-based cron", () => {
			const source = createMockSource({
				scheduleType: "interval",
				scheduleMinutes: 10080, // 7 days
			});

			scheduler.schedulePlaylist(source);

			expect(Cron).toHaveBeenCalledWith("0 0 */7 * *", expect.any(Function));
		});
	});

	describe("schedulePlaylist", () => {
		it("should schedule a source with cron expression", () => {
			const source = createMockSource({
				scheduleType: "cron",
				scheduleCron: "0 6 * * *",
			});

			scheduler.schedulePlaylist(source);

			expect(Cron).toHaveBeenCalledWith("0 6 * * *", expect.any(Function));
			expect(scheduler.isScheduled(source.id)).toBe(true);
			expect(scheduler.getScheduledCount()).toBe(1);
		});

		it("should schedule a source with interval", () => {
			const source = createMockSource({
				scheduleType: "interval",
				scheduleMinutes: 60,
			});

			scheduler.schedulePlaylist(source);

			expect(Cron).toHaveBeenCalledWith("0 */1 * * *", expect.any(Function));
			expect(scheduler.isScheduled(source.id)).toBe(true);
		});

		it("should replace existing schedule when rescheduling", () => {
			const source = createMockSource();

			scheduler.schedulePlaylist(source);
			scheduler.schedulePlaylist(source);

			// Should still only have 1 scheduled task
			expect(scheduler.getScheduledCount()).toBe(1);
		});

		it("should not schedule source with invalid cron", () => {
			// Make the Cron constructor throw for invalid patterns
			vi.mocked(Cron).mockImplementationOnce(() => {
				throw new Error("Invalid cron pattern");
			});

			const source = createMockSource({
				scheduleCron: "invalid cron",
			});

			scheduler.schedulePlaylist(source);

			expect(scheduler.isScheduled(source.id)).toBe(false);
		});

		it("should not schedule source without schedule config", () => {
			const source = createMockSource({
				scheduleType: "cron",
				scheduleCron: null,
			});

			scheduler.schedulePlaylist(source);

			expect(scheduler.isScheduled(source.id)).toBe(false);
		});
	});

	describe("unschedulePlaylist", () => {
		it("should remove a scheduled source", () => {
			const source = createMockSource();
			scheduler.schedulePlaylist(source);

			expect(scheduler.isScheduled(source.id)).toBe(true);

			scheduler.unschedulePlaylist(source.id);

			expect(scheduler.isScheduled(source.id)).toBe(false);
			expect(scheduler.getScheduledCount()).toBe(0);
		});

		it("should handle unscheduling non-existent source gracefully", () => {
			expect(() => {
				scheduler.unschedulePlaylist("non-existent-id");
			}).not.toThrow();
		});
	});

	describe("initialize", () => {
		it("should load and schedule all enabled sources from database", async () => {
			const sources = [
				createMockSource({ id: "src-1", name: "One" }),
				createMockSource({ id: "src-2", name: "Two" }),
			];

			mockDbSelect.mockResolvedValue(sources);

			await scheduler.initialize();

			expect(scheduler.getScheduledCount()).toBe(2);
			expect(scheduler.isScheduled("src-1")).toBe(true);
			expect(scheduler.isScheduled("src-2")).toBe(true);
		});

		it("should handle empty source list", async () => {
			mockDbSelect.mockResolvedValue([]);

			await scheduler.initialize();

			expect(scheduler.getScheduledCount()).toBe(0);
		});
	});

	describe("reload", () => {
		it("should stop all tasks and reinitialise", async () => {
			mockDbSelect.mockResolvedValue([createMockSource({ id: "a" })]);

			await scheduler.initialize();
			expect(scheduler.getScheduledCount()).toBe(1);

			mockDbSelect.mockResolvedValue([
				createMockSource({ id: "b" }),
				createMockSource({ id: "c" }),
			]);

			await scheduler.reload();

			expect(scheduler.isScheduled("a")).toBe(false);
			expect(scheduler.isScheduled("b")).toBe(true);
			expect(scheduler.isScheduled("c")).toBe(true);
		});
	});

	describe("shutdown", () => {
		it("should stop all scheduled tasks", async () => {
			mockDbSelect.mockResolvedValue([
				createMockSource({ id: "src-1" }),
				createMockSource({ id: "src-2" }),
			]);

			await scheduler.initialize();
			expect(scheduler.getScheduledCount()).toBe(2);

			scheduler.shutdown();

			expect(scheduler.getScheduledCount()).toBe(0);
		});
	});

	describe("executePlaylistSync (stub)", () => {
		it("emits started then completed on each tick — no DB writes", async () => {
			const source = createMockSource();
			scheduler.schedulePlaylist(source);

			const cronInstance = mockCronInstances.get("0 6 * * *");
			expect(cronInstance).toBeDefined();

			await cronInstance?.callback();

			expect(mockEventBusEmit).toHaveBeenCalledTimes(2);
			expect(mockEventBusEmit.mock.calls[0][0].type).toBe(
				"playlist.sync.started",
			);
			expect(mockEventBusEmit.mock.calls[1][0].type).toBe(
				"playlist.sync.completed",
			);
		});

		it("started payload satisfies Zod schema", async () => {
			const source = createMockSource();
			scheduler.schedulePlaylist(source);

			await mockCronInstances.get("0 6 * * *")?.callback();

			const started = mockEventBusEmit.mock.calls[0][0];
			expect(() =>
				PlaylistSyncStartedEventSchema.shape.payload.parse(started.payload),
			).not.toThrow();
			expect(started.payload.playlistId).toBe(source.id);
			expect(started.payload.playlistName).toBe(source.name);
			expect(started.payload.sourceUrl).toBe(source.sourceUrl);
			expect(started.payload.outputDir).toBe(source.outputDir);
		});

		it("completed payload has positive duration (Pitfall 2 guard)", async () => {
			const source = createMockSource();
			scheduler.schedulePlaylist(source);

			await mockCronInstances.get("0 6 * * *")?.callback();

			const completed = mockEventBusEmit.mock.calls[1][0];
			expect(() =>
				PlaylistSyncCompletedEventSchema.shape.payload.parse(completed.payload),
			).not.toThrow();
			expect(completed.payload.duration).toBeGreaterThan(0);
			expect(completed.payload.exitCode).toBe(0);
		});

		it("concurrency guard — second simultaneous tick is skipped", async () => {
			const source = createMockSource();
			scheduler.schedulePlaylist(source);

			const cronInstance = mockCronInstances.get("0 6 * * *");
			expect(cronInstance).toBeDefined();
			const cb = cronInstance!.callback;
			const p1 = cb();
			const p2 = cb();
			await Promise.all([p1, p2]);

			// Only the first tick emits; the second is skipped by the running-set guard.
			expect(mockEventBusEmit).toHaveBeenCalledTimes(2);
		});
	});

	describe("getScheduler singleton", () => {
		it("should return the same instance on multiple calls", () => {
			const instance1 = getScheduler();
			const instance2 = getScheduler();

			expect(instance1).toBe(instance2);
		});
	});

	describe("multiple sources with different schedules", () => {
		it("should schedule sources with different cron expressions", () => {
			const sources = [
				createMockSource({
					id: "daily",
					scheduleCron: "0 6 * * *",
				}),
				createMockSource({
					id: "hourly",
					scheduleType: "interval",
					scheduleMinutes: 60,
				}),
				createMockSource({
					id: "weekly",
					scheduleCron: "0 0 * * 0",
				}),
			];

			for (const source of sources) {
				scheduler.schedulePlaylist(source);
			}

			expect(scheduler.getScheduledCount()).toBe(3);
			expect(Cron).toHaveBeenCalledTimes(3);
		});
	});
});
