/**
 * ScraperRepository — Drizzle upsert for tracks + sources.cover_art_url update.
 *
 * Both writes are wrapped in a single synchronous better-sqlite3 transaction
 * to honor D-08 atomicity: if the cover-art update fails, the tracks upsert
 * is rolled back (and vice-versa).
 *
 * D-14: the `onConflictDoUpdate` set clause lists ONLY title/artist/durationMs/
 * position/updatedAt. Omitting state/ytVideoId/downloadPath/failureReason means
 * SQLite keeps the existing column values on conflict — Phase 3+ can freely
 * update those columns without being clobbered by a subsequent scrape.
 *
 * D-16: tracks that exist in the DB but are absent from the current scrape are
 * left untouched — upsert only touches rows that appear in the response.
 */

import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import { getDb, schema, type TDatabase } from "../db";

export interface NormalizedTrack {
	spotifyTrackId: string;
	title: string;
	artist: string;
	durationMs: number;
	position: number;
}

export class ScraperRepository {
	private readonly db: TDatabase;
	private readonly logger: AppLogger;

	constructor(
		db: TDatabase = getDb(),
		logger: AppLogger = Logger.get("ScraperRepository"),
	) {
		this.db = db;
		this.logger = logger;
	}

	/**
	 * Atomic: tracks upsert + sources.coverArtUrl update in one transaction (D-08).
	 *
	 * On conflict (source_id, spotify_track_id): refreshes ONLY
	 * title / artist / durationMs / position / updatedAt.
	 * Never touches state, ytVideoId, downloadPath, failureReason (D-14).
	 *
	 * Tracks missing from `tracks` are left untouched (D-16).
	 *
	 * @param sourceId   FK to sources.id
	 * @param tracks     Normalized tracks from the Python envelope
	 * @param coverArtUrl Nullable cover-art URL from the Python envelope
	 */
	async upsertAll(
		sourceId: string,
		tracks: NormalizedTrack[],
		coverArtUrl: string | null,
	): Promise<void> {
		// better-sqlite3 is synchronous — db.transaction callback must be sync.
		// We call it synchronously and wrap in a resolved promise for a consistent
		// async interface (callers can safely await this method).
		this.db.transaction((tx) => {
			if (tracks.length > 0) {
				const now = new Date();
				const values = tracks.map((t) => ({
					id: randomUUID(),
					sourceId,
					spotifyTrackId: t.spotifyTrackId,
					title: t.title,
					artist: t.artist,
					durationMs: t.durationMs,
					position: t.position,
					createdAt: now,
					updatedAt: now,
				}));

				tx
					.insert(schema.tracks)
					.values(values)
					.onConflictDoUpdate({
						target: [schema.tracks.sourceId, schema.tracks.spotifyTrackId],
						set: {
							// D-14: ONLY these 5 columns are refreshed on conflict.
							// state / ytVideoId / downloadPath / failureReason are intentionally
							// absent — SQLite keeps their existing values.
							title: sql.raw(`excluded.${schema.tracks.title.name}`),
							artist: sql.raw(`excluded.${schema.tracks.artist.name}`),
							durationMs: sql.raw(`excluded.${schema.tracks.durationMs.name}`),
							position: sql.raw(`excluded.${schema.tracks.position.name}`),
							updatedAt: sql.raw(`excluded.${schema.tracks.updatedAt.name}`),
						},
					})
					.run();
			}

			// Update cover art in the same transaction (D-08).
			// coverArtUrl === null means "envelope had no image" — skip to avoid
			// overwriting a previously-stored URL with null.
			if (coverArtUrl !== null) {
				tx
					.update(schema.sources)
					.set({ coverArtUrl, updatedAt: new Date() })
					.where(eq(schema.sources.id, sourceId))
					.run();
			}
		});

		this.logger.debug(
			{ sourceId, trackCount: tracks.length, hasCoverArt: coverArtUrl !== null },
			"ScraperRepository.upsertAll complete",
		);
	}

	/**
	 * Standalone cover-art setter.
	 * Used when cover art needs to be cleared (null) or updated independently.
	 * Not wrapped in a transaction — pair it with upsertAll if atomicity is needed.
	 */
	async setCoverArtUrl(
		sourceId: string,
		coverArtUrl: string | null,
	): Promise<void> {
		await this.db
			.update(schema.sources)
			.set({ coverArtUrl, updatedAt: new Date() })
			.where(eq(schema.sources.id, sourceId));
	}
}
