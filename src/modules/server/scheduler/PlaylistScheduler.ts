import { randomUUID } from "node:crypto";
import { Cron } from "croner";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { PlaylistRow } from "../db/schema";
import { InvocationRepository } from "../invocation/repository";
import { SpotdlInvocator } from "../spotdl/SpotdlInvocator";

/**
 * Manages scheduled playlist sync jobs using croner.
 * Handles both cron-based and interval-based scheduling.
 */
export class PlaylistScheduler {
	private readonly tasks: Map<string, Cron> = new Map();
	private readonly invocator: SpotdlInvocator;
	private readonly runningPlaylists: Set<string> = new Set();

	constructor() {
		this.invocator = new SpotdlInvocator();
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
			console.log(
				`[Scheduler] Playlist "${playlist.name}" (${playlist.id}) is already running, skipping`,
			);
			return;
		}

		this.runningPlaylists.add(playlist.id);
		const invocationId = randomUUID();
		const startedAt = new Date();
		let createPromise: Promise<unknown> | null = null;

		console.log(
			`[Scheduler] Starting scheduled sync for playlist "${playlist.name}" (${playlist.id})`,
		);

		try {
			createPromise = InvocationRepository.create({
				id: invocationId,
				playlistId: playlist.id,
				startedAt,
				status: "running",
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

			console.log(
				`[Scheduler] Completed sync for playlist "${playlist.name}" (${playlist.id}) with status: ${result.status}`,
			);
		} catch (error) {
			console.error(
				`[Scheduler] Error syncing playlist "${playlist.name}" (${playlist.id}):`,
				error,
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
			console.warn(
				`[Scheduler] Playlist "${playlist.name}" (${playlist.id}) has invalid schedule configuration`,
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
			console.log(
				`[Scheduler] Scheduled playlist "${playlist.name}" (${playlist.id}) with cron: ${cronExpression}`,
			);
		} catch (error) {
			console.error(
				`[Scheduler] Invalid cron expression "${cronExpression}" for playlist "${playlist.name}" (${playlist.id})`,
				error,
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
			console.log(`[Scheduler] Unscheduled playlist ${playlistId}`);
		}
	}

	/**
	 * Initialize the scheduler by loading all scheduled playlists from the database
	 */
	async initialize(): Promise<void> {
		console.log("[Scheduler] Initializing playlist scheduler...");

		const playlists = await this.getScheduledPlaylists();
		console.log(
			`[Scheduler] Found ${playlists.length} playlist(s) with scheduling enabled`,
		);

		for (const playlist of playlists) {
			this.schedulePlaylist(playlist);
		}

		console.log("[Scheduler] Playlist scheduler initialized");
	}

	/**
	 * Reload schedules from database (useful when playlists are updated)
	 */
	async reload(): Promise<void> {
		console.log("[Scheduler] Reloading playlist schedules...");

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
		console.log("[Scheduler] Shutting down playlist scheduler...");
		for (const [playlistId] of this.tasks) {
			this.unschedulePlaylist(playlistId);
		}
		console.log("[Scheduler] Playlist scheduler stopped");
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
}

// Singleton instance
let schedulerInstance: PlaylistScheduler | null = null;

/**
 * Get or create the singleton scheduler instance
 */
export function getScheduler(): PlaylistScheduler {
	if (!schedulerInstance) {
		schedulerInstance = new PlaylistScheduler();
	}
	return schedulerInstance;
}
