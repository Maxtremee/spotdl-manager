import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { and, eq } from "drizzle-orm";
import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getDb, schema } from "../db";
import type { PlaylistRow } from "../db/schema";
import { getEventBus } from "../events";
import { InvocationRepository } from "../invocation/repository";
import { SpotdlRepository } from "../spotdl/repository";
import { SpotdlInvocator } from "../spotdl/SpotdlInvocator";

/**
 * Manages scheduled playlist sync jobs using croner.
 * Handles both cron-based and interval-based scheduling.
 */
export class PlaylistScheduler {
	private readonly tasks: Map<string, Cron> = new Map();
	private invocator: SpotdlInvocator;
	private readonly runningPlaylists: Set<string> = new Set();
	private readonly logger: AppLogger;

	constructor(logger?: AppLogger) {
		this.invocator = new SpotdlInvocator();
		this.logger = logger ?? Logger.get("PlaylistScheduler");
	}

	/**
	 * Load spotdl settings and reinitialize invocator with cookies if configured
	 */
	private async loadSpotdlSettings(): Promise<void> {
		const settings = await SpotdlRepository.getSettings();
		this.invocator = new SpotdlInvocator({
			cookiesFile: settings.cookiesFile,
		});
	}

	/**
	 * Fetch all playlists with scheduling enabled and active status
	 */
	private async getScheduledPlaylists(): Promise<PlaylistRow[]> {
		const db = getDb();
		return db
			.select()
			.from(schema.playlists)
			.where(
				and(
					eq(schema.playlists.scheduleEnabled, true),
					eq(schema.playlists.status, "active"),
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
	 * Execute a playlist sync and record the invocation
	 */
	private async executePlaylistSync(playlist: PlaylistRow): Promise<void> {
		// Prevent concurrent runs of the same playlist
		if (this.runningPlaylists.has(playlist.id)) {
			this.logger.warn(
				{ playlistId: playlist.id, playlistName: playlist.name },
				"Playlist is already running, skipping",
			);
			return;
		}

		this.runningPlaylists.add(playlist.id);
		const invocationId = randomUUID();
		const startedAt = new Date();
		let createPromise: Promise<unknown> | null = null;

		this.logger.info(
			{ playlistId: playlist.id, playlistName: playlist.name },
			"Starting scheduled sync",
		);

		const eventBus = getEventBus();

		// Emit sync started event
		await eventBus.emit({
			type: "playlist.sync.started",
			payload: {
				playlistId: playlist.id,
				playlistName: playlist.name,
				invocationId,
				sourceUrl: playlist.sourceUrl,
				outputDir: playlist.outputDir,
			},
		});

		try {
			// Compute log path upfront so we can read logs while invocation is running
			const logPath = this.invocator.getLogPath(playlist.id, startedAt);

			createPromise = InvocationRepository.create({
				id: invocationId,
				playlistId: playlist.id,
				startedAt,
				status: "running",
				logPath,
			});

			const result = await this.invocator.run({
				playlistId: playlist.id,
				sourceUrl: playlist.sourceUrl,
				outputDir: playlist.outputDir,
				flags: {
					format: playlist.flagsFormat as "mp3" | "m4a" | "flac" | "wav",
					overwrite: playlist.flagsOverwrite,
				},
			});

			await createPromise;

			await InvocationRepository.update(invocationId, {
				finishedAt: new Date(result.finishedAt),
				exitCode: result.exitCode,
				status: result.status,
				logPath: result.logPath,
				syncFilePath: result.syncFilePath,
				summary: result.summary,
			});

			const finishedAtMs = new Date(result.finishedAt).getTime();
			const duration = finishedAtMs - startedAt.getTime();

			this.logger.info(
				{
					playlistId: playlist.id,
					playlistName: playlist.name,
					status: result.status,
				},
				"Completed sync",
			);

			if (result.status === "success") {
				// Emit appropriate completion event based on status
				await eventBus.emit({
					type: "playlist.sync.completed",
					payload: {
						playlistId: playlist.id,
						playlistName: playlist.name,
						invocationId,
						duration,
						exitCode: result.exitCode ?? 0,
						summary: result.summary,
						logPath: result.logPath,
						syncFilePath: result.syncFilePath,
					},
				});
			} else if (result.status === "failed") {
				await eventBus.emit({
					type: "playlist.sync.failed",
					payload: {
						playlistId: playlist.id,
						playlistName: playlist.name,
						invocationId,
						error: result.summary || "Unknown error",
						exitCode: result.exitCode ?? undefined,
						logPath: result.logPath,
					},
				});
			} else if (result.status === "canceled") {
				await eventBus.emit({
					type: "playlist.sync.canceled",
					payload: {
						playlistId: playlist.id,
						playlistName: playlist.name,
						invocationId,
						reason: result.summary,
					},
				});
			}
		} catch (error) {
			this.logger.error(
				{ err: error, playlistId: playlist.id, playlistName: playlist.name },
				"Error syncing playlist",
			);

			if (createPromise) {
				await createPromise.catch(() => {});
			}

			// Update invocation as failed
			await InvocationRepository.update(invocationId, {
				finishedAt: new Date(),
				exitCode: -1,
				status: "failed",
				summary: error instanceof Error ? error.message : "Unknown error",
			});

			// Emit failure event
			await eventBus.emit({
				type: "playlist.sync.failed",
				payload: {
					playlistId: playlist.id,
					playlistName: playlist.name,
					invocationId,
					error: error instanceof Error ? error.message : "Unknown error",
					exitCode: -1,
				},
			});
		} finally {
			this.runningPlaylists.delete(playlist.id);
		}
	}

	/**
	 * Schedule a single playlist
	 */
	schedulePlaylist(playlist: PlaylistRow): void {
		// Remove existing task if any
		this.unschedulePlaylist(playlist.id);

		// Determine cron expression
		let cronExpression: string;
		if (playlist.scheduleType === "cron" && playlist.scheduleCron) {
			cronExpression = playlist.scheduleCron;
		} else if (
			playlist.scheduleType === "interval" &&
			playlist.scheduleMinutes
		) {
			cronExpression = this.intervalToCron(playlist.scheduleMinutes);
		} else {
			this.logger.warn(
				{ playlistId: playlist.id, playlistName: playlist.name },
				"Invalid schedule configuration",
			);
			return;
		}

		// Create and store the scheduled task
		try {
			const task = new Cron(cronExpression, async () => {
				// Return the promise so callers (and tests) can await completion
				return this.executePlaylistSync(playlist);
			});

			this.tasks.set(playlist.id, task);
			this.logger.info(
				{
					playlistId: playlist.id,
					playlistName: playlist.name,
					cron: cronExpression,
				},
				"Scheduled playlist",
			);
		} catch (error) {
			this.logger.error(
				{
					err: error,
					playlistId: playlist.id,
					playlistName: playlist.name,
					cron: cronExpression,
				},
				"Invalid cron expression",
			);
		}
	}

	/**
	 * Remove a playlist from the schedule
	 */
	unschedulePlaylist(playlistId: string): void {
		const task = this.tasks.get(playlistId);
		if (task) {
			task.stop();
			this.tasks.delete(playlistId);
			this.logger.info({ playlistId }, "Unscheduled playlist");
		}
	}

	/**
	 * Initialize the scheduler by loading all scheduled playlists from the database
	 */
	async initialize(): Promise<void> {
		this.logger.info("Initializing playlist scheduler...");

		// Load spotdl settings (including cookies file)
		await this.loadSpotdlSettings();

		const playlists = await this.getScheduledPlaylists();
		this.logger.info(
			{ count: playlists.length },
			"Found playlists with scheduling enabled",
		);

		for (const playlist of playlists) {
			this.schedulePlaylist(playlist);
		}

		this.logger.info("Playlist scheduler initialized");
	}

	/**
	 * Reload schedules from database (useful when playlists are updated)
	 */
	async reload(): Promise<void> {
		this.logger.info("Reloading playlist schedules...");

		// Reload spotdl settings
		await this.loadSpotdlSettings();

		// Stop all current tasks
		for (const [playlistId] of this.tasks) {
			this.unschedulePlaylist(playlistId);
		}

		// Re-initialize
		await this.initialize();
	}

	/**
	 * Stop all scheduled tasks
	 */
	shutdown(): void {
		this.logger.info("Shutting down playlist scheduler...");
		for (const [playlistId] of this.tasks) {
			this.unschedulePlaylist(playlistId);
		}
		this.logger.info("Playlist scheduler stopped");
	}

	/**
	 * Get the number of scheduled tasks
	 */
	getScheduledCount(): number {
		return this.tasks.size;
	}

	/**
	 * Check if a playlist is currently scheduled
	 */
	isScheduled(playlistId: string): boolean {
		return this.tasks.has(playlistId);
	}

	/**
	 * Check if a playlist is currently running
	 */
	isRunning(playlistId: string): boolean {
		return this.runningPlaylists.has(playlistId);
	}

	/**
	 * Manually trigger a playlist sync
	 * Returns the invocation ID if successful, or null if playlist is already running
	 */
	async triggerManualSync(playlist: PlaylistRow): Promise<string | null> {
		if (this.runningPlaylists.has(playlist.id)) {
			this.logger.warn(
				{ playlistId: playlist.id, playlistName: playlist.name },
				"Playlist is already running, cannot trigger manual sync",
			);
			return null;
		}

		// Execute sync in background (don't await, let it run async)
		this.executePlaylistSync(playlist);

		// Return early - the sync is now running
		// We can't return the invocation ID immediately since it's created inside executePlaylistSync
		// But we can indicate success by returning a truthy value
		return "triggered";
	}
}

// Singleton instance
let schedulerInstance: PlaylistScheduler | null = null;

/**
 * Get or create the singleton scheduler instance
 */
export function getScheduler(logger?: AppLogger): PlaylistScheduler {
	if (!schedulerInstance) {
		schedulerInstance = new PlaylistScheduler(logger);
	}
	return schedulerInstance;
}
