import { Logger } from "~/logger";
import { OutboxRepository } from "~/modules/server/outbox";
import { getDb, schema } from "~/modules/server/db";
import { and, eq, lt } from "drizzle-orm";

const logger = Logger.get("OutboxHealthCheck");

/**
 * Startup health check plugin for outbox pattern crash recovery
 *
 * Runs BEFORE other plugins to recover from crashes:
 * 1. Resets stale "processing" events to "pending"
 * 2. Marks stale "running" invocations as "failed"
 *
 * Named with "00-" prefix to ensure it loads first
 */
export default defineNitroPlugin(async (nitroApp) => {
	logger.info("Running outbox health check");

	try {
		// 1. Reset stale processing events (older than 10 minutes)
		const staleProcessingCount = await OutboxRepository.resetStaleProcessing(10);

		if (staleProcessingCount > 0) {
			logger.warn({
				thresholdMinutes: 10,
				staleProcessingCount,
			}, `Reset ${staleProcessingCount} stale processing events to pending`);
		}

		// 2. Mark stale running invocations as failed (older than 10 minutes)
		const staleInvocationCount = await resetStaleInvocations(10);

		if (staleInvocationCount > 0) {
			logger.warn({
				thresholdMinutes: 10,
				staleInvocationCount,
			}, `Marked ${staleInvocationCount} stale running invocations as failed`);
		}

		if (staleProcessingCount === 0 && staleInvocationCount === 0) {
			logger.info("Health check passed: no stale events or invocations");
		}
	} catch (error) {
		// Log error but don't crash - allow server to start
		logger.error({ error }, "Health check failed, but allowing server to start");
	}

	logger.info("Outbox health check complete");
});

/**
 * Reset stale running invocations to failed status
 * Helps recover from scheduler crashes
 */
async function resetStaleInvocations(staleThresholdMinutes: number): Promise<number> {
	const db = getDb();
	const thresholdDate = new Date(Date.now() - staleThresholdMinutes * 60 * 1000);

	const result = await db
		.update(schema.invocations)
		.set({
			status: "failed",
			finishedAt: new Date(),
			exitCode: -1,
		})
		.where(
			and(
				eq(schema.invocations.status, "running"),
				lt(schema.invocations.startedAt, thresholdDate)
			)
		);

	return result.changes;
}
