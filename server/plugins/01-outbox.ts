import { Logger } from "~/logger";
import { OutboxProcessor } from "~/modules/server/outbox";
import { getEventBus } from "~/modules/server/events";

const logger = Logger.get("OutboxPlugin");

let processor: OutboxProcessor | null = null;

/**
 * Outbox processor plugin
 *
 * Initializes and starts the outbox processor for reliable event delivery.
 * Registers shutdown hook for graceful cleanup.
 *
 * Named with "01-" prefix to ensure it loads after health check but before other plugins
 */
export default defineNitroPlugin(async (nitroApp) => {
	logger.info("Initializing outbox processor");

	try {
		// Get event bus instance
		const eventBus = getEventBus();

		// Create processor with default config
		processor = new OutboxProcessor(eventBus, {
			pollIntervalMs: 250,
			batchSize: 100,
			maxRetries: 3,
			baseRetryDelayMs: 1000,
		});

		// Start processing
		processor.start();

		const status = processor.getStatus();
		logger.info({
			config: status.config,
		}, "Outbox processor started");

		// Register cleanup hook for graceful shutdown
		nitroApp.hooks.hook("close", async () => {
			logger.info("Shutting down outbox processor");

			if (processor) {
				await processor.stop();
				processor = null;
			}

			logger.info("Outbox processor shutdown complete");
		});
	} catch (error) {
		logger.error({ error }, "Failed to initialize outbox processor");
		throw error;
	}
});

/**
 * Helper to get the processor instance
 * Useful for health checks or monitoring
 */
export function getOutboxProcessor(): OutboxProcessor | null {
	return processor;
}
