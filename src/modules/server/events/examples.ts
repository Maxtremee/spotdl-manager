/**
 * Example: Custom Event Handler for Webhook Notifications
 *
 * This example shows how to create a custom handler that sends
 * webhook notifications when playlists fail to sync.
 */

import { getEventBus } from "~/modules/server/events";

/**
 * Send webhook notification on sync failure
 * Can be registered in server/plugins/events.ts or a custom plugin
 */
export function setupWebhookNotifications() {
	const bus = getEventBus();
	const webhookUrl = process.env.WEBHOOK_URL;

	if (!webhookUrl) {
		console.log("Webhook: WEBHOOK_URL not configured, skipping");
		return;
	}

	console.log(`Webhook: Registering failure notifications to ${webhookUrl}`);

	// Track consecutive failures
	const failureCount = new Map<string, number>();
	const FAILURE_THRESHOLD = 3;

	// Listen for sync failures
	const unsubscribe = bus.on("playlist.sync.failed", async (event) => {
		const { playlistId, playlistName, error, invocationId } = event.payload;

		// Increment failure count
		const count = (failureCount.get(playlistId) || 0) + 1;
		failureCount.set(playlistId, count);

		// Determine severity based on consecutive failures
		const severity = count >= FAILURE_THRESHOLD ? "critical" : "warning";

		try {
			// Send webhook
			const response = await fetch(webhookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"X-Event-Type": "playlist.sync.failed",
					"X-Event-Id": event.id,
				},
				body: JSON.stringify({
					event: "playlist.sync.failed",
					severity,
					timestamp: event.timestamp,
					playlist: {
						id: playlistId,
						name: playlistName,
					},
					failure: {
						error,
						invocationId,
						consecutiveFailures: count,
					},
				}),
			});

			if (response.ok) {
				console.log(
					`Webhook notification sent for playlist "${playlistName}" (${severity})`,
				);
			} else {
				console.error(
					`Failed to send webhook notification: ${response.status} ${response.statusText}`,
				);
			}
		} catch (fetchError) {
			console.error("Error sending webhook notification:", fetchError);
		}

		// Suggest action if threshold exceeded
		if (count >= FAILURE_THRESHOLD) {
			console.error(
				`🚨 Playlist "${playlistName}" has failed ${count} times consecutively!`,
			);
			console.error(
				"Consider disabling the playlist or checking the source URL.",
			);
		}
	});

	// Reset failure count on success
	bus.on("playlist.sync.completed", (event) => {
		failureCount.delete(event.payload.playlistId);
	});

	// Return cleanup function
	return unsubscribe;
}

/**
 * Example: Custom Event Handler for Metrics Export
 *
 * Export metrics to Prometheus or similar monitoring system
 */
export function setupMetricsExport() {
	const bus = getEventBus();

	// In-memory metrics (in production, use a proper metrics library)
	const metrics = {
		syncsStarted: 0,
		syncsCompleted: 0,
		syncsFailed: 0,
		totalDuration: 0,
		longestSync: 0,
	};

	bus.on("playlist.sync.started", () => {
		metrics.syncsStarted++;
	});

	bus.on("playlist.sync.completed", (event) => {
		metrics.syncsCompleted++;
		metrics.totalDuration += event.payload.duration;
		metrics.longestSync = Math.max(metrics.longestSync, event.payload.duration);
	});

	bus.on("playlist.sync.failed", () => {
		metrics.syncsFailed++;
	});

	// Expose metrics endpoint (pseudo-code)
	// app.get('/metrics', (req, res) => {
	//   res.send(`
	//     spotdl_syncs_started_total ${metrics.syncsStarted}
	//     spotdl_syncs_completed_total ${metrics.syncsCompleted}
	//     spotdl_syncs_failed_total ${metrics.syncsFailed}
	//     spotdl_sync_duration_seconds_sum ${metrics.totalDuration / 1000}
	//     spotdl_sync_duration_seconds_max ${metrics.longestSync / 1000}
	//   `);
	// });

	return () => {
		// Cleanup if needed
	};
}

/**
 * Example: Custom Event Handler for Audit Log
 *
 * Write all events to an audit log file for compliance/debugging
 */
export function setupAuditLog() {
	const bus = getEventBus();
	// const auditLogPath = path.join(process.cwd(), 'logs', 'audit.log');

	// Listen to all events
	const unsubscribe = bus.onAny(async (event) => {
		const logEntry = {
			eventId: event.id,
			eventType: event.type,
			timestamp: event.timestamp.toISOString(),
			payload: event.payload,
		};

		// In production, use a proper logging library
		console.log("Audit", JSON.stringify(logEntry));

		// Or write to file:
		// await fs.appendFile(
		//   auditLogPath,
		//   JSON.stringify(logEntry) + '\n',
		//   'utf-8'
		// );
	});

	return unsubscribe;
}

/**
 * Example: Custom Event Handler for Real-time UI Updates
 *
 * Send events to connected WebSocket clients for live dashboard updates
 */
export function setupWebSocketBroadcast(/* wsServer: WebSocketServer */) {
	const bus = getEventBus();

	// Listen to sync-related events
	const unsubscribeStarted = bus.on("playlist.sync.started", (_event) => {
		// wsServer.broadcast({
		//   type: 'sync_started',
		//   playlistId: event.payload.playlistId,
		//   playlistName: event.payload.playlistName,
		// });
		console.log("Would broadcast: sync_started");
	});

	const unsubscribeCompleted = bus.on("playlist.sync.completed", (_event) => {
		// wsServer.broadcast({
		//   type: 'sync_completed',
		//   playlistId: event.payload.playlistId,
		//   duration: event.payload.duration,
		// });
		console.log("Would broadcast: sync_completed");
	});

	// Return combined cleanup
	return () => {
		unsubscribeStarted();
		unsubscribeCompleted();
	};
}

/**
 * Example: Automatic Retry Handler
 *
 * Automatically retry failed syncs with exponential backoff
 */
export function setupAutoRetry(/* scheduler: PlaylistScheduler */) {
	const bus = getEventBus();
	const retryAttempts = new Map<string, number>();
	const MAX_RETRIES = 3;
	const BASE_DELAY = 60000; // 1 minute

	const unsubscribe = bus.on("playlist.sync.failed", async (event) => {
		const { playlistId, playlistName } = event.payload;
		const attempts = (retryAttempts.get(playlistId) || 0) + 1;

		if (attempts <= MAX_RETRIES) {
			retryAttempts.set(playlistId, attempts);
			const delay = BASE_DELAY * 2 ** (attempts - 1); // Exponential backoff

			console.log(
				`Scheduling retry ${attempts}/${MAX_RETRIES} for "${playlistName}" in ${delay / 1000}s`,
			);

			setTimeout(() => {
				// scheduler.executePlaylist(playlistId);
				console.log(`Retrying "${playlistName}"`);
			}, delay);
		} else {
			console.error(`Max retries exceeded for "${playlistName}", giving up`);
			retryAttempts.delete(playlistId);
		}
	});

	// Reset retry count on success
	bus.on("playlist.sync.completed", (event) => {
		retryAttempts.delete(event.payload.playlistId);
	});

	return unsubscribe;
}
