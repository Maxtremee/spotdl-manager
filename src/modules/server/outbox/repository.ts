import { randomUUID } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { NewOutboxRow, OutboxRow } from "../db/schema";

/**
 * Repository for outbox pattern operations
 * Handles transactional event storage and delivery tracking
 */
export const OutboxRepository = {
	/**
	 * Insert a new event into the outbox
	 * Should be called within the same transaction as the entity change
	 */
	async insert(
		event: Omit<NewOutboxRow, "id" | "createdAt" | "status" | "retryCount">,
	) {
		const db = getDb();
		const id = randomUUID();

		const row: NewOutboxRow = {
			id,
			aggregateId: event.aggregateId,
			aggregateType: event.aggregateType,
			aggregateVersion: event.aggregateVersion,
			eventType: event.eventType,
			eventPayload: event.eventPayload,
			status: "pending",
			retryCount: 0,
			processingAt: undefined,
			processedAt: undefined,
			lastError: undefined,
		};

		await db.insert(schema.outbox).values(row);
		return id;
	},

	/**
	 * Query pending events ordered by creation time and aggregate version
	 * Used by the processor to fetch next batch of events
	 */
	async queryPending(limit = 100): Promise<OutboxRow[]> {
		const db = getDb();

		return await db
			.select()
			.from(schema.outbox)
			.where(eq(schema.outbox.status, "pending"))
			.orderBy(schema.outbox.createdAt, schema.outbox.aggregateVersion)
			.limit(limit);
	},

	/**
	 * Mark event as processing
	 * Updates status and sets processingAt timestamp
	 */
	async markAsProcessing(id: string) {
		const db = getDb();

		await db
			.update(schema.outbox)
			.set({
				status: "processing",
				processingAt: new Date(),
			})
			.where(eq(schema.outbox.id, id));
	},

	/**
	 * Mark event as processed
	 * Updates status and sets processedAt timestamp
	 */
	async markAsProcessed(id: string) {
		const db = getDb();

		await db
			.update(schema.outbox)
			.set({
				status: "processed",
				processedAt: new Date(),
			})
			.where(eq(schema.outbox.id, id));
	},

	/**
	 * Mark event as failed with error details
	 * Increments retry count and stores error message
	 */
	async markAsFailed(id: string, error: string, retryCount: number) {
		const db = getDb();

		await db
			.update(schema.outbox)
			.set({
				status: "failed",
				lastError: error,
				retryCount,
			})
			.where(eq(schema.outbox.id, id));
	},

	/**
	 * Reset stale processing events to pending
	 * Used by health check to recover from crashes
	 */
	async resetStaleProcessing(staleThresholdMinutes = 10): Promise<number> {
		const db = getDb();
		const thresholdDate = new Date(
			Date.now() - staleThresholdMinutes * 60 * 1000,
		);

		const result = await db
			.update(schema.outbox)
			.set({
				status: "pending",
				processingAt: undefined,
			})
			.where(
				and(
					eq(schema.outbox.status, "processing"),
					lt(schema.outbox.processingAt, thresholdDate),
				),
			);

		return result.changes;
	},

	/**
	 * Query processed events older than retention days
	 * Used by archiver to move old events to archive table
	 */
	async queryForArchival(retentionDays = 14): Promise<OutboxRow[]> {
		const db = getDb();
		const cutoffDate = new Date(
			Date.now() - retentionDays * 24 * 60 * 60 * 1000,
		);

		return await db
			.select()
			.from(schema.outbox)
			.where(
				and(
					eq(schema.outbox.status, "processed"),
					lt(schema.outbox.processedAt, cutoffDate),
				),
			);
	},

	/**
	 * Move events to archive and delete from outbox
	 * Should be called in a transaction
	 */
	async archiveEvents(events: OutboxRow[]): Promise<number> {
		const db = getDb();

		if (events.length === 0) {
			return 0;
		}

		// Insert into archive
		await db.insert(schema.outboxArchive).values(
			events.map((event) => ({
				id: event.id,
				aggregateId: event.aggregateId,
				aggregateType: event.aggregateType,
				aggregateVersion: event.aggregateVersion,
				eventType: event.eventType,
				eventPayload: event.eventPayload,
				createdAt: event.createdAt,
				processingAt: event.processingAt,
				processedAt: event.processedAt,
				status: event.status,
				retryCount: event.retryCount,
				lastError: event.lastError,
				archivedAt: new Date(),
			})),
		);

		// Delete from outbox
		const eventIds = events.map((e) => e.id);
		const result = await db
			.delete(schema.outbox)
			.where(sql`${schema.outbox.id} IN ${eventIds}`);

		return result.changes;
	},

	/**
	 * Get count of events by status for monitoring
	 */
	async getStatusCounts() {
		const db = getDb();

		const result = await db
			.select({
				status: schema.outbox.status,
				count: sql<number>`count(*)`,
			})
			.from(schema.outbox)
			.groupBy(schema.outbox.status);

		return result.reduce(
			(acc, row) => {
				acc[row.status] = Number(row.count);
				return acc;
			},
			{} as Record<string, number>,
		);
	},
};
