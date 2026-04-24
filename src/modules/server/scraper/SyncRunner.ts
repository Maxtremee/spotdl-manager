/**
 * SyncRunner — shared entry point for playlist scrape execution.
 *
 * Called by both the cron scheduler (`PlaylistScheduler.executePlaylistSync`)
 * and the manual "Sync now" server function. Single code path, two entry points
 * (D-05/D-06).
 *
 * Lifecycle:
 *   1. Emit `playlist.sync.started`
 *   2. Create invocation row (status=running)
 *   3. Re-validate URL server-side — fail fast with `invalid_url` if not a Spotify
 *      playlist URL (T-2-04 defense-in-depth; client validator is gate 1)
 *   4. Call SpotifyScraperBridge.fetchPlaylist — returns a typed PythonEnvelope
 *   5. Detect python_crash via PYTHON_CRASH_PREFIX (W-1 shared constant from schema.ts)
 *   6. On success: transactionally upsert tracks + cover_art_url (D-08)
 *   7. Update invocation row + emit completed/failed (Pitfall 8: always emit a terminal event)
 *
 * W-1 contract: PYTHON_CRASH_PREFIX is imported from ./schema — never a raw string literal.
 */

import { randomUUID } from "node:crypto";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import type { SourceRow } from "../db/schema";
import { getEventBus } from "../events";
import type { FailureReason } from "../events/schema";
import { InvocationRepository } from "../invocation/repository";
import { ScraperRepository } from "./repository";
import { SpotifyScraperBridge } from "./SpotifyScraperBridge";
import { PYTHON_CRASH_PREFIX } from "./schema"; // W-1: shared constant — do NOT duplicate literal

// D-10: Spotify /embed/playlist/ endpoint returns at most 100 tracks.
// When the scrape returns exactly this many, truncation is suspected.
const TRUNCATION_THRESHOLD = 100;

/**
 * Node-side URL pre-validator (T-2-04 defense-in-depth).
 *
 * Accepts ONLY `https://open.spotify.com/playlist/…` — rejects albums,
 * artists, tracks, and any non-Spotify host. Phase 4 will widen to /album/.
 *
 * Exported so the manual sync server function can surface the same error
 * to the UI without actually spawning the bridge.
 */
export function isValidPlaylistUrl(url: string): boolean {
	try {
		const u = new URL(url);
		return (
			u.hostname === "open.spotify.com" && u.pathname.startsWith("/playlist/")
		);
	} catch {
		return false;
	}
}

export interface SyncRunnerDeps {
	bridge?: SpotifyScraperBridge;
	invocationRepo?: InvocationRepository;
	scraperRepo?: ScraperRepository;
	logger?: AppLogger;
	/** Escape hatch for deterministic tests — override the clock. */
	clock?: () => Date;
}

export class SyncRunner {
	private readonly bridge: SpotifyScraperBridge;
	private readonly invocationRepo: InvocationRepository;
	private readonly scraperRepo: ScraperRepository;
	private readonly logger: AppLogger;
	private readonly clock: () => Date;

	constructor(deps: SyncRunnerDeps = {}) {
		this.bridge = deps.bridge ?? new SpotifyScraperBridge();
		this.invocationRepo = deps.invocationRepo ?? new InvocationRepository();
		this.scraperRepo = deps.scraperRepo ?? new ScraperRepository();
		this.logger = deps.logger ?? Logger.get("SyncRunner");
		this.clock = deps.clock ?? (() => new Date());
	}

	/**
	 * Execute one scrape run for the given source.
	 *
	 * Always emits a terminal event (`playlist.sync.completed` or
	 * `playlist.sync.failed`) — even when an unexpected error occurs (Pitfall 8).
	 */
	async run(source: SourceRow): Promise<void> {
		const invocationId = randomUUID();
		const startedAt = this.clock();
		const eventBus = getEventBus();

		try {
			// 1. Emit started — metrics/webhook consumers see the lifecycle begin.
			await eventBus.emit({
				type: "playlist.sync.started",
				payload: {
					playlistId: source.id,
					playlistName: source.name,
					invocationId,
					sourceUrl: source.sourceUrl,
					outputDir: source.outputDir,
				},
			});

			// 2. Write the invocation row so we have a durable record even if we crash later.
			await this.invocationRepo.create({
				id: invocationId,
				playlistId: source.id,
				startedAt,
				status: "running",
			});

			// 3. Server-side URL guard (T-2-04): reject non-playlist URLs before spawning Python.
			if (!isValidPlaylistUrl(source.sourceUrl)) {
				await this.finalizeFailure(
					invocationId,
					source,
					"invalid_url",
					`URL is not a Spotify playlist: ${source.sourceUrl}`,
				);
				return;
			}

			// 4. Invoke the bridge — may return an error envelope or a crash envelope.
			const envelope = await this.bridge.fetchPlaylist(source.sourceUrl);

			if (envelope.error) {
				// W-1: detect bridge-synthesized python_crash via the shared constant.
				// The bridge cannot emit `python_crash` in `error.type` (PythonErrorSchema
				// only has 4 members). It signals a crash by using `network_error` with a
				// message that starts with PYTHON_CRASH_PREFIX. SyncRunner reclassifies here.
				const isPythonCrash =
					envelope.error.message.startsWith(PYTHON_CRASH_PREFIX);

				const failureReason: FailureReason = isPythonCrash
					? "python_crash"
					: envelope.error.type;

				await this.finalizeFailure(
					invocationId,
					source,
					failureReason,
					envelope.error.message,
				);
				return;
			}

			// 5. Defensive null-tracks-without-error guard.
			if (!envelope.tracks) {
				await this.finalizeFailure(
					invocationId,
					source,
					"python_crash",
					"python returned no tracks without error",
				);
				return;
			}

			// D-10: detect truncation before the upsert.
			const truncationSuspected =
				envelope.tracks.length >= TRUNCATION_THRESHOLD;

			// 6. Atomic upsert (D-08): tracks + cover_art_url in one transaction inside repo.
			try {
				await this.scraperRepo.upsertAll(
					source.id,
					envelope.tracks.map((t) => ({
						spotifyTrackId: t.spotify_track_id,
						title: t.title,
						artist: t.artist,
						durationMs: t.duration_ms,
						position: t.position,
					})),
					envelope.cover_art_url,
				);
			} catch (err) {
				this.logger.error(
					{ err, sourceId: source.id },
					"SyncRunner: upsertAll threw — classifying as python_crash",
				);
				// DB error is Node-side; closest enum member is python_crash (per research).
				await this.finalizeFailure(
					invocationId,
					source,
					"python_crash",
					err instanceof Error ? err.message : String(err),
				);
				return;
			}

			// 7. Finalize success.
			await this.finalizeSuccess(
				invocationId,
				source,
				envelope.tracks.length,
				truncationSuspected,
				startedAt,
			);
		} catch (unexpected) {
			// Pitfall 8: always emit a terminal event — never leave a lifecycle half-started.
			this.logger.error(
				{ err: unexpected, sourceId: source.id },
				"SyncRunner: unexpected crash — emitting terminal failed event",
			);
			try {
				await this.finalizeFailure(
					invocationId,
					source,
					"python_crash",
					unexpected instanceof Error ? unexpected.message : String(unexpected),
				);
			} catch (terminalErr) {
				// If finalizeFailure itself throws, log and swallow — we've done our best.
				this.logger.error(
					{ err: terminalErr },
					"SyncRunner: failed to emit terminal event — lifecycle may be broken",
				);
			}
		}
	}

	// -------------------------------------------------------------------------
	// Private helpers
	// -------------------------------------------------------------------------

	private async finalizeSuccess(
		invocationId: string,
		source: SourceRow,
		trackCount: number,
		truncationSuspected: boolean,
		startedAt: Date,
	): Promise<void> {
		const finishedAt = this.clock();
		const duration = Math.max(1, finishedAt.getTime() - startedAt.getTime());

		// D-11: invocation summary uses snake_case to mirror Python envelope conventions.
		await this.invocationRepo.update(invocationId, {
			finishedAt,
			exitCode: 0,
			status: "success",
			summary: JSON.stringify({
				track_count: trackCount,
				truncation_suspected: truncationSuspected, // D-11
			}),
		});

		// D-11: event payload uses camelCase to match Zod schema.
		await getEventBus().emit({
			type: "playlist.sync.completed",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				duration,
				exitCode: 0,
				trackCount,
				truncationSuspected,
			},
		});
	}

	private async finalizeFailure(
		invocationId: string,
		source: SourceRow,
		failureReason: FailureReason,
		errorMessage: string,
	): Promise<void> {
		// D-09: typed failure reason goes both to invocation summary (snake_case)
		// and event payload (camelCase).
		await this.invocationRepo.update(invocationId, {
			finishedAt: this.clock(),
			exitCode: 1,
			status: "failed",
			summary: JSON.stringify({
				failure_reason: failureReason, // snake_case in summary
				error: errorMessage,
			}),
		});

		await getEventBus().emit({
			type: "playlist.sync.failed",
			payload: {
				playlistId: source.id,
				playlistName: source.name,
				invocationId,
				error: errorMessage,
				failureReason, // camelCase in event payload
			},
		});
	}
}
