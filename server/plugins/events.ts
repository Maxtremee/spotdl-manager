import type { NitroApp } from "nitro/types";
import { getScheduler } from "../../src/modules/server/scheduler/PlaylistScheduler";
import {
	getEventBus,
	registerLoggingHandler,
	registerMetricsHandler,
	registerSchedulerReloadHandler,
	registerSyncDurationWarningHandler,
} from "../../src/modules/server/events";

let initialized = false;

/**
 * Nitro server plugin that initializes the event bus and registers handlers
 * Must run before the scheduler plugin
 */
export default (nitroApp: NitroApp) => {
	if (initialized) {
		return;
	}
	initialized = true;

	const eventBus = getEventBus();

	// Register core event handlers
	console.log("[EventBus Plugin] Registering event handlers...");

	// Log all events in development
	if (process.env.NODE_ENV !== "production") {
		registerLoggingHandler();
		console.log("[EventBus Plugin] ✓ Logging handler registered");
	}

	// Track metrics
	registerMetricsHandler();
	console.log("[EventBus Plugin] ✓ Metrics handler registered");

	// Auto-reload scheduler on playlist changes
	const scheduler = getScheduler();
	registerSchedulerReloadHandler(async () => {
		await scheduler.reload();
	});
	console.log("[EventBus Plugin] ✓ Scheduler reload handler registered");

	// Warn on long-running syncs (5 minutes threshold)
	registerSyncDurationWarningHandler(300000);
	console.log("[EventBus Plugin] ✓ Sync duration warning handler registered");

	// Example: Register failure notification handler if webhook URL is configured
	// const webhookUrl = process.env.FAILURE_WEBHOOK_URL;
	// if (webhookUrl) {
	// 	registerFailureNotificationHandler(async (playlistName, error) => {
	// 		await fetch(webhookUrl, {
	// 			method: "POST",
	// 			headers: { "Content-Type": "application/json" },
	// 			body: JSON.stringify({ playlistName, error, timestamp: new Date() }),
	// 		});
	// 	});
	// 	console.log("[EventBus Plugin] ✓ Failure notification handler registered");
	// }

	console.log(
		`[EventBus Plugin] Event bus initialized with ${eventBus.getHandlerCount()} handlers`,
	);

	// Cleanup on server close
	nitroApp.hooks.hook("close", () => {
		console.log("[EventBus Plugin] Clearing event bus handlers...");
		eventBus.clear();
	});
};
