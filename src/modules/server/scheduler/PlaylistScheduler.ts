import { Cron } from "croner";
import { and, eq } from "drizzle-orm";
import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getDb, schema } from "../db";
import type { SourceRow } from "../db/schema";
import { SyncRunner } from "../scraper/SyncRunner";

/**
 * Manages scheduled sync jobs using croner.
 *
 * Phase 2 (this file): the tick body delegates to SyncRunner.run(source).
 * Scheduler owns ONLY: cron scheduling + the runningPlaylists concurrency
 * guard (D-06 shared for scheduled + manual triggers). All DB writes, events,
 * and Python-subprocess lifecycle belong to SyncRunner.
 *
 * Locked decisions:
 * - D-05 scheduler tick does real scrape work via SyncRunner. Note: D-05's
 *   "Scheduler keeps emitting" wording refers to the scheduled path
 *   continuing to produce `playlist.sync.*` events — the emission code
 *   itself moved into SyncRunner so scheduled + manual triggers share one
 *   lifecycle-event path. Do NOT re-introduce eventBus.emit calls here.
 * - D-06 manual trigger shares the same guard via triggerManualSync
 * - D-07 invocations rows written by SyncRunner (not the scheduler)
 */
export class PlaylistScheduler {
	private readonly tasks: Map<string, Cron> = new Map();
	private readonly runningPlaylists: Set<string> = new Set();
	private readonly logger: AppLogger;
	private readonly syncRunner: SyncRunner;

	constructor(deps: { logger?: AppLogger; syncRunner?: SyncRunner } = {}) {
		this.logger = deps.logger ?? Logger.get("PlaylistScheduler");
		this.syncRunner = deps.syncRunner ?? new SyncRunner();
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
	 * Execute a playlist sync, guarded by the runningPlaylists Set.
	 *
	 * This is a thin guard-wrapped delegation to SyncRunner.run(source).
	 * The guard entry is added BEFORE the first await (TOCTOU-safe per
	 * research Pitfall 5). All event emissions, DB writes, and subprocess
	 * lifecycle belong to SyncRunner — do NOT add eventBus.emit calls here.
	 */
	private async executePlaylistSync(source: SourceRow): Promise<void> {
		if (this.runningPlaylists.has(source.id)) {
			this.logger.warn(
				{ sourceId: source.id, sourceName: source.name },
				"Source already running — skipping concurrent tick",
			);
			return;
		}
		this.runningPlaylists.add(source.id);
		try {
			await this.syncRunner.run(source);
		} catch (err) {
			// SyncRunner.run is expected to handle its own errors and always emit
			// a terminal event (Pitfall 8). If it throws anyway, log and swallow —
			// the guard must be released regardless (see finally below).
			this.logger.error(
				{ err, sourceId: source.id, sourceName: source.name },
				"Unexpected error from SyncRunner.run — guard released",
			);
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
		this.logger.info("Initializing scheduler...");

		const sources = await this.getScheduledSources();
		this.logger.info(
			{ count: sources.length },
			"Found sources with scheduling enabled",
		);

		for (const source of sources) {
			this.schedulePlaylist(source);
		}

		this.logger.info("Scheduler initialized");
	}

	/**
	 * Reload schedules from database (useful when sources are updated).
	 */
	async reload(): Promise<void> {
		this.logger.info("Reloading scheduler...");

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
		this.logger.info("Shutting down scheduler...");
		for (const [sourceId] of this.tasks) {
			this.unschedulePlaylist(sourceId);
		}
		this.logger.info("Scheduler stopped");
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
	 * Returns "triggered" if started; null if the source is already running.
	 *
	 * Fire-and-forget: caller (server fn) returns "triggered" immediately;
	 * the sync runs in the background and emits completion via EventBus.
	 * The guard is added synchronously inside executePlaylistSync, so a
	 * back-to-back call that races this line sees the guard on entry.
	 *
	 * IMPORTANT: executePlaylistSync adds to runningPlaylists BEFORE any
	 * await — it's the first synchronous statement after the guard check.
	 * This closes the TOCTOU window mentioned in research Pitfall 5.
	 */
	async triggerManualSync(source: SourceRow): Promise<string | null> {
		if (this.runningPlaylists.has(source.id)) {
			this.logger.warn(
				{ sourceId: source.id, sourceName: source.name },
				"Source already running — manual sync rejected",
			);
			return null;
		}

		// Fire-and-forget: caller returns "triggered" immediately while
		// the sync runs in the background via EventBus emissions.
		// The void prefix makes the fire-and-forget intent explicit to linters.
		void this.executePlaylistSync(source);
		return "triggered";
	}
}

// Singleton instance
let schedulerInstance: PlaylistScheduler | null = null;

/**
 * Get or create the singleton scheduler instance.
 */
export function getScheduler(deps?: {
	logger?: AppLogger;
	syncRunner?: SyncRunner;
}): PlaylistScheduler {
	if (!schedulerInstance) {
		schedulerInstance = new PlaylistScheduler(deps);
	}
	return schedulerInstance;
}
