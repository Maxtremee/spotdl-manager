import type { NitroApp } from "nitro/types";
import { getScheduler } from "../../src/modules/server/scheduler/PlaylistScheduler";
import { Logger } from "../../src/logger";

let initialized = false;

/**
 * Nitro server plugin that initializes the playlist scheduler on startup.
 * Reads all playlists with scheduling enabled and registers cron jobs.
 */
export default (nitroApp: NitroApp) => {
	const pluginLogger = Logger.get("SchedulerPlugin");
	const schedulerLogger = Logger.get("PlaylistScheduler");
	const scheduler = getScheduler({ logger: schedulerLogger });

	// Initialize scheduler asynchronously after plugin loads
	// This runs once when the server starts
	if (!initialized) {
		initialized = true;
		scheduler.initialize().catch((error) => {
			pluginLogger.error(
				{ err: error },
				"Failed to initialize scheduler",
			);
		});
	}

	// Cleanup on server close
	nitroApp.hooks.hook("close", () => {
		scheduler.shutdown();
	});
};
