import type { NitroApp } from "nitro/types";
import { getScheduler } from "../../src/modules/server/scheduler/PlaylistScheduler";
import {
	getEventBus,
	registerLoggingHandler,
	registerMetricsHandler,
	registerSchedulerReloadHandler,
	registerSyncDurationWarningHandler,
} from "../../src/modules/server/events";
import { registerDiscordWebhookHandler } from "../../src/modules/server/webhooks";
import { registerDownloadHandler } from "../../src/modules/server/downloader";
import { Logger } from "../../src/logger";

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

	const pluginLogger = Logger.get("EventBusPlugin");
	const eventHandlerLogger = Logger.get("EventHandlers");
	const schedulerLogger = Logger.get("PlaylistScheduler");
	const eventBus = getEventBus();

	// Register core event handlers
	pluginLogger.info("Registering event handlers...");

	// Log all events in development
	if (process.env.NODE_ENV !== "production") {
		registerLoggingHandler(eventHandlerLogger);
		pluginLogger.info("Logging handler registered");
	}

	// Track metrics
	registerMetricsHandler(eventHandlerLogger);
	pluginLogger.info("Metrics handler registered");

	// Auto-reload scheduler on playlist changes
	const scheduler = getScheduler({ logger: schedulerLogger });
	registerSchedulerReloadHandler(async () => {
		await scheduler.reload();
	});
	pluginLogger.info("Scheduler reload handler registered");

	// Warn on long-running syncs (5 minutes threshold)
	registerSyncDurationWarningHandler(300000, eventHandlerLogger);
	pluginLogger.info("Sync duration warning handler registered");

	// Discord webhook handler (reads settings from DB on each event)
	registerDiscordWebhookHandler(eventHandlerLogger);
	pluginLogger.info("Discord webhook handler registered");

	// Download handler — subscribes to playlist.sync.completed and kicks DownloadRunner (D-01)
	registerDownloadHandler(eventHandlerLogger);
	pluginLogger.info("Download handler registered");

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
	//  console.log("Failure notification handler registered");
	// }

	pluginLogger.info(
		`Event bus initialized with ${eventBus.getHandlerCount()} handlers`,
	);

	// Cleanup on server close
	nitroApp.hooks.hook("close", () => {
		pluginLogger.info("Clearing event bus handlers...");
		eventBus.clear();
	});
};
