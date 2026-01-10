import type { NitroApp } from "nitro/types";
import { getScheduler } from "../../src/modules/server/scheduler/PlaylistScheduler";

let initialized = false;

/**
 * Nitro server plugin that initializes the playlist scheduler on startup.
 * Reads all playlists with scheduling enabled and registers cron jobs.
 */
export default (nitroApp: NitroApp) => {
	const scheduler = getScheduler();

	// Initialize scheduler asynchronously after plugin loads
	// This runs once when the server starts
	if (!initialized) {
		initialized = true;
		scheduler.initialize().catch((error) => {
			console.error("[Scheduler Plugin] Failed to initialize scheduler:", error);
		});
	}

	// Cleanup on server close
	nitroApp.hooks.hook("close", () => {
		scheduler.shutdown();
	});
};
