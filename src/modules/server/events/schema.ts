import { z } from "zod";

/**
 * Base event schema with common fields
 */
const BaseEventSchema = z.object({
	id: z.string().uuid(),
	timestamp: z.date(),
});

/**
 * Failure taxonomy for playlist.sync.failed events.
 * Locked by Phase 2 D-09 — do not extend without updating webhook formatter (Plan 05).
 */
export const FailureReasonSchema = z.enum([
	"invalid_url",
	"not_found",
	"parse_error",
	"network_error",
	"python_crash",
]);
export type FailureReason = z.infer<typeof FailureReasonSchema>;

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
		// Phase 2 D-10/D-11: surfaces when spotifyscraper's 100-track cap was hit.
		truncationSuspected: z.boolean().optional(),
		// Phase 2: informational count for webhook formatting.
		trackCount: z.number().int().nonnegative().optional(),
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
		// Phase 2 D-09: typed failure taxonomy — webhook handler (Plan 05) branches on this.
		failureReason: FailureReasonSchema.optional(),
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
 * Phase 3 D-05: download finalization event.
 * Emitted by DownloadRunner.run after all per-track work is settled.
 * Carries summary counters that match the kind=download invocation row's summary JSON.
 */
export const PlaylistDownloadCompletedEventSchema = BaseEventSchema.extend({
	type: z.literal("playlist.download.completed"),
	payload: z.object({
		playlistId: z.string(),
		playlistName: z.string(),
		invocationId: z.string().uuid(),
		duration: z.number().positive(),
		total: z.number().int().nonnegative(),
		downloaded: z.number().int().nonnegative(),
		matchedOnly: z.number().int().nonnegative(),
		skippedLowConfidence: z.number().int().nonnegative(),
		failed: z.number().int().nonnegative(),
	}),
});
export type PlaylistDownloadCompletedEvent = z.infer<
	typeof PlaylistDownloadCompletedEventSchema
>;

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
	PlaylistDownloadCompletedEventSchema,
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
