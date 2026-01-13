import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getEventBus } from "./EventBus";
import type {
	PlaylistSyncCompletedEvent,
	PlaylistSyncFailedEvent,
	PlaylistSyncStartedEvent,
} from "./schema";

export type NotifyFunction = (
	playlistName: string,
	error: string,
) => Promise<void>;
export type ReloadFunction = () => Promise<void>;
export type CleanupFunction = (logPath: string) => Promise<void>;

export interface DefaultHandlerOptions {
	reloadFn?: ReloadFunction;
	cleanupFn?: CleanupFunction;
	notifyFn?: NotifyFunction;
	durationWarningThresholdMs?: number;
	logRetentionCount?: number;
}

/**
 * Registry class for managing event handlers.
 * Provides a fluent API for registering handlers and manages their lifecycle.
 */
export class EventHandlerRegistry {
	private readonly logger: AppLogger;
	private readonly unsubscribers: Array<() => void> = [];

	// Metrics state
	private metrics = {
		totalSyncs: 0,
		successfulSyncs: 0,
		failedSyncs: 0,
		totalDuration: 0,
	};

	// Duration tracking
	private startTimes = new Map<string, number>();

	// Log retention tracking
	private playlistLogs = new Map<string, string[]>();

	constructor(logger?: AppLogger) {
		this.logger = logger ?? Logger.get("EventHandlers");
	}

	/**
	 * Register logging handler that logs all events
	 */
	registerLogging(): this {
		const bus = getEventBus();
		const unsubscribe = bus.onAny((event) => {
			this.logger.debug(
				{ id: event.id, payload: event.payload, timestamp: event.timestamp },
				`Event ${event.type}`,
			);
		});
		this.unsubscribers.push(unsubscribe);
		return this;
	}

	/**
	 * Register metrics handler that tracks sync statistics
	 */
	registerMetrics(): this {
		const bus = getEventBus();

		const unsubscribeCompleted = bus.on(
			"playlist.sync.completed",
			(event: PlaylistSyncCompletedEvent) => {
				this.metrics.totalSyncs++;
				this.metrics.successfulSyncs++;
				this.metrics.totalDuration += event.payload.duration;

				this.logger.info(
					{
						total: this.metrics.totalSyncs,
						successRate: (
							(this.metrics.successfulSyncs / this.metrics.totalSyncs) *
							100
						).toFixed(2),
						avgDuration: (
							this.metrics.totalDuration / this.metrics.totalSyncs
						).toFixed(2),
					},
					"Sync stats",
				);
			},
		);

		const unsubscribeFailed = bus.on(
			"playlist.sync.failed",
			(event: PlaylistSyncFailedEvent) => {
				this.metrics.totalSyncs++;
				this.metrics.failedSyncs++;

				this.logger.warn(
					{
						playlist: event.payload.playlistName,
						error: event.payload.error,
						total: this.metrics.totalSyncs,
						successRate: (
							(this.metrics.successfulSyncs / this.metrics.totalSyncs) *
							100
						).toFixed(2),
					},
					"Sync failed",
				);
			},
		);

		this.unsubscribers.push(unsubscribeCompleted, unsubscribeFailed);
		return this;
	}

	/**
	 * Register failure notification handler
	 */
	registerFailureNotification(notifyFn: NotifyFunction): this {
		const bus = getEventBus();
		const unsubscribe = bus.on(
			"playlist.sync.failed",
			async (event: PlaylistSyncFailedEvent) => {
				try {
					await notifyFn(event.payload.playlistName, event.payload.error);
				} catch (notifyError) {
					this.logger.error(
						{ err: notifyError },
						"Failed to send notification",
					);
				}
			},
		);
		this.unsubscribers.push(unsubscribe);
		return this;
	}

	/**
	 * Register scheduler reload handler
	 */
	registerSchedulerReload(reloadFn: ReloadFunction): this {
		const bus = getEventBus();

		const unsubscribeCreated = bus.on("playlist.created", async () => {
			this.logger.info("Playlist created, reloading scheduler");
			await reloadFn();
		});

		const unsubscribeUpdated = bus.on("playlist.updated", async () => {
			this.logger.info("Playlist updated, reloading scheduler");
			await reloadFn();
		});

		const unsubscribeDeleted = bus.on("playlist.deleted", async () => {
			this.logger.info("Playlist deleted, reloading scheduler");
			await reloadFn();
		});

		const unsubscribeReload = bus.on("scheduler.reload", async () => {
			this.logger.info("Explicit reload requested");
			await reloadFn();
		});

		this.unsubscribers.push(
			unsubscribeCreated,
			unsubscribeUpdated,
			unsubscribeDeleted,
			unsubscribeReload,
		);
		return this;
	}

	/**
	 * Register sync duration warning handler
	 */
	registerSyncDurationWarning(thresholdMs = 300000): this {
		const bus = getEventBus();

		const unsubscribeStarted = bus.on(
			"playlist.sync.started",
			(event: PlaylistSyncStartedEvent) => {
				this.startTimes.set(
					event.payload.invocationId,
					event.timestamp.getTime(),
				);
			},
		);

		const unsubscribeCompleted = bus.on(
			"playlist.sync.completed",
			(event: PlaylistSyncCompletedEvent) => {
				this.startTimes.delete(event.payload.invocationId);

				if (event.payload.duration > thresholdMs) {
					this.logger.warn(
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
				this.startTimes.delete(event.payload.invocationId);
			},
		);

		this.unsubscribers.push(
			unsubscribeStarted,
			unsubscribeCompleted,
			unsubscribeFailed,
		);
		return this;
	}

	/**
	 * Register log cleanup handler
	 */
	registerLogCleanup(cleanupFn: CleanupFunction, retentionCount = 5): this {
		const bus = getEventBus();

		const unsubscribe = bus.on(
			"playlist.sync.completed",
			async (event: PlaylistSyncCompletedEvent) => {
				const { playlistId, logPath } = event.payload;

				if (!logPath) {
					return;
				}

				// Track log files per playlist
				if (!this.playlistLogs.has(playlistId)) {
					this.playlistLogs.set(playlistId, []);
				}

				const logs = this.playlistLogs.get(playlistId);
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
							this.logger.info({ logPath: oldLog }, "Deleted old log");
						} catch (error) {
							this.logger.error(
								{ err: error, logPath: oldLog },
								"Failed to delete log",
							);
						}
					}
				}
			},
		);

		this.unsubscribers.push(unsubscribe);
		return this;
	}

	/**
	 * Register all default handlers with provided options
	 */
	registerDefaults(options: DefaultHandlerOptions = {}): this {
		this.registerLogging();
		this.registerMetrics();

		if (options.reloadFn) {
			this.registerSchedulerReload(options.reloadFn);
		}

		if (options.notifyFn) {
			this.registerFailureNotification(options.notifyFn);
		}

		if (options.durationWarningThresholdMs !== undefined) {
			this.registerSyncDurationWarning(options.durationWarningThresholdMs);
		}

		if (options.cleanupFn) {
			this.registerLogCleanup(
				options.cleanupFn,
				options.logRetentionCount ?? 5,
			);
		}

		this.logger.info(
			{ handlerCount: this.unsubscribers.length },
			"Event handlers registered",
		);
		return this;
	}

	/**
	 * Unsubscribe all registered handlers
	 */
	unsubscribeAll(): void {
		for (const unsubscribe of this.unsubscribers) {
			unsubscribe();
		}
		this.unsubscribers.length = 0;
		this.logger.info("All event handlers unsubscribed");
	}

	/**
	 * Get current metrics
	 */
	getMetrics() {
		return { ...this.metrics };
	}
}

// Singleton instance for convenience
let instance: EventHandlerRegistry | null = null;

export function getEventHandlerRegistry(): EventHandlerRegistry {
	if (!instance) {
		instance = new EventHandlerRegistry();
	}
	return instance;
}
