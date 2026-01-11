import { z } from "zod";

/**
 * Form schema for creating a new playlist
 * Simplified version of PlaylistSchema focused on user input
 */
export const CreatePlaylistFormSchema = z.object({
	name: z
		.string()
		.min(1, "Playlist name is required")
		.max(255, "Playlist name cannot exceed 255 characters"),

	sourceUrl: z
		.string()
		.url("Invalid URL")
		.refine(
			(url) => {
				try {
					const parsed = new URL(url);
					return (
						parsed.hostname === "open.spotify.com" &&
						(parsed.pathname.includes("/playlist/") ||
							parsed.pathname.includes("/album/") ||
							parsed.pathname.includes("/track/"))
					);
				} catch {
					return false;
				}
			},
			{
				message: "URL must be from Spotify (playlist, album, or track)",
			},
		),

	outputDir: z
		.string()
		.min(1, "Output directory is required")
		.refine(
			(path) => {
				// Basic path validation - should start with / or be relative
				return path.length > 0;
			},
			{
				message: "Please provide a valid path",
			},
		),

	// Optional flags section
	enableAdvancedFlags: z.boolean().default(false),

	overwrite: z.boolean().default(false),

	retries: z
		.number()
		.int()
		.min(0, "Minimum retries: 0")
		.max(10, "Maximum retries: 10")
		.default(3),

	quality: z
		.enum(["worst", "low", "medium", "high", "very_high", "lossless"])
		.default("high"),

	format: z
		.enum(["mp3", "flac", "ogg", "m4a", "opus", "vorbis", "wav"])
		.default("mp3"),

	// Optional schedule section
	enableSchedule: z.boolean().default(false),

	scheduleType: z.enum(["cron", "interval"]).default("interval"),

	scheduleCron: z
		.string()
		.optional()
		.refine(
			(val) => {
				if (!val) {
					return true; // Optional field
				}
				return /^(\*|([0-9]|1[0-9]|2[0-9]|3[0-9]|4[0-9]|5[0-9])|\*\/([0-9]|[1-5][0-9])) (\*|([0-9]|1[0-9]|2[0-3])|\*\/([0-9]|1[0-9]|2[0-3])) (\*|([1-9]|1[0-9]|2[0-9]|3[0-1])|\*\/([1-9]|[1-2][0-9]|3[0-1])) (\*|([1-9]|1[0-2])|\*\/([1-9]|1[0-2])) (\*|([0-6])|\*\/([0-6]))$/.test(
					val,
				);
			},
			{
				message: "Invalid cron expression",
			},
		),

	scheduleMinutes: z
		.number()
		.int()
		.min(1, "Minimum 1 minute")
		.max(43200, "Maximum 30 days (43200 minutes)")
		.default(1440), // Default 24 hours
});

export type CreatePlaylistFormData = z.infer<typeof CreatePlaylistFormSchema>;

/**
 * Helper to detect source type from Spotify URL
 */
export function detectSourceType(
	url: string,
): "playlist" | "album" | "track" | null {
	try {
		const parsed = new URL(url);
		if (parsed.hostname !== "open.spotify.com") {
			return null;
		}

		if (parsed.pathname.includes("/playlist/")) {
			return "playlist";
		}
		if (parsed.pathname.includes("/album/")) {
			return "album";
		}
		if (parsed.pathname.includes("/track/")) {
			return "track";
		}

		return null;
	} catch {
		return null;
	}
}

/**
 * Transform form data to Playlist creation payload
 */
export function formDataToPlaylistPayload(formData: CreatePlaylistFormData): {
	name: string;
	source: { type: "playlist" | "album" | "track"; url: string };
	outputDir: string;
	flags?: {
		overwrite: boolean;
		retries: number;
		quality: "worst" | "low" | "medium" | "high" | "very_high" | "lossless";
		format: "mp3" | "flac" | "ogg" | "m4a" | "opus" | "vorbis" | "wav";
	};
	schedule?: {
		enabled: boolean;
		schedule:
			| { type: "cron"; cron: string }
			| { type: "interval"; minutes: number };
	};
} {
	const sourceType = detectSourceType(formData.sourceUrl);
	if (!sourceType) {
		throw new Error("Unable to determine source type");
	}

	return {
		name: formData.name,
		source: {
			type: sourceType,
			url: formData.sourceUrl,
		},
		outputDir: formData.outputDir,
		...(formData.enableAdvancedFlags && {
			flags: {
				overwrite: formData.overwrite,
				retries: formData.retries,
				quality: formData.quality,
				format: formData.format,
			},
		}),
		...(formData.enableSchedule && {
			schedule: {
				enabled: true,
				schedule:
					formData.scheduleType === "cron"
						? {
								type: "cron" as const,
								cron: formData.scheduleCron || "0 0 * * *",
							}
						: {
								type: "interval" as const,
								minutes: formData.scheduleMinutes,
							},
			},
		}),
	};
}
