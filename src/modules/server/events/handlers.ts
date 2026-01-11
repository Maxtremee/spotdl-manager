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
export function registerLoggingHandler(): () => void {
	const bus = getEventBus();
	return bus.onAny((event) => {
		console.log(`[EventBus] ${event.type}:`, {
			id: event.id,
			timestamp: event.timestamp,
			payload: event.payload,
		});
	});
}

/**
 * Track sync metrics and statistics
 */
export function registerMetricsHandler(): () => void {
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

			console.log("[Metrics] Sync stats:", {
				total: metrics.totalSyncs,
				successRate: (
					(metrics.successfulSyncs / metrics.totalSyncs) *
					100
				).toFixed(2),
				avgDuration: (metrics.totalDuration / metrics.totalSyncs).toFixed(2),
			});
		},
	);

	const unsubscribeFailed = bus.on(
		"playlist.sync.failed",
		(event: PlaylistSyncFailedEvent) => {
			metrics.totalSyncs++;
			metrics.failedSyncs++;

			console.log("[Metrics] Sync failed:", {
				playlist: event.payload.playlistName,
				error: event.payload.error,
				total: metrics.totalSyncs,
				successRate: (
					(metrics.successfulSyncs / metrics.totalSyncs) *
					100
				).toFixed(2),
			});
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
): () => void {
	const bus = getEventBus();
	return bus.on(
		"playlist.sync.failed",
		async (event: PlaylistSyncFailedEvent) => {
			try {
				await notifyFn(event.payload.playlistName, event.payload.error);
			} catch (notifyError) {
				console.error(
					"[FailureNotification] Failed to send notification:",
					notifyError,
				);
			}
		},
	);
}

/**
 * Reload scheduler when playlists are created/updated/deleted
 */
export function registerSchedulerReloadHandler(
	reloadFn: () => Promise<void>,
): () => void {
	const bus = getEventBus();

	const unsubscribeCreated = bus.on("playlist.created", async () => {
		console.log("[SchedulerReload] Playlist created, reloading scheduler");
		await reloadFn();
	});

	const unsubscribeUpdated = bus.on("playlist.updated", async () => {
		console.log("[SchedulerReload] Playlist updated, reloading scheduler");
		await reloadFn();
	});

	const unsubscribeDeleted = bus.on("playlist.deleted", async () => {
		console.log("[SchedulerReload] Playlist deleted, reloading scheduler");
		await reloadFn();
	});

	const unsubscribeReload = bus.on("scheduler.reload", async () => {
		console.log("[SchedulerReload] Explicit reload requested");
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
				console.warn(
					`[SyncDuration] Long-running sync detected for playlist "${event.payload.playlistName}": ${(event.payload.duration / 1000).toFixed(2)}s`,
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
						console.log(`[LogCleanup] Deleted old log: ${oldLog}`);
					} catch (error) {
						console.error(
							`[LogCleanup] Failed to delete log ${oldLog}:`,
							error,
						);
					}
				}
			}
		},
	);
}
