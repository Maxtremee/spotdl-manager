import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { and, eq } from "drizzle-orm";
import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getDb, schema } from "../db";
import type { SourceRow } from "../db/schema";
import { getEventBus } from "../events";

/**
 * Manages scheduled sync jobs using croner.
 *
 * Phase 1 (this file): the tick body is an **event-emitting no-op**. Each
 * tick fires `playlist.sync.started` immediately followed by
 * `playlist.sync.completed` via the existing event bus — no scrape, no
 * download, no invocation row. This keeps the webhook / metrics / duration
 * warning / logging handlers warm through the interim before the Phase 3
 * engine lands.
 *
 * Locked decisions (see `.planning/phases/01-schema-reset-spotdl-removal/01-CONTEXT.md`):
 * - D-01 scheduler stays wired, ticks on its cron/interval schedule.
 * - D-02 stub ticks emit `playlist.sync.started` + `playlist.sync.completed`.
 * - D-03 stub ticks do NOT create `invocations` rows. Events only.
 */
export class PlaylistScheduler {
	private readonly tasks: Map<string, Cron> = new Map();
	private readonly runningPlaylists: Set<string> = new Set();
	private readonly logger: AppLogger;

	constructor(logger?: AppLogger) {
		this.logger = logger ?? Logger.get("SchedulerStub");
	}

	/**
	 * Fetch all sources with scheduling enabled and active status.
	 */
	private async getScheduledSources(): Promise<SourceRow[]> {
		const db = getDb();
		return db
			.select()
			.from(schema.sources)
			.where(
				and(
					eq(schema.sources.scheduleEnabled, true),
					eq(schema.sources.status, "active"),
				),
			);
	}

	/**
	 * Convert interval minutes to a cron expression.
	 * For intervals, we run every N minutes.
	 */
	private intervalToCron(minutes: number): string {
		if (minutes < 60) {
			// Every N minutes
			return `*/${minutes} * * * *`;
		}
		if (minutes < 1440) {
			// Every N hours (approximate to nearest hour)
			const hours = Math.max(1, Math.round(minutes / 60));
			return `0 */${hours} * * *`;
		}
		// Every N days (approximate to nearest day)
		const days = Math.max(1, Math.round(minutes / 1440));
		if (days === 1) {
			return "0 0 * * *"; // Daily at midnight
		}
		// For multi-day intervals, run at midnight on specific days
		return `0 0 */${days} * *`;
	}

	/**
	 * Phase 1 stub: emit `playlist.sync.started` then `playlist.sync.completed`
	 * with no work in between. No DB writes (D-03). A concurrency guard
	 * prevents a same-source tick from overlapping itself — the running-set
	 * entry is added *before* the first `await` so simultaneous invocations
	 * see the guard.
	 *
	 * Duration is `Math.max(1, elapsedMs)` because the `duration` field in
	 * `PlaylistSyncCompletedEventSchema` is `z.number().positive()` and a
	 * 0-ms synchronous tick would be rejected by Zod, silently dropping
	 * downstream handlers. (Pitfall 2 guard.)
	 */
	private async executePlaylistSync(source: SourceRow): Promise<void> {
		if (this.runningPlaylists.has(source.id)) {
			this.logger.warn(
				{ sourceId: source.id, sourceName: source.name },
				"Stub: source already ticking, skipping",
			);
			return;
		}

		this.runningPlaylists.add(source.id);
		const invocationId = randomUUID();
		const startedAt = Date.now();
		const eventBus = getEventBus();

		try {
			await eventBus.emit({
				type: "playlist.sync.started",
				payload: {
					playlistId: source.id,
					playlistName: source.name,
					invocationId,
					sourceUrl: source.sourceUrl,
					outputDir: source.outputDir,
				},
			});

			this.logger.info(
				{ sourceId: source.id, sourceName: source.name },
				"Scheduler stub tick — no engine attached (Phase 1)",
			);

			// Pitfall 2: Zod `z.number().positive()` rejects 0, so floor to 1ms.
			const duration = Math.max(1, Date.now() - startedAt);

			await eventBus.emit({
				type: "playlist.sync.completed",
				payload: {
					playlistId: source.id,
					playlistName: source.name,
					invocationId,
					duration,
					exitCode: 0,
					summary: "Phase 1 stub — no engine attached",
				},
			});
		} finally {
			this.runningPlaylists.delete(source.id);
		}
	}

	/**
	 * Schedule a single source.
	 *
	 * NOTE: Public method name kept as `schedulePlaylist` because external
	 * callers (e.g. plugins) reference it; only the param type and internal
	 * variable names are renamed to `source`.
	 */
	schedulePlaylist(source: SourceRow): void {
		// Remove existing task if any
		this.unschedulePlaylist(source.id);

		// Determine cron expression
		let cronExpression: string;
		if (source.scheduleType === "cron" && source.scheduleCron) {
			cronExpression = source.scheduleCron;
		} else if (
			source.scheduleType === "interval" &&
			source.scheduleMinutes
		) {
			cronExpression = this.intervalToCron(source.scheduleMinutes);
		} else {
			this.logger.warn(
				{ sourceId: source.id, sourceName: source.name },
				"Invalid schedule configuration",
			);
			return;
		}

		// Create and store the scheduled task
		try {
			const task = new Cron(cronExpression, async () => {
				// Return the promise so callers (and tests) can await completion
				return this.executePlaylistSync(source);
			});

			this.tasks.set(source.id, task);
			this.logger.info(
				{
					sourceId: source.id,
					sourceName: source.name,
					cron: cronExpression,
				},
				"Scheduled source",
			);
		} catch (error) {
			this.logger.error(
				{
					err: error,
					sourceId: source.id,
					sourceName: source.name,
					cron: cronExpression,
				},
				"Invalid cron expression",
			);
		}
	}

	/**
	 * Remove a source from the schedule.
	 *
	 * Public method name kept as `unschedulePlaylist` because external
	 * callers still use it.
	 */
	unschedulePlaylist(sourceId: string): void {
		const task = this.tasks.get(sourceId);
		if (task) {
			task.stop();
			this.tasks.delete(sourceId);
			this.logger.info({ sourceId }, "Unscheduled source");
		}
	}

	/**
	 * Initialize the scheduler by loading all scheduled sources from the database.
	 */
	async initialize(): Promise<void> {
		this.logger.info("Initializing scheduler stub...");

		const sources = await this.getScheduledSources();
		this.logger.info(
			{ count: sources.length },
			"Found sources with scheduling enabled",
		);

		for (const source of sources) {
			this.schedulePlaylist(source);
		}

		this.logger.info("Scheduler stub initialized");
	}

	/**
	 * Reload schedules from database (useful when sources are updated).
	 */
	async reload(): Promise<void> {
		this.logger.info("Reloading scheduler stub...");

		// Stop all current tasks
		for (const [sourceId] of this.tasks) {
			this.unschedulePlaylist(sourceId);
		}

		// Re-initialize
		await this.initialize();
	}

	/**
	 * Stop all scheduled tasks.
	 */
	shutdown(): void {
		this.logger.info("Shutting down scheduler stub...");
		for (const [sourceId] of this.tasks) {
			this.unschedulePlaylist(sourceId);
		}
		this.logger.info("Scheduler stub stopped");
	}

	/**
	 * Get the number of scheduled tasks.
	 */
	getScheduledCount(): number {
		return this.tasks.size;
	}

	/**
	 * Check if a source is currently scheduled.
	 */
	isScheduled(sourceId: string): boolean {
		return this.tasks.has(sourceId);
	}

	/**
	 * Check if a source is currently running.
	 */
	isRunning(sourceId: string): boolean {
		return this.runningPlaylists.has(sourceId);
	}

	/**
	 * Manually trigger a sync.
	 *
	 * Phase 1 note (Pitfall 5): the UI "Run Now" button is hidden in Plan 01-02
	 * per D-04, but this server function is intentionally preserved so Phase 3
	 * can re-enable the button without re-plumbing the public method surface.
	 * The call body (`executePlaylistSync`) currently runs the event-emitting
	 * stub.
	 *
	 * Returns "triggered" if started; null if the source is already running.
	 */
	async triggerManualSync(source: SourceRow): Promise<string | null> {
		if (this.runningPlaylists.has(source.id)) {
			this.logger.warn(
				{ sourceId: source.id, sourceName: source.name },
				"Source is already running, cannot trigger manual sync",
			);
			return null;
		}

		// Execute sync in background (don't await, let it run async)
		this.executePlaylistSync(source);

		// Return early — the sync is now running.
		return "triggered";
	}
}

// Singleton instance
let schedulerInstance: PlaylistScheduler | null = null;

/**
 * Get or create the singleton scheduler instance.
 */
export function getScheduler(logger?: AppLogger): PlaylistScheduler {
	if (!schedulerInstance) {
		schedulerInstance = new PlaylistScheduler(logger);
	}
	return schedulerInstance;
}
