/**
 * DownloadRepository — data access layer for the DownloadRunner pipeline.
 *
 * Responsibilities:
 *   - Select tracks to process (state IN ('pending', 'matched')) per D-07.
 *   - Atomic UPDATE of track state transitions (markMatched, markDownloaded,
 *     markFailed, markSkippedLowConfidence) — D-02 per-track state machine.
 *   - Read/write match settings from global_settings — D-16.
 *   - Source lookup (for cover_art_url + name used in slug generation).
 *
 * T-3-03: failure_reason is capped at STDERR_SLICE_LIMIT (500) chars.
 */

import { and, eq, inArray, sql } from "drizzle-orm";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import { getDb, schema, type TDatabase } from "../db";
import type { SourceRow, TrackRow } from "../db/schema";
import {
	DEFAULT_MATCH_SETTINGS,
	MATCH_SETTINGS_KEY,
	type MatchSettings,
	MatchSettingsSchema,
} from "./schema";

const STDERR_SLICE_LIMIT = 500;

export class DownloadRepository {
	private readonly db: TDatabase;
	private readonly logger: AppLogger;

	constructor(
		db: TDatabase = getDb(),
		logger: AppLogger = Logger.get("DownloadRepository"),
	) {
		this.db = db;
		this.logger = logger;
	}

	/**
	 * D-07: Return all tracks for a source that are in pending or matched state.
	 * - pending: not yet probed/matched
	 * - matched: already probed + yt_video_id persisted; download not yet started
	 *
	 * Excludes: downloaded, failed, skipped_low_confidence (Phase 5 will extend).
	 */
	async getTracksToProcess(sourceId: string): Promise<TrackRow[]> {
		return this.db
			.select()
			.from(schema.tracks)
			.where(
				and(
					eq(schema.tracks.sourceId, sourceId),
					inArray(schema.tracks.state, ["pending", "matched"]),
				),
			);
	}

	/**
	 * Source lookup — returns the source row for slug generation + cover art URL.
	 */
	async getSource(sourceId: string): Promise<SourceRow | null> {
		const [row] = await this.db
			.select()
			.from(schema.sources)
			.where(eq(schema.sources.id, sourceId));
		return row ?? null;
	}

	/**
	 * D-02 first transition: state=pending → matched.
	 * Persists yt_video_id BEFORE the download starts so a crash between
	 * matched and downloaded lets future runs resume without re-searching.
	 *
	 * Does NOT clear failureReason — left for the next failure to overwrite if needed.
	 */
	async markMatched(trackId: string, ytVideoId: string): Promise<void> {
		await this.db
			.update(schema.tracks)
			.set({
				state: "matched",
				ytVideoId,
				updatedAt: new Date(),
			})
			.where(eq(schema.tracks.id, trackId));
		this.logger.debug({ trackId, ytVideoId }, "DownloadRepository.markMatched");
	}

	/**
	 * D-02 second transition: state=matched → downloaded.
	 * Clears failureReason to null — safe cleanup for any prior failed attempt
	 * (rare in v1 since runner only processes pending+matched, but correct).
	 */
	async markDownloaded(trackId: string, downloadPath: string): Promise<void> {
		await this.db
			.update(schema.tracks)
			.set({
				state: "downloaded",
				downloadPath,
				failureReason: null,
				updatedAt: new Date(),
			})
			.where(eq(schema.tracks.id, trackId));
		this.logger.debug(
			{ trackId, downloadPath },
			"DownloadRepository.markDownloaded",
		);
	}

	/**
	 * D-03 track failure — marks failed with typed errorType + capped message.
	 *
	 * T-3-03: stderr tail capped at STDERR_SLICE_LIMIT (500) chars.
	 * Format: "<errorType>: <message-tail>"
	 */
	async markFailed(
		trackId: string,
		errorType: string,
		message: string,
	): Promise<void> {
		const tail = message.slice(0, STDERR_SLICE_LIMIT);
		const failureReason = `${errorType}: ${tail}`;
		await this.db
			.update(schema.tracks)
			.set({
				state: "failed",
				failureReason,
				updatedAt: new Date(),
			})
			.where(eq(schema.tracks.id, trackId));
		this.logger.debug(
			{ trackId, errorType },
			"DownloadRepository.markFailed",
		);
	}

	/**
	 * MATCH-03: out-of-tolerance result — never downloads bytes.
	 *
	 * Stores ytVideoId if non-null (we probed it, might as well keep it).
	 * Stores the tolerance delta in failureReason for diagnostic purposes.
	 * Does NOT touch downloadPath.
	 */
	async markSkippedLowConfidence(
		trackId: string,
		ytVideoId: string | null,
		reason: string,
	): Promise<void> {
		await this.db
			.update(schema.tracks)
			.set({
				state: "skipped_low_confidence",
				...(ytVideoId !== null ? { ytVideoId } : {}),
				failureReason: reason,
				updatedAt: new Date(),
			})
			.where(eq(schema.tracks.id, trackId));
		this.logger.debug(
			{ trackId, ytVideoId, reason },
			"DownloadRepository.markSkippedLowConfidence",
		);
	}

	/**
	 * D-16: read match settings from global_settings.
	 * Falls back to DEFAULT_MATCH_SETTINGS on missing row, JSON.parse failure,
	 * or Zod validation failure — graceful degradation, never throws.
	 */
	async getMatchSettings(): Promise<MatchSettings> {
		const [row] = await this.db
			.select()
			.from(schema.globalSettings)
			.where(eq(schema.globalSettings.key, MATCH_SETTINGS_KEY));

		if (!row) {
			return DEFAULT_MATCH_SETTINGS;
		}

		try {
			const parsed = JSON.parse(row.value);
			return MatchSettingsSchema.parse(parsed);
		} catch {
			return DEFAULT_MATCH_SETTINGS;
		}
	}

	/**
	 * D-16: upsert match settings into global_settings.
	 * Uses onConflictDoUpdate to mirror the webhook settings pattern (webhooks/repository.ts).
	 */
	async saveMatchSettings(settings: MatchSettings): Promise<MatchSettings> {
		const validated = MatchSettingsSchema.parse(settings);
		const value = JSON.stringify(validated);

		await this.db
			.insert(schema.globalSettings)
			.values({
				key: MATCH_SETTINGS_KEY,
				value,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: schema.globalSettings.key,
				set: {
					value,
					updatedAt: sql`(unixepoch())`,
				},
			});

		return validated;
	}
}
