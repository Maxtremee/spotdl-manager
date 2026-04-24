import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceRow } from "../db/schema";

type MockCronInstance = {
	stop: ReturnType<typeof vi.fn>;
	callback: any;
};

const { mockCronInstances, mockDbSelect } = vi.hoisted(
	() => ({
		mockCronInstances: new Map<string, MockCronInstance>(),
		mockDbSelect: vi.fn(),
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

// Mock the event bus — scheduler must NOT emit directly (W-2); SyncRunner does that.
vi.mock("../events", () => ({
	getEventBus: vi.fn(() => ({ emit: vi.fn(() => Promise.resolve()) })),
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

// Helper: create a mock SyncRunner
function createMockRunner(runImpl: () => Promise<void> = () => Promise.resolve()) {
	return { run: vi.fn(runImpl) } as any;
}

describe("PlaylistScheduler (Phase 2 — SyncRunner delegation)", () => {
	let scheduler: PlaylistScheduler;

	beforeEach(() => {
		vi.clearAllMocks();
		mockCronInstances.clear();
		mockDbSelect.mockResolvedValue([]);
	});

	afterEach(() => {
		if (scheduler) {
			scheduler.shutdown();
		}
		vi.clearAllMocks();
	});

	// -------------------------------------------------------------------------
	// Task 1 — SyncRunner delegation behaviors
	// -------------------------------------------------------------------------

	describe("SyncRunner delegation", () => {
		it("Test 1: triggerManualSync delegates to syncRunner.run once with the source", async () => {
			const runner = createMockRunner();
			scheduler = new PlaylistScheduler({ syncRunner: runner });
			const source = createMockSource();

			const result = await scheduler.triggerManualSync(source);

			// Returns "triggered" immediately (fire-and-forget)
			expect(result).toBe("triggered");

			// Allow the microtask queue to flush the background run
			await Promise.resolve();

			expect(runner.run).toHaveBeenCalledTimes(1);
			expect(runner.run).toHaveBeenCalledWith(source);
		});

		it("Test 1b: runningPlaylists guard is true during run and false after", async () => {
			let sawRunning = false;
			const source = createMockSource();

			const runner = {
				run: vi.fn(async () => {
					// Inside the run, the guard should be active
					sawRunning = scheduler.isRunning(source.id);
				}),
			} as any;

			scheduler = new PlaylistScheduler({ syncRunner: runner });

			void scheduler.triggerManualSync(source);

			// Allow the async run to complete
			await new Promise((r) => setTimeout(r, 10));

			expect(sawRunning).toBe(true);
			// After run completes, the guard is cleared
			expect(scheduler.isRunning(source.id)).toBe(false);
		});

		it("Test 2: manual+scheduled race — second call short-circuits (D-06)", async () => {
			let resolveRun!: () => void;
			const runPromise = new Promise<void>((r) => {
				resolveRun = r;
			});
			const runner = { run: vi.fn(() => runPromise) } as any;

			scheduler = new PlaylistScheduler({ syncRunner: runner });
			const source = createMockSource();

			// First call — starts but doesn't finish
			const p1 = scheduler.triggerManualSync(source);
			expect(await p1).toBe("triggered");

			// Second call — guard short-circuits because first is still running
			const p2 = scheduler.triggerManualSync(source);
			expect(await p2).toBeNull();

			// Only one run invocation despite two calls
			expect(runner.run).toHaveBeenCalledTimes(1);

			// Finish first run
			resolveRun();
			await runPromise;
		});

		it("Test 3: sequential calls both succeed after first finishes", async () => {
			const runner = createMockRunner();
			scheduler = new PlaylistScheduler({ syncRunner: runner });
			const source = createMockSource();

			// First sync
			await scheduler.triggerManualSync(source);
			await new Promise((r) => setTimeout(r, 10));

			// Second sync after first finishes
			const result2 = await scheduler.triggerManualSync(source);
			expect(result2).toBe("triggered");
			await new Promise((r) => setTimeout(r, 10));

			// Both calls should have invoked runner.run
			expect(runner.run).toHaveBeenCalledTimes(2);
		});

		it("Test 4: runner throw cleans up runningPlaylists (guard not poisoned)", async () => {
			const runner = {
				run: vi.fn().mockRejectedValue(new Error("scrape boom")),
			} as any;

			scheduler = new PlaylistScheduler({ syncRunner: runner });
			const source = createMockSource();

			await scheduler.triggerManualSync(source);
			// Allow the rejected promise to settle (fire-and-forget)
			await new Promise((r) => setTimeout(r, 20));

			// Guard must be cleared even though run threw
			expect(scheduler.isRunning(source.id)).toBe(false);

			// Subsequent call should succeed
			const result2 = await scheduler.triggerManualSync(source);
			expect(result2).toBe("triggered");
		});

		it("Test 5: scheduler does NOT call getEventBus() directly during executePlaylistSync", async () => {
			// getEventBus is mocked — we want to ensure the scheduler itself never emits
			const { getEventBus } = await import("../events");
			const mockBus = { emit: vi.fn(() => Promise.resolve()) };
			vi.mocked(getEventBus).mockReturnValue(mockBus as any);

			const runner = createMockRunner();
			scheduler = new PlaylistScheduler({ syncRunner: runner });
			const source = createMockSource();

			await scheduler.triggerManualSync(source);
			await new Promise((r) => setTimeout(r, 20));

			// Scheduler itself must not emit any events — SyncRunner owns that
			expect(mockBus.emit).not.toHaveBeenCalled();
		});
	});

	// -------------------------------------------------------------------------
	// Unchanged behaviors — cron expression conversion
	// -------------------------------------------------------------------------

	describe("intervalToCron", () => {
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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

	describe("concurrency guard (tick path)", () => {
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

		it("second simultaneous cron tick is skipped by the running-set guard", async () => {
			let resolveRun!: () => void;
			const runPromise = new Promise<void>((r) => {
				resolveRun = r;
			});
			const runner = { run: vi.fn(() => runPromise) } as any;
			scheduler = new PlaylistScheduler({ syncRunner: runner });

			const source = createMockSource();
			scheduler.schedulePlaylist(source);

			const cronInstance = mockCronInstances.get("0 6 * * *");
			expect(cronInstance).toBeDefined();

			const p1 = cronInstance!.callback();
			const p2 = cronInstance!.callback();

			// Second tick is short-circuited — only one runner.run call
			expect(runner.run).toHaveBeenCalledTimes(1);

			resolveRun();
			await Promise.all([p1, p2]);
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
		beforeEach(() => {
			scheduler = new PlaylistScheduler({ syncRunner: createMockRunner() });
		});

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
