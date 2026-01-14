import { Logger } from "~/logger";
import type { EventBus } from "../events/EventBus";
import type { Event } from "../events/schema";
import { OutboxRepository } from "./repository";

const logger = Logger.get("OutboxProcessor");

/**
 * Configuration for the outbox processor
 */
export interface OutboxProcessorConfig {
	pollIntervalMs?: number; // Default: 250ms
	batchSize?: number; // Default: 100
	maxRetries?: number; // Default: 3
	baseRetryDelayMs?: number; // Default: 1000ms (1 second)
}

/**
 * Outbox processor for reliable event delivery
 * Polls for pending events, emits them to the event bus, and handles retries
 */
export class OutboxProcessor {
	private intervalHandle: NodeJS.Timeout | null = null;
	private isProcessing = false;
	private isShuttingDown = false;

	private readonly pollIntervalMs: number;
	private readonly batchSize: number;
	private readonly maxRetries: number;
	private readonly baseRetryDelayMs: number;

	constructor(
		private readonly eventBus: EventBus,
		config: OutboxProcessorConfig = {},
	) {
		this.pollIntervalMs = config.pollIntervalMs ?? 250;
		this.batchSize = config.batchSize ?? 100;
		this.maxRetries = config.maxRetries ?? 3;
		this.baseRetryDelayMs = config.baseRetryDelayMs ?? 1000;
	}

	/**
	 * Start the processor
	 * Begins polling for pending events at the configured interval
	 */
	start(): void {
		if (this.intervalHandle) {
			logger.warn("Processor already started");
			return;
		}

		logger.info(
			{
				pollIntervalMs: this.pollIntervalMs,
				batchSize: this.batchSize,
				maxRetries: this.maxRetries,
			},
			"Starting outbox processor",
		);

		this.intervalHandle = setInterval(() => {
			this.processBatch().catch((error) => {
				logger.error({ error }, "Error in processor batch");
			});
		}, this.pollIntervalMs);

		// Process immediately on start
		this.processBatch().catch((error) => {
			logger.error({ error }, "Error in initial processor batch");
		});
	}

	/**
	 * Stop the processor gracefully
	 * Waits for current batch to complete
	 */
	async stop(): Promise<void> {
		if (!this.intervalHandle) {
			logger.warn("Processor not started");
			return;
		}

		logger.info("Stopping outbox processor");
		this.isShuttingDown = true;

		// Clear interval
		clearInterval(this.intervalHandle);
		this.intervalHandle = null;

		// Wait for current batch to complete
		while (this.isProcessing) {
			await new Promise((resolve) => setTimeout(resolve, 100));
		}

		logger.info("Outbox processor stopped");
	}

	/**
	 * Process a batch of pending events
	 * Fetches events, emits them, and handles success/failure
	 */
	private async processBatch(): Promise<void> {
		if (this.isProcessing || this.isShuttingDown) {
			return;
		}

		this.isProcessing = true;

		try {
			// Fetch pending events ordered by creation time and aggregate version
			const events = await OutboxRepository.queryPending(this.batchSize);

			if (events.length === 0) {
				return;
			}

			logger.debug(`Processing batch of ${events.length} events`);

			// Process each event individually to maintain ordering
			for (const event of events) {
				if (this.isShuttingDown) {
					logger.info("Shutdown requested, stopping batch processing");
					break;
				}

				await this.processEvent(event);
			}
		} catch (error) {
			logger.error({ error }, "Error processing batch");
		} finally {
			this.isProcessing = false;
		}
	}

	/**
	 * Process a single event
	 * Marks as processing, emits to event bus, and marks as processed or failed
	 */
	private async processEvent(
		outboxEvent: Awaited<ReturnType<typeof OutboxRepository.queryPending>>[0],
	): Promise<void> {
		try {
			// Mark as processing
			await OutboxRepository.markAsProcessing(outboxEvent.id);

			// Deserialize event payload
			const event = this.deserializeEvent(outboxEvent);

			// Emit to event bus
			await this.eventBus.emit(event);

			// Mark as processed
			await OutboxRepository.markAsProcessed(outboxEvent.id);

			logger.debug(
				{
					eventType: outboxEvent.eventType,
					aggregateId: outboxEvent.aggregateId,
					aggregateVersion: outboxEvent.aggregateVersion,
				},
				`Successfully processed event ${outboxEvent.id}`,
			);
		} catch (error) {
			await this.handleEventError(outboxEvent, error);
		}
	}

	/**
	 * Handle event processing error
	 * Implements exponential backoff retry logic
	 */
	private async handleEventError(
		outboxEvent: Awaited<ReturnType<typeof OutboxRepository.queryPending>>[0],
		error: unknown,
	): Promise<void> {
		const newRetryCount = outboxEvent.retryCount + 1;
		const errorMessage = error instanceof Error ? error.message : String(error);

		logger.warn(
			{
				eventType: outboxEvent.eventType,
				error: errorMessage,
			},
			`Event ${outboxEvent.id} failed (attempt ${newRetryCount}/${this.maxRetries})`,
		);

		if (newRetryCount >= this.maxRetries) {
			// Max retries exceeded, mark as failed
			await OutboxRepository.markAsFailed(
				outboxEvent.id,
				errorMessage,
				newRetryCount,
			);

			logger.error(
				{
					eventType: outboxEvent.eventType,
					aggregateId: outboxEvent.aggregateId,
					error: errorMessage,
				},
				`Event ${outboxEvent.id} failed permanently after ${newRetryCount} attempts`,
			);
		} else {
			// Retry with exponential backoff
			const delayMs = this.baseRetryDelayMs * 2 ** outboxEvent.retryCount;

			logger.debug(`Will retry event ${outboxEvent.id} after ${delayMs}ms`);

			await new Promise((resolve) => setTimeout(resolve, delayMs));

			// Reset to pending for retry
			await OutboxRepository.markAsFailed(
				outboxEvent.id,
				errorMessage,
				newRetryCount,
			);
		}
	}

	/**
	 * Deserialize event from outbox row
	 * Reconstructs the full event object with proper types
	 */
	private deserializeEvent(
		outboxEvent: Awaited<ReturnType<typeof OutboxRepository.queryPending>>[0],
	): Event {
		// The payload is already parsed as JSON by Drizzle
		const payload = outboxEvent.eventPayload as Record<string, unknown>;

		// Reconstruct event with metadata
		return {
			type: outboxEvent.eventType as Event["type"],
			id: outboxEvent.id,
			timestamp: new Date(outboxEvent.createdAt),
			payload,
		} as Event;
	}

	/**
	 * Get processor status for health checks
	 */
	getStatus() {
		return {
			isRunning: this.intervalHandle !== null,
			isProcessing: this.isProcessing,
			isShuttingDown: this.isShuttingDown,
			config: {
				pollIntervalMs: this.pollIntervalMs,
				batchSize: this.batchSize,
				maxRetries: this.maxRetries,
			},
		};
	}
}
