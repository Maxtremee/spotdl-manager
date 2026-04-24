import { sql } from "drizzle-orm";
import {
	index,
	integer,
	sqliteTable,
	text,
	unique,
} from "drizzle-orm/sqlite-core";

/**
 * Sources table schema (renamed from `playlists`).
 * Stores playlist/album source configuration and metadata.
 * Flag columns (flags_overwrite/retries/quality/format) were removed in Phase 1
 * — they were spotdl-engine concerns with no meaning in the Playwright+yt-dlp pipeline.
 */
export const sources = sqliteTable("sources", {
	id: text("id").primaryKey().notNull(),
	name: text("name").notNull(),
	sourceType: text("source_type", {
		enum: ["playlist", "album"],
	}).notNull(),
	sourceUrl: text("source_url").notNull(),
	outputDir: text("output_dir").notNull(),
	// Nullable; populated in Phase 3 (SCRAPE-07) and consumed by ID3 cover art embed.
	coverArtUrl: text("cover_art_url"),
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

export type SourceRow = typeof sources.$inferSelect;
export type NewSourceRow = typeof sources.$inferInsert;

/**
 * Tracks table schema (Phase 1 — TRACK-01 + TRACK-02).
 * Per-track state model for the new Playwright + yt-dlp pipeline.
 * Phase 1 defines the contract; Phase 3+ writes rows.
 */
export const tracks = sqliteTable(
	"tracks",
	{
		id: text("id").primaryKey().notNull(),
		sourceId: text("source_id")
			.notNull()
			.references(() => sources.id, { onDelete: "cascade" }),
		spotifyTrackId: text("spotify_track_id").notNull(),
		title: text("title").notNull(),
		artist: text("artist").notNull(),
		durationMs: integer("duration_ms").notNull(),
		state: text("state", {
			enum: [
				"pending",
				"matched",
				"downloaded",
				"skipped_low_confidence",
				"failed",
			],
		})
			.default("pending")
			.notNull(),
		ytVideoId: text("yt_video_id"),
		downloadPath: text("download_path"),
		failureReason: text("failure_reason"),
		position: integer("position").notNull(),
		createdAt: integer("created_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
		updatedAt: integer("updated_at", { mode: "timestamp" })
			.notNull()
			.default(sql`(unixepoch())`),
	},
	(t) => [
		unique("tracks_source_spotify_unique").on(t.sourceId, t.spotifyTrackId),
		index("tracks_source_id_idx").on(t.sourceId),
		index("tracks_state_idx").on(t.state),
	],
);

export type TrackRow = typeof tracks.$inferSelect;
export type NewTrackRow = typeof tracks.$inferInsert;

/**
 * Invocations table schema
 * Tracks each sync execution for a source.
 * Note: the FK column is still called `playlist_id` / `playlistId` —
 * Phase 3 will rework the invocations table semantics.
 */
export const invocations = sqliteTable("invocations", {
	id: text("id").primaryKey().notNull(),
	playlistId: text("playlist_id")
		.notNull()
		.references(() => sources.id, { onDelete: "cascade" }),
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
