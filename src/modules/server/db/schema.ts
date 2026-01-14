import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Playlists table schema using Drizzle ORM
 * Stores playlist configuration and metadata
 */
export const playlists = sqliteTable("playlists", {
	id: text("id").primaryKey().notNull(),
	name: text("name").notNull(),
	sourceType: text("source_type", {
		enum: ["playlist", "album", "track"],
	}).notNull(),
	sourceUrl: text("source_url").notNull(),
	outputDir: text("output_dir").notNull(),
	// Flags JSON (stored as text in SQLite)
	flagsOverwrite: integer("flags_overwrite", { mode: "boolean" })
		.default(false)
		.notNull(),
	flagsRetries: integer("flags_retries").default(3).notNull(),
	flagsQuality: text("flags_quality", {
		enum: ["worst", "low", "medium", "high", "very_high", "lossless"],
	})
		.default("high")
		.notNull(),
	flagsFormat: text("flags_format", {
		enum: ["mp3", "flac", "ogg", "m4a", "opus", "vorbis", "wav"],
	})
		.default("mp3")
		.notNull(),
	// Schedule
	scheduleEnabled: integer("schedule_enabled", { mode: "boolean" })
		.default(false)
		.notNull(),
	scheduleType: text("schedule_type", {
		enum: ["cron", "interval"],
	})
		.default("interval")
		.notNull(),
	scheduleCron: text("schedule_cron"),
	scheduleMinutes: integer("schedule_minutes").default(1440), // Default 24 hours
	// Status
	status: text("status", {
		enum: ["active", "paused", "archived", "error"],
	})
		.default("active")
		.notNull(),
	// Version for optimistic locking
	version: integer("version").default(0).notNull(),
	// Timestamps
	createdAt: integer("created_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

export type PlaylistRow = typeof playlists.$inferSelect;
export type NewPlaylistRow = typeof playlists.$inferInsert;

/**
 * Invocations table schema
 * Tracks each spotdl execution for a playlist
 */
export const invocations = sqliteTable("invocations", {
	id: text("id").primaryKey().notNull(),
	playlistId: text("playlist_id")
		.notNull()
		.references(() => playlists.id, { onDelete: "cascade" }),
	startedAt: integer("started_at", { mode: "timestamp" }).notNull(),
	finishedAt: integer("finished_at", { mode: "timestamp" }),
	exitCode: integer("exit_code"),
	status: text("status", {
		enum: ["running", "success", "failed", "canceled"],
	})
		.default("running")
		.notNull(),
	logPath: text("log_path"),
	syncFilePath: text("sync_file_path"),
	summary: text("summary"),
});

export type InvocationRow = typeof invocations.$inferSelect;
export type NewInvocationRow = typeof invocations.$inferInsert;

/**
 * Global settings table schema
 * Key-value store for application-wide configuration
 */
export const globalSettings = sqliteTable("global_settings", {
	key: text("key").primaryKey().notNull(),
	value: text("value").notNull(),
	updatedAt: integer("updated_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

export type GlobalSettingRow = typeof globalSettings.$inferSelect;
export type NewGlobalSettingRow = typeof globalSettings.$inferInsert;

/**
 * Outbox table for transactional event emission
 * Stores events to be processed and delivered to the event bus
 */
export const outbox = sqliteTable(
	"outbox",
	{
		id: text("id").primaryKey().notNull(),
		aggregateId: text("aggregate_id").notNull(),
		aggregateType: text("aggregate_type", {
			enum: ["playlist", "invocation"],
		}).notNull(),
		aggregateVersion: integer("aggregate_version").notNull(),
		eventType: text("event_type").notNull(),
		eventPayload: text("event_payload", { mode: "json" }).notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		processingAt: integer("processing_at", { mode: "timestamp" }),
		processedAt: integer("processed_at", { mode: "timestamp" }),
		status: text("status", {
			enum: ["pending", "processing", "processed", "failed"],
		})
			.default("pending")
			.notNull(),
		retryCount: integer("retry_count").default(0).notNull(),
		lastError: text("last_error"),
	},
	(table) => ({
		statusCreatedIdx: index("outbox_status_created_idx").on(
			table.status,
			table.createdAt,
		),
		aggregateIdx: index("outbox_aggregate_idx").on(
			table.aggregateId,
			table.aggregateVersion,
		),
	}),
);

export type OutboxRow = typeof outbox.$inferSelect;
export type NewOutboxRow = typeof outbox.$inferInsert;

/**
 * Outbox archive table for processed events
 * Events older than 14 days are moved here for retention
 */
export const outboxArchive = sqliteTable("outbox_archive", {
	id: text("id").primaryKey().notNull(),
	aggregateId: text("aggregate_id").notNull(),
	aggregateType: text("aggregate_type", {
		enum: ["playlist", "invocation"],
	}).notNull(),
	aggregateVersion: integer("aggregate_version").notNull(),
	eventType: text("event_type").notNull(),
	eventPayload: text("event_payload", { mode: "json" }).notNull(),
	createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
	processingAt: integer("processing_at", { mode: "timestamp" }),
	processedAt: integer("processed_at", { mode: "timestamp" }),
	status: text("status", {
		enum: ["pending", "processing", "processed", "failed"],
	}).notNull(),
	retryCount: integer("retry_count").notNull(),
	lastError: text("last_error"),
	archivedAt: integer("archived_at", { mode: "timestamp" })
		.notNull()
		.default(sql`(unixepoch())`),
});

export type OutboxArchiveRow = typeof outboxArchive.$inferSelect;
export type NewOutboxArchiveRow = typeof outboxArchive.$inferInsert;
