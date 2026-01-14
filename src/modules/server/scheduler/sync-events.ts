import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { NewInvocationRow } from "../db/schema";
import type {
	PlaylistSyncCanceledEvent,
	PlaylistSyncCompletedEvent,
	PlaylistSyncFailedEvent,
	PlaylistSyncStartedEvent,
} from "../events/schema";

/**
 * Emit sync.started event with outbox pattern
 * Creates invocation and outbox event in a single transaction
 */
export async function emitSyncStarted(params: {
	invocationId: string;
	playlistId: string;
	playlistName: string;
	sourceUrl: string;
	outputDir: string;
	startedAt: Date;
	logPath: string;
}): Promise<void> {
	const db = getDb();

	db.transaction((tx) => {
		// 1. Get playlist to read current version
		const [playlist] = tx
			.select()
			.from(schema.playlists)
			.where(eq(schema.playlists.id, params.playlistId));

		if (!playlist) {
			throw new Error(`Playlist ${params.playlistId} not found`);
		}

		// 2. Create invocation record
		const invocation: NewInvocationRow = {
			id: params.invocationId,
			playlistId: params.playlistId,
			startedAt: params.startedAt,
			status: "running",
			logPath: params.logPath,
		};

		tx.insert(schema.invocations).values(invocation);

		// 3. Write outbox event
		const eventPayload: PlaylistSyncStartedEvent["payload"] = {
			playlistId: params.playlistId,
			playlistName: params.playlistName,
			invocationId: params.invocationId,
			sourceUrl: params.sourceUrl,
			outputDir: params.outputDir,
		};

		tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: params.invocationId,
			aggregateType: "invocation",
			aggregateVersion: 1, // First version for new invocation
			eventType: "playlist.sync.started",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}

/**
 * Emit sync.completed event with outbox pattern
 * Updates invocation and outbox event in a single transaction
 */
export async function emitSyncCompleted(params: {
	invocationId: string;
	playlistId: string;
	playlistName: string;
	finishedAt: Date;
	startedAt: Date;
	exitCode: number;
	summary?: string;
	logPath?: string;
	syncFilePath?: string;
}): Promise<void> {
	const db = getDb();

	db.transaction((tx) => {
		// 1. Update invocation record
		tx.update(schema.invocations)
			.set({
				finishedAt: params.finishedAt,
				exitCode: params.exitCode,
				status: "success",
				summary: params.summary,
				logPath: params.logPath,
				syncFilePath: params.syncFilePath,
			})
			.where(eq(schema.invocations.id, params.invocationId));

		// 2. Write outbox event
		const duration = params.finishedAt.getTime() - params.startedAt.getTime();

		const eventPayload: PlaylistSyncCompletedEvent["payload"] = {
			playlistId: params.playlistId,
			playlistName: params.playlistName,
			invocationId: params.invocationId,
			duration,
			exitCode: params.exitCode,
			summary: params.summary,
			logPath: params.logPath,
			syncFilePath: params.syncFilePath,
		};

		tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: params.invocationId,
			aggregateType: "invocation",
			aggregateVersion: 2, // Completion is version 2 (after started)
			eventType: "playlist.sync.completed",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}

/**
 * Emit sync.failed event with outbox pattern
 * Updates invocation and outbox event in a single transaction
 */
export async function emitSyncFailed(params: {
	invocationId: string;
	playlistId: string;
	playlistName: string;
	error: string;
	exitCode?: number;
	logPath?: string;
}): Promise<void> {
	const db = getDb();

	db.transaction((tx) => {
		// 1. Update invocation record
		tx.update(schema.invocations)
			.set({
				finishedAt: new Date(),
				exitCode: params.exitCode ?? -1,
				status: "failed",
				summary: params.error,
				logPath: params.logPath,
			})
			.where(eq(schema.invocations.id, params.invocationId));

		// 2. Write outbox event
		const eventPayload: PlaylistSyncFailedEvent["payload"] = {
			playlistId: params.playlistId,
			playlistName: params.playlistName,
			invocationId: params.invocationId,
			error: params.error,
			exitCode: params.exitCode,
			logPath: params.logPath,
		};

		tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: params.invocationId,
			aggregateType: "invocation",
			aggregateVersion: 2, // Failure is version 2 (after started)
			eventType: "playlist.sync.failed",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}

/**
 * Emit sync.canceled event with outbox pattern
 * Updates invocation and outbox event in a single transaction
 */
export async function emitSyncCanceled(params: {
	invocationId: string;
	playlistId: string;
	playlistName: string;
	reason?: string;
}): Promise<void> {
	const db = getDb();

	db.transaction((tx) => {
		// 1. Update invocation record
		tx.update(schema.invocations)
			.set({
				finishedAt: new Date(),
				exitCode: -2,
				status: "canceled",
				summary: params.reason,
			})
			.where(eq(schema.invocations.id, params.invocationId));

		// 2. Write outbox event
		const eventPayload: PlaylistSyncCanceledEvent["payload"] = {
			playlistId: params.playlistId,
			playlistName: params.playlistName,
			invocationId: params.invocationId,
			reason: params.reason,
		};

		tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: params.invocationId,
			aggregateType: "invocation",
			aggregateVersion: 2, // Cancellation is version 2 (after started)
			eventType: "playlist.sync.canceled",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}
