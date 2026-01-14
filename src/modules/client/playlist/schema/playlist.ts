import { z } from "zod";

/**
 * Source type discriminated union for playlist source
 * Supports Spotify playlists, albums, or individual tracks
 */
const PlaylistSourceSchema = z.discriminatedUnion("type", [
	z.object({
		type: z.literal("playlist"),
		url: z.string().url().describe("Spotify playlist URL"),
	}),
	z.object({
		type: z.literal("album"),
		url: z.string().url().describe("Spotify album URL"),
	}),
	z.object({
		type: z.literal("track"),
		url: z.string().url().describe("Spotify track URL"),
	}),
]);

/**
 * Flags for spotdl invocation with safe defaults
 */
const PlaylistFlagsSchema = z.object({
	overwrite: z.boolean().default(false).describe("Overwrite existing files"),
	retries: z
		.number()
		.int()
		.min(0)
		.max(10)
		.default(3)
		.describe("Number of retries on failure"),
	quality: z
		.enum(["worst", "low", "medium", "high", "very_high", "lossless"])
		.default("high")
		.describe("Audio quality"),
	format: z
		.enum(["mp3", "flac", "ogg", "m4a", "opus", "vorbis", "wav"])
		.default("mp3")
		.describe("Audio format"),
});

/**
 * Schedule configuration: cron expression or interval in minutes
 */
const PlaylistScheduleSchema = z
	.object({
		enabled: z.boolean().default(false),
		// Discriminated union: cron OR interval
		schedule: z.discriminatedUnion("type", [
			z.object({
				type: z.literal("cron"),
				cron: z
					.string()
					.describe('Cron expression (e.g., "0 0 * * *" for daily at midnight)')
					.refine(
						(val) =>
							/^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|[1-5][0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|[1-2][0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/.test(
								val,
							),
						"Invalid cron expression",
					),
			}),
			z.object({
				type: z.literal("interval"),
				minutes: z
					.number()
					.int()
					.min(1)
					.max(43200)
					.describe("Interval in minutes (1-43200 = 1 min - 30 days)"),
			}),
		]),
	})
	.default({
		enabled: false,
		schedule: { type: "interval", minutes: 24 * 60 }, // Default to daily
	});

/**
 * Main Playlist schema with all configuration
 */
export const PlaylistSchema = z.object({
	id: z.string().optional().describe("Unique playlist identifier"),
	name: z.string().min(1).max(255).describe("Human-readable playlist name"),
	source: PlaylistSourceSchema.describe("Playlist source (URL and type)"),
	outputDir: z
		.string()
		.min(1)
		.describe("Output directory path for downloaded files"),
	flags: PlaylistFlagsSchema.optional().describe("spotdl invocation flags"),
	schedule: PlaylistScheduleSchema.optional().describe(
		"Schedule configuration",
	),
	status: z
		.enum(["active", "paused", "archived", "error"])
		.default("active")
		.describe("Current playlist status"),
	version: z
		.number()
		.int()
		.min(0)
		.default(0)
		.describe("Version for optimistic locking"),
	createdAt: z.date().optional().describe("Creation timestamp"),
	updatedAt: z.date().optional().describe("Last update timestamp"),
});

/**
 * Inferred TypeScript type from schema
 */
export type Playlist = z.infer<typeof PlaylistSchema>;

/**
 * Utility function to validate and parse a playlist object
 */
export function parsePlaylist(data: unknown): Playlist {
	return PlaylistSchema.parse(data);
}

/**
 * Utility function for safe parsing with error details
 */
export function tryParsePlaylist(data: unknown) {
	return PlaylistSchema.safeParse(data);
}

/**
 * Sample valid payloads for testing
 */
export const SAMPLE_PLAYLISTS = {
	spotifyPlaylist: {
		name: "My Favorite Songs",
		source: {
			type: "playlist" as const,
			url: "https://open.spotify.com/playlist/1lJDx1lqWkjnh8D7VITEhC",
		},
		outputDir: "/downloads/spotify",
		flags: {
			overwrite: false,
			retries: 3,
			quality: "high",
			format: "mp3",
		},
		schedule: {
			enabled: true,
			schedule: {
				type: "cron" as const,
				cron: "0 0 * * *", // Daily at midnight
			},
		},
		status: "active" as const,
	},
	spotifyAlbum: {
		name: "Thriller Album",
		source: {
			type: "album" as const,
			url: "https://open.spotify.com/album/0m7RPdwNo1gte0nUSwh2yv?si=FikYvA9tR_uwPUB-qUc8vw",
		},
		outputDir: "/downloads/albums",
		flags: {
			overwrite: false,
			retries: 5,
			quality: "very_high",
			format: "flac",
		},
		schedule: {
			enabled: false,
			schedule: {
				type: "interval" as const,
				minutes: 24 * 60, // Daily
			},
		},
		status: "active" as const,
	},
	spotifyTrack: {
		name: "Single Track",
		source: {
			type: "track" as const,
			url: "https://open.spotify.com/track/3xhHrJujvMsuArqRj9QLWy?si=3911e5125095495f",
		},
		outputDir: "/downloads/tracks",
		flags: {
			overwrite: true,
			retries: 1,
			quality: "medium",
			format: "mp3",
		},
		schedule: {
			enabled: false,
			schedule: {
				type: "interval" as const,
				minutes: 60,
			},
		},
		status: "paused" as const,
	},
} as const;
