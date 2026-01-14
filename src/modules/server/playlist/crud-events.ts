import { randomUUID } from "node:crypto";
import type {
	PlaylistCreatedEvent,
	PlaylistDeletedEvent,
	PlaylistUpdatedEvent,
} from "../events/schema";
import { getDb, schema } from "../db";
import type { Playlist } from "~/modules/client/playlist/schema/playlist";

/**
 * Emit playlist.created event with outbox pattern
 * Should be called in the same transaction as playlist creation
 */
export async function emitPlaylistCreated(playlist: Playlist): Promise<void> {
	const db = getDb();

	if (!playlist.id) {
		throw new Error("Playlist ID is required for event emission");
	}

	// Extract id to satisfy TypeScript
	const playlistId = playlist.id;

	await db.transaction(async (tx) => {
		const eventPayload: PlaylistCreatedEvent["payload"] = {
			playlistId: playlistId,
			playlistName: playlist.name,
			sourceUrl: playlist.source.url,
		};

		await tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: playlistId,
			aggregateType: "playlist",
			aggregateVersion: playlist.version,
			eventType: "playlist.created",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}

/**
 * Emit playlist.updated event with outbox pattern
 * Should be called after playlist update to use the new version
 */
export async function emitPlaylistUpdated(
	playlistId: string,
	playlistName: string,
	changes: Record<string, unknown>,
	newVersion: number,
): Promise<void> {
	const db = getDb();

	await db.transaction(async (tx) => {
		const eventPayload: PlaylistUpdatedEvent["payload"] = {
			playlistId,
			playlistName,
			changes,
		};

		await tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: playlistId,
			aggregateType: "playlist",
			aggregateVersion: newVersion,
			eventType: "playlist.updated",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}

/**
 * Emit playlist.deleted event with outbox pattern
 * Should be called BEFORE playlist deletion to capture final version
 */
export async function emitPlaylistDeleted(
	playlistId: string,
	playlistName: string,
	finalVersion: number,
): Promise<void> {
	const db = getDb();

	await db.transaction(async (tx) => {
		const eventPayload: PlaylistDeletedEvent["payload"] = {
			playlistId,
			playlistName,
		};

		await tx.insert(schema.outbox).values({
			id: randomUUID(),
			aggregateId: playlistId,
			aggregateType: "playlist",
			aggregateVersion: finalVersion + 1, // Deletion is next version
			eventType: "playlist.deleted",
			eventPayload: eventPayload,
			status: "pending",
			retryCount: 0,
		});
	});
}
