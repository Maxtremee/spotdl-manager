import { randomUUID } from "node:crypto";
import type { NewSourceRow, SourceRow } from "~/modules/server/db/schema";
import { type Playlist, PlaylistSchema } from "../schema/playlist";

/**
 * Convert Drizzle database row (sources table) to Zod Playlist type.
 * Flag fields were removed in Phase 1 (spotdl-era concerns); the Zod schema
 * still accepts an optional `flags` but we no longer populate it.
 */
export function rowToPlaylist(row: SourceRow): Playlist {
	return PlaylistSchema.parse({
		id: row.id,
		name: row.name,
		source: {
			type: row.sourceType,
			url: row.sourceUrl,
		},
		outputDir: row.outputDir,
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
		createdAt: new Date(row.createdAt),
		updatedAt: new Date(row.updatedAt),
	});
}

/**
 * Convert Zod Playlist type to Drizzle database row (insert shape for `sources`).
 */
export function playlistToRow(playlist: Playlist): NewSourceRow {
	const id = playlist.id || randomUUID();
	const schedule = playlist.schedule || {
		enabled: false,
		schedule: { type: "interval" as const, minutes: 1440 },
	};

	// Phase 1: "track" source type was dropped (D-11); the Zod schema
	// (plan 01-02) already narrows `playlist.source.type` to "playlist" | "album",
	// so no runtime guard is needed here.
	const sourceType: NewSourceRow["sourceType"] = playlist.source.type;

	return {
		id,
		name: playlist.name,
		sourceType,
		sourceUrl: playlist.source.url,
		outputDir: playlist.outputDir,
		scheduleEnabled: schedule.enabled,
		scheduleType: schedule.schedule.type,
		scheduleCron:
			schedule.schedule.type === "cron" ? schedule.schedule.cron : null,
		scheduleMinutes:
			schedule.schedule.type === "interval" ? schedule.schedule.minutes : null,
		status: playlist.status,
		createdAt: playlist.createdAt || new Date(),
		updatedAt: playlist.updatedAt || new Date(),
	};
}
