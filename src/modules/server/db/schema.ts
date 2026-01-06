import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
