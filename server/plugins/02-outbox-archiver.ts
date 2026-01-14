import { Cron } from "croner";
import { Logger } from "~/logger";
import { OutboxRepository } from "~/modules/server/outbox";

const logger = Logger.get("OutboxArchiver");

let cronJob: Cron | null = null;

/**
 * Outbox archiver plugin
 *
 * Runs a daily cron job (2 AM) to archive processed events older than 14 days.
 * Moves events from outbox to outbox_archive table and deletes from outbox.
 *
 * Named with "02-" prefix to load after outbox processor
 */
export default defineNitroPlugin(async (nitroApp) => {
	logger.info("Initializing outbox archiver");

	try {
		// Schedule daily archival at 2 AM
		cronJob = new Cron("0 2 * * *", {
			name: "outbox-archiver",
			timezone: "UTC",
		}, async () => {
			await runArchival();
		});

		logger.info({
			schedule: "0 2 * * * (daily at 2 AM UTC)",
			retentionDays: 14,
		}, "Outbox archiver scheduled");

		// Register cleanup hook
		nitroApp.hooks.hook("close", () => {
			logger.info("Stopping outbox archiver");

			if (cronJob) {
				cronJob.stop();
				cronJob = null;
			}

			logger.info("Outbox archiver stopped");
		});
	} catch (error) {
		logger.error({ error }, "Failed to initialize outbox archiver");
		throw error;
	}
});

/**
 * Run the archival process
 * Queries for old processed events and moves them to archive
 */
async function runArchival(): Promise<void> {
	const startTime = Date.now();
	logger.info("Starting outbox archival");

	try {
		// Query for processed events older than 14 days
		const eventsToArchive = await OutboxRepository.queryForArchival(14);

		if (eventsToArchive.length === 0) {
			logger.info("No events to archive");
			return;
		}

		logger.info(`Found ${eventsToArchive.length} events to archive`);

		// Archive events (moves to archive table and deletes from outbox)
		const archivedCount = await OutboxRepository.archiveEvents(eventsToArchive);

		const duration = Date.now() - startTime;

		logger.info({
			archivedCount,
			durationMs: duration,
			retentionDays: 14,
		}, "Outbox archival completed");

		// Log event type breakdown for monitoring
		const eventTypes = eventsToArchive.reduce((acc, event) => {
			acc[event.eventType] = (acc[event.eventType] || 0) + 1;
			return acc;
		}, {} as Record<string, number>);

		logger.debug({ eventTypes }, "Archived event types");
	} catch (error) {
		logger.error({ error }, "Outbox archival failed");
		// Don't throw - allow next scheduled run to retry
	}
}

/**
 * Helper to manually trigger archival (for testing or manual cleanup)
 */
export async function triggerArchival(): Promise<void> {
	await runArchival();
}
