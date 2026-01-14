import { randomUUID } from "node:crypto";
import type { NewPlaylistRow, PlaylistRow } from "~/modules/server/db/schema";
import { type Playlist, PlaylistSchema } from "../schema/playlist";

/**
 * Convert Drizzle database row to Zod Playlist type
 */
export function rowToPlaylist(row: PlaylistRow): Playlist {
	return PlaylistSchema.parse({
		id: row.id,
		name: row.name,
		source: {
			type: row.sourceType,
			url: row.sourceUrl,
		},
		outputDir: row.outputDir,
		flags: {
			overwrite: row.flagsOverwrite,
			retries: row.flagsRetries,
			quality: row.flagsQuality,
			format: row.flagsFormat,
		},
		schedule: {
			enabled: row.scheduleEnabled,
			schedule:
				row.scheduleType === "cron"
					? {
							type: "cron",
							cron: row.scheduleCron || "0 0 * * *",
						}
					: {
							type: "interval",
							minutes: row.scheduleMinutes || 1440,
						},
		},
		status: row.status,
		version: row.version,
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	});
}

/**
 * Convert Zod Playlist type to Drizzle database row (insert)
 */
export function playlistToRow(playlist: Playlist): NewPlaylistRow {
	const id = playlist.id || randomUUID();
	const flags = playlist.flags || {
		overwrite: false,
		retries: 3,
		quality: "high" as const,
		format: "mp3" as const,
	};
	const schedule = playlist.schedule || {
		enabled: false,
		schedule: { type: "interval" as const, minutes: 1440 },
	};

	return {
		id,
		name: playlist.name,
		sourceType: playlist.source.type,
		sourceUrl: playlist.source.url,
		outputDir: playlist.outputDir,
		flagsOverwrite: flags.overwrite,
		flagsRetries: flags.retries,
		flagsQuality: flags.quality,
		flagsFormat: flags.format,
		scheduleEnabled: schedule.enabled,
		scheduleType: schedule.schedule.type,
		scheduleCron:
			schedule.schedule.type === "cron" ? schedule.schedule.cron : null,
		scheduleMinutes:
			schedule.schedule.type === "interval" ? schedule.schedule.minutes : null,
		status: playlist.status,
		version: playlist.version ?? 0,
		createdAt: playlist.createdAt || new Date(),
		updatedAt: playlist.updatedAt || new Date(),
	};
}
