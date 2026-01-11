import { z } from "zod";

/**
 * Base event schema with common fields
 */
const BaseEventSchema = z.object({
	id: z.string().uuid(),
	timestamp: z.date(),
});

/**
 * Playlist sync started event
 */
export const PlaylistSyncStartedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.started"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		sourceUrl: z.string(),
		outputDir: z.string(),
	}),
});

/**
 * Playlist sync completed successfully
 */
export const PlaylistSyncCompletedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.completed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		duration: z.number().positive(),
		exitCode: z.number(),
		summary: z.string().optional(),
		logPath: z.string().optional(),
		syncFilePath: z.string().optional(),
	}),
});

/**
 * Playlist sync failed
 */
export const PlaylistSyncFailedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.failed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		error: z.string(),
		exitCode: z.number().optional(),
		logPath: z.string().optional(),
	}),
});

/**
 * Playlist sync canceled
 */
export const PlaylistSyncCanceledEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.sync.canceled"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		reason: z.string().optional(),
	}),
});

/**
 * Playlist created event
 */
export const PlaylistCreatedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.created"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		sourceUrl: z.string(),
	}),
});

/**
 * Playlist updated event
 */
export const PlaylistUpdatedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.updated"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		changes: z.record(z.string(), z.unknown()),
	}),
});

/**
 * Playlist deleted event
 */
export const PlaylistDeletedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.deleted"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
	}),
});

/**
 * Scheduler reload requested event
 */
export const SchedulerReloadEventSchema = BaseEventSchema.extend({
	type: z.literal("scheduler.reload"),
	payload: z.object({
		reason: z.string().optional(),
	}),
});

/**
 * Union of all event types
 */
export const EventSchema = z.discriminatedUnion("type", [
	PlaylistSyncStartedEventSchema,
	PlaylistSyncCompletedEventSchema,
	PlaylistSyncFailedEventSchema,
	PlaylistSyncCanceledEventSchema,
	PlaylistCreatedEventSchema,
	PlaylistUpdatedEventSchema,
	PlaylistDeletedEventSchema,
	SchedulerReloadEventSchema,
]);

/**
 * Type inference exports
 */
export type Event = z.infer<typeof EventSchema>;
export type PlaylistSyncStartedEvent = z.infer<
	typeof PlaylistSyncStartedEventSchema
>;
export type PlaylistSyncCompletedEvent = z.infer<
	typeof PlaylistSyncCompletedEventSchema
>;
export type PlaylistSyncFailedEvent = z.infer<
	typeof PlaylistSyncFailedEventSchema
>;
export type PlaylistSyncCanceledEvent = z.infer<
	typeof PlaylistSyncCanceledEventSchema
>;
export type PlaylistCreatedEvent = z.infer<typeof PlaylistCreatedEventSchema>;
export type PlaylistUpdatedEvent = z.infer<typeof PlaylistUpdatedEventSchema>;
export type PlaylistDeletedEvent = z.infer<typeof PlaylistDeletedEventSchema>;
export type SchedulerReloadEvent = z.infer<typeof SchedulerReloadEventSchema>;

/**
 * Event type literal union
 */
export type EventType = Event["type"];

/**
 * Helper to extract payload type from event type
 */
export type EventPayload<T extends EventType> = Extract<
	Event,
	{ type: T }
>["payload"];
