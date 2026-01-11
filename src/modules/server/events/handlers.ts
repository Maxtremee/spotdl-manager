import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getEventBus } from "./EventBus";
import type {
	PlaylistSyncCompletedEvent,
	PlaylistSyncFailedEvent,
	PlaylistSyncStartedEvent,
} from "./schema";

/**
 * Example event handlers for common async job scenarios
 * Register these handlers in your application startup
 */

/**
 * Log all events to console for debugging
 */
export function registerLoggingHandler(
	logger: AppLogger = Logger.get("EventHandlers"),
): () => void {
	const bus = getEventBus();
	return bus.onAny((event) => {
		logger.debug(
			{ id: event.id, payload: event.payload, timestamp: event.timestamp },
			`Event ${event.type}`,
		);
	});
}

/**
 * Track sync metrics and statistics
 */
export function registerMetricsHandler(
	logger: AppLogger = Logger.get("EventHandlers"),
): () => void {
	const bus = getEventBus();
	const metrics = {
		totalSyncs: 0,
		successfulSyncs: 0,
		failedSyncs: 0,
		totalDuration: 0,
	};

	const unsubscribeCompleted = bus.on(
		"playlist.sync.completed",
		(event: PlaylistSyncCompletedEvent) => {
			metrics.totalSyncs++;
			metrics.successfulSyncs++;
			metrics.totalDuration += event.payload.duration;

			logger.info(
				{
					total: metrics.totalSyncs,
					successRate: (
						(metrics.successfulSyncs / metrics.totalSyncs) *
						100
					).toFixed(2),
					avgDuration: (metrics.totalDuration / metrics.totalSyncs).toFixed(2),
				},
				"Sync stats",
			);
		},
	);

	const unsubscribeFailed = bus.on(
		"playlist.sync.failed",
		(event: PlaylistSyncFailedEvent) => {
			metrics.totalSyncs++;
			metrics.failedSyncs++;

			logger.warn(
				{
					playlist: event.payload.playlistName,
					error: event.payload.error,
					total: metrics.totalSyncs,
					successRate: (
						(metrics.successfulSyncs / metrics.totalSyncs) *
						100
					).toFixed(2),
				},
				"Sync failed",
			);
		},
	);

	// Return combined unsubscribe function
	return () => {
		unsubscribeCompleted();
		unsubscribeFailed();
	};
}

/**
 * Send notifications on sync failures
 */
export function registerFailureNotificationHandler(
	notifyFn: (playlistName: string, error: string) => Promise<void>,
	logger: AppLogger = Logger.get("EventHandlers"),
): () => void {
	const bus = getEventBus();
	return bus.on(
		"playlist.sync.failed",
		async (event: PlaylistSyncFailedEvent) => {
			try {
				await notifyFn(event.payload.playlistName, event.payload.error);
			} catch (notifyError) {
				logger.error({ err: notifyError }, "Failed to send notification");
			}
		},
	);
}

/**
 * Reload scheduler when playlists are created/updated/deleted
 */
export function registerSchedulerReloadHandler(
	reloadFn: () => Promise<void>,
	logger: AppLogger = Logger.get("EventHandlers"),
): () => void {
	const bus = getEventBus();

	const unsubscribeCreated = bus.on("playlist.created", async () => {
		logger.info("Playlist created, reloading scheduler");
		await reloadFn();
	});

	const unsubscribeUpdated = bus.on("playlist.updated", async () => {
		logger.info("Playlist updated, reloading scheduler");
		await reloadFn();
	});

	const unsubscribeDeleted = bus.on("playlist.deleted", async () => {
		logger.info("Playlist deleted, reloading scheduler");
		await reloadFn();
	});

	const unsubscribeReload = bus.on("scheduler.reload", async () => {
		logger.info("Explicit reload requested");
		await reloadFn();
	});

	// Return combined unsubscribe function
	return () => {
		unsubscribeCreated();
		unsubscribeUpdated();
		unsubscribeDeleted();
		unsubscribeReload();
	};
}

/**
 * Log sync duration warnings for long-running syncs
 */
export function registerSyncDurationWarningHandler(
	thresholdMs: number = 300000, // 5 minutes default
	logger: AppLogger = Logger.get("EventHandlers"),
): () => void {
	const bus = getEventBus();
	const startTimes = new Map<string, number>();

	const unsubscribeStarted = bus.on(
		"playlist.sync.started",
		(event: PlaylistSyncStartedEvent) => {
			startTimes.set(event.payload.invocationId, event.timestamp.getTime());
		},
	);

	const unsubscribeCompleted = bus.on(
		"playlist.sync.completed",
		(event: PlaylistSyncCompletedEvent) => {
			startTimes.delete(event.payload.invocationId);

			if (event.payload.duration > thresholdMs) {
				logger.warn(
					{
						playlistName: event.payload.playlistName,
						durationMs: event.payload.duration,
					},
					"Long-running sync detected",
				);
			}
		},
	);

	const unsubscribeFailed = bus.on(
		"playlist.sync.failed",
		(event: PlaylistSyncFailedEvent) => {
			startTimes.delete(event.payload.invocationId);
		},
	);

	// Return combined unsubscribe function
	return () => {
		unsubscribeStarted();
		unsubscribeCompleted();
		unsubscribeFailed();
	};
}

/**
 * Cleanup old log files after successful sync
 */
export function registerLogCleanupHandler(
	cleanupFn: (logPath: string) => Promise<void>,
	retentionCount = 5,
	logger: AppLogger = Logger.get("EventHandlers"),
): () => void {
	const bus = getEventBus();
	const playlistLogs = new Map<string, string[]>();

	return bus.on(
		"playlist.sync.completed",
		async (event: PlaylistSyncCompletedEvent) => {
			const { playlistId, logPath } = event.payload;

			if (!logPath) {
				return;
			}

			// Track log files per playlist
			if (!playlistLogs.has(playlistId)) {
				playlistLogs.set(playlistId, []);
			}

			const logs = playlistLogs.get(playlistId);
			if (!logs) {
				return;
			}

			logs.push(logPath);

			// Cleanup old logs if exceeds retention count
			if (logs.length > retentionCount) {
				const oldLogs = logs.splice(0, logs.length - retentionCount);
				for (const oldLog of oldLogs) {
					try {
						await cleanupFn(oldLog);
						logger.info({ logPath: oldLog }, "Deleted old log");
					} catch (error) {
						logger.error(
							{ err: error, logPath: oldLog },
							"Failed to delete log",
						);
					}
				}
			}
		},
	);
}
