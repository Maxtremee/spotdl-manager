/**
 * DownloadRunner — per-source orchestration for the match+download pipeline.
 *
 * Wires together every piece built in Plans 03-01 through 03-03:
 *  - YtDlpBridge (probe + download)
 *  - tagger.embedTags (ID3v2 frames)
 *  - fetchCoverArt (per-track APIC source)
 *  - slug helpers (source directory + filename)
 *  - DownloadRepository (track-state writes)
 *  - InvocationRepository (kind=download row lifecycle)
 *
 * Key design decisions carried by this class:
 *  D-01: DownloadRunner is split from SyncRunner via EventBus (see handler.ts).
 *  D-02: Per-track state machine — markMatched BEFORE download, markDownloaded AFTER tag.
 *  D-03: Per-track failures do NOT abort the run; invocation finishes with status=success.
 *  D-05: A separate kind='download' invocation row is created per run.
 *  D-07: Reads pending+matched rows only; does not retry failed/skipped_low_confidence.
 *  D-11: p-limit fan-out; parallelism from match settings snapshot at run start.
 *  D-15: Skip-if-exists — if target path exists, markDownloaded without re-downloading.
 *
 *  W-1: YTDLP_CRASH_PREFIX reclassification — any bridge error whose message starts
 *       with YTDLP_CRASH_PREFIX is re-typed to "ytdlp_crash" regardless of envelope type.
 *
 *  RESEARCH Pitfall #3: Binary pre-flight — yt-dlp + ffmpeg verified at run() start
 *       before any track work. Missing binary fast-fails the invocation with a typed
 *       summary.failure_reason instead of mass-failing every track individually.
 *
 *  T-3-02: Path-traversal guard — resolved track path verified to stay under MUSIC_ROOT
 *       directory before any fs operation.
 *
 *  T-3-03: Stderr tail capped at 500 chars (enforced by DownloadRepository.markFailed).
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { constants as fsConstants, promises as fs } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { env } from "~/env";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import type { SourceRow, TrackRow } from "../db/schema";
import { getEventBus } from "../events";
import { InvocationRepository } from "../invocation/repository";
import { fetchCoverArt } from "./cover-art";
import { DownloadRepository } from "./repository";
import { YTDLP_CRASH_PREFIX } from "./schema";
import { safeFilename, sourceSlug } from "./slug";
import { embedTags } from "./tagger";
import { YtDlpBridge } from "./YtDlpBridge";

// Default music root; overrideable via DI for tests.
const DEFAULT_MUSIC_ROOT = "data/music";

type TrackOutcome =
	| "downloaded"
	| "skipped_low_confidence"
	| "failed"
	| "matched_only";

type PreflightResult =
	| { ok: true }
	| { ok: false; reason: "ytdlp_missing" | "ffmpeg_missing"; error: string };

export interface DownloadRunnerDeps {
	bridge?: YtDlpBridge;
	repo?: DownloadRepository;
	invocationRepo?: InvocationRepository;
	coverArtFetcher?: typeof fetchCoverArt;
	tagger?: typeof embedTags;
	logger?: AppLogger;
	clock?: () => Date;
	musicRoot?: string;
	/** DI escape hatch for unit tests — override binary pre-flight check. */
	preflight?: () => Promise<PreflightResult>;
}

/**
 * Thin Promise wrapper around a one-shot `<bin> <versionFlag>` spawn.
 * Resolves on exit code 0, rejects on non-zero / ENOENT / timeout.
 */
function spawnVersionCheck(
	bin: string,
	versionFlag: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		let settled = false;

		let child: ReturnType<typeof spawn>;
		try {
			child = spawn(bin, [versionFlag], {
				stdio: ["pipe", "pipe", "pipe"],
				shell: false,
			});
		} catch (err) {
			reject(err);
			return;
		}

		const timer = setTimeout(() => {
			if (!settled) {
				settled = true;
				child.kill();
				reject(new Error(`binary check timed out after ${timeoutMs}ms: ${bin}`));
			}
		}, timeoutMs);

		child.on("error", (err) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				reject(err);
			}
		});

		child.on("close", (code) => {
			if (!settled) {
				settled = true;
				clearTimeout(timer);
				if (code === 0) {
					resolve();
				} else {
					reject(new Error(`${bin} ${versionFlag} exited with code ${code}`));
				}
			}
		});
	});
}

export class DownloadRunner {
	private readonly bridge: YtDlpBridge;
	private readonly repo: DownloadRepository;
	private readonly invocationRepo: InvocationRepository;
	private readonly coverArtFetcher: typeof fetchCoverArt;
	private readonly tagger: typeof embedTags;
	private readonly logger: AppLogger;
	private readonly clock: () => Date;
	private readonly musicRoot: string;
	private readonly preflight: () => Promise<PreflightResult>;

	constructor(deps: DownloadRunnerDeps = {}) {
		this.bridge = deps.bridge ?? new YtDlpBridge();
		this.repo = deps.repo ?? new DownloadRepository();
		this.invocationRepo = deps.invocationRepo ?? new InvocationRepository();
		this.coverArtFetcher = deps.coverArtFetcher ?? fetchCoverArt;
		this.tagger = deps.tagger ?? embedTags;
		this.logger = deps.logger ?? Logger.get("DownloadRunner");
		this.clock = deps.clock ?? (() => new Date());
		this.musicRoot = deps.musicRoot ?? DEFAULT_MUSIC_ROOT;
		this.preflight = deps.preflight ?? this.preflightBinaries.bind(this);
	}

	/**
	 * Execute one download run for the given source.
	 *
	 * Lifecycle:
	 *   1. Read tracks (to capture total count for pre-flight failure payload)
	 *   2. Binary pre-flight (RESEARCH Pitfall #3)
	 *   3. Zero-tracks early exit (no invocation row, no event)
	 *   4. Snapshot settings
	 *   5. Create kind=download invocation row
	 *   6. Verify + create source directory
	 *   7. p-limit fan-out over tracks → per-track state machine
	 *   8. Finalize invocation row + emit playlist.download.completed
	 */
	async run(source: SourceRow): Promise<void> {
		const invocationId = randomUUID();
		const startedAt = this.clock();
		let invocationCreated = false;

		try {
			// Step 1: Read tracks first (needed for pre-flight failure total counter per ordering (a)).
			const tracks = await this.repo.getTracksToProcess(source.id);

			// Step 2: Binary pre-flight (RESEARCH Pitfall #3).
			const preflightResult = await this.preflight();
			if (!preflightResult.ok) {
				// Fast-fail: binaries not available — no track work should run.
				const total = tracks.length;
				await this.invocationRepo.create({
					id: invocationId,
					playlistId: source.id,
					startedAt,
					status: "running",
					kind: "download",
				});
				invocationCreated = true;

				await this.invocationRepo.update(invocationId, {
					finishedAt: this.clock(),
					exitCode: 127,
					status: "failed",
					summary: JSON.stringify({
						failure_reason: preflightResult.reason,
						error: preflightResult.error,
						total,
						downloaded: 0,
						matched_only: 0,
						skipped_low_confidence: 0,
						failed: total,
					}),
				});

				await getEventBus().emit({
					type: "playlist.download.completed",
					payload: {
						playlistId: source.id,
						playlistName: source.name,
						invocationId,
						duration: Math.max(
							1,
							this.clock().getTime() - startedAt.getTime(),
						),
						total,
						downloaded: 0,
						matchedOnly: 0,
						skippedLowConfidence: 0,
						failed: total,
					},
				});
				return;
			}

			// Step 3: Zero tracks — exit cleanly, no invocation row, no event.
			if (tracks.length === 0) {
				this.logger.info(
					{ sourceId: source.id },
					"DownloadRunner: zero tracks to process — exit cleanly",
				);
				return;
			}

			// Step 4: Snapshot settings at run start (D-11 — mid-run changes do not apply).
			const settings = await this.repo.getMatchSettings();

			// Step 5: Create kind=download invocation row.
			await this.invocationRepo.create({
				id: invocationId,
				playlistId: source.id,
				startedAt,
				status: "running",
				kind: "download",
			});
			invocationCreated = true;

			// Step 6: Resolve source directory + path-traversal guard (T-3-02).
			const slug = sourceSlug(source.name);
			const musicRootResolved = path.resolve(this.musicRoot);
			const dir = path.resolve(this.musicRoot, slug);

			// T-3-02 defense-in-depth: even though slug sanitizes, double-check the
			// resolved directory stays under MUSIC_ROOT before any fs operations.
			if (
				!dir.startsWith(musicRootResolved + path.sep) &&
				dir !== musicRootResolved
			) {
				throw new Error(
					`T-3-02 path traversal detected: resolved dir "${dir}" is outside MUSIC_ROOT "${musicRootResolved}"`,
				);
			}

			await fs.mkdir(dir, { recursive: true });

			// Step 7: p-limit fan-out.
			const limit = pLimit(settings.parallel);
			const promises = tracks.map((track) =>
				limit(() => this.processTrack(track, source, dir, settings.tolerance_seconds)),
			);
			const results = await Promise.allSettled(promises);

			// Step 8: Aggregate counters.
			let downloaded = 0;
			let matchedOnly = 0;
			let skippedLowConfidence = 0;
			let failed = 0;

			for (const result of results) {
				if (result.status === "rejected") {
					failed++;
				} else {
					switch (result.value) {
						case "downloaded":
							downloaded++;
							break;
						case "matched_only":
							matchedOnly++;
							break;
						case "skipped_low_confidence":
							skippedLowConfidence++;
							break;
						case "failed":
							failed++;
							break;
					}
				}
			}

			const finishedAt = this.clock();
			const duration = Math.max(1, finishedAt.getTime() - startedAt.getTime());

			await this.invocationRepo.update(invocationId, {
				finishedAt,
				exitCode: 0,
				status: "success",
				summary: JSON.stringify({
					total: tracks.length,
					downloaded,
					matched_only: matchedOnly,
					skipped_low_confidence: skippedLowConfidence,
					failed,
				}),
			});

			await getEventBus().emit({
				type: "playlist.download.completed",
				payload: {
					playlistId: source.id,
					playlistName: source.name,
					invocationId,
					duration,
					total: tracks.length,
					downloaded,
					matchedOnly,
					skippedLowConfidence,
					failed,
				},
			});
		} catch (unexpected) {
			// Pitfall 8 from SyncRunner: always emit a terminal event / finalize.
			this.logger.error(
				{ err: unexpected, sourceId: source.id },
				"DownloadRunner: unexpected crash — finalizing invocation",
			);
			if (invocationCreated) {
				try {
					await this.invocationRepo.update(invocationId, {
						finishedAt: this.clock(),
						exitCode: 1,
						status: "failed",
						summary: JSON.stringify({
							failure_reason: "ytdlp_crash",
							error:
								unexpected instanceof Error
									? unexpected.message
									: String(unexpected),
						}),
					});
				} catch (terminalErr) {
					this.logger.error(
						{ err: terminalErr },
						"DownloadRunner: failed to update invocation on crash",
					);
				}
			}
		}
	}

	/**
	 * Process a single track through the state machine.
	 *
	 * Returns one of: "downloaded" | "skipped_low_confidence" | "failed" | "matched_only"
	 *
	 * Per-track failures are isolated — this method NEVER throws (D-03).
	 */
	private async processTrack(
		track: TrackRow,
		source: SourceRow,
		dir: string,
		toleranceSeconds: number,
	): Promise<TrackOutcome> {
		try {
			const filename = safeFilename(track.artist, track.title);
			const targetPath = path.join(dir, filename);

			// T-3-02 defense-in-depth: verify the resolved target path stays under dir.
			// comment: even though safeFilename strips unsafe chars, double-check.
			if (!path.resolve(targetPath).startsWith(path.resolve(dir) + path.sep)) {
				this.logger.error(
					{ trackId: track.id, targetPath, dir },
					"T-3-02 path traversal detected at track level — marking failed",
				);
				await this.repo.markFailed(
					track.id,
					"tagger_error",
					"path traversal detected",
				);
				return "failed";
			}

			// D-15: Skip-if-exists — check if file already on disk.
			try {
				await fs.access(targetPath);
				// File exists — mark downloaded without re-invoking yt-dlp.
				await this.repo.markDownloaded(track.id, targetPath);
				this.logger.debug(
					{ trackId: track.id, targetPath },
					"DownloadRunner: file exists — skipping re-download (D-15)",
				);
				return "downloaded";
			} catch (err) {
				if ((err as NodeJS.ErrnoException).code !== "ENOENT") {
					throw err;
				}
				// ENOENT — proceed with download
			}

			// Determine video ID.
			let videoId: string;

			if (track.state === "matched" && track.ytVideoId) {
				// MATCH-04: reuse persisted yt_video_id — skip probe call.
				videoId = track.ytVideoId;
				this.logger.debug(
					{ trackId: track.id, videoId },
					"DownloadRunner: state=matched — reusing cached ytVideoId (MATCH-04)",
				);
			} else {
				// Probe YouTube for the track.
				const query = `${track.artist} ${track.title}`;
				const probe = await this.bridge.probe(query);

				if (probe.error) {
					// W-1: reclassify ytdlp_crash via YTDLP_CRASH_PREFIX.
					const errorType = probe.error.message.startsWith(YTDLP_CRASH_PREFIX)
						? "ytdlp_crash"
						: probe.error.type;
					await this.repo.markFailed(
						track.id,
						errorType,
						probe.error.message,
					);
					return "failed";
				}

				// probe.videoId and probe.durationSeconds are non-null when error is null.
				const probeDurationSeconds = probe.durationSeconds as number;
				const probeVideoId = probe.videoId as string;
				const trackDurationSeconds = Math.round(track.durationMs / 1000);
				const delta = Math.abs(probeDurationSeconds - trackDurationSeconds);

				if (delta > toleranceSeconds) {
					// MATCH-03: out-of-tolerance — mark skipped, never download.
					const reason = `delta=${delta}s, tolerance=${toleranceSeconds}s`;
					await this.repo.markSkippedLowConfidence(
						track.id,
						probeVideoId,
						reason,
					);
					this.logger.debug(
						{ trackId: track.id, delta, toleranceSeconds },
						"DownloadRunner: duration delta exceeds tolerance — skipped_low_confidence (MATCH-03)",
					);
					return "skipped_low_confidence";
				}

				// D-02: persist yt_video_id + transition to matched BEFORE download.
				await this.repo.markMatched(track.id, probeVideoId);
				videoId = probeVideoId;
			}

			// Download the track.
			const dl = await this.bridge.download(videoId, targetPath);

			if (dl.error) {
				// W-1: reclassify ytdlp_crash.
				const errorType = dl.error.message.startsWith(YTDLP_CRASH_PREFIX)
					? "ytdlp_crash"
					: dl.error.type;
				await this.repo.markFailed(track.id, errorType, dl.error.message);
				return "failed";
			}

			// Cover art fetch — best-effort, never throws (Pitfall #8).
			const coverArt = await this.coverArtFetcher(source.coverArtUrl ?? null);

			// Tag — best-effort (per Open Q #5: file on disk + playable > tag failure).
			try {
				this.tagger(targetPath, {
					title: track.title,
					artist: track.artist,
					album: track.album,
					coverArt,
				});
			} catch (tagErr) {
				this.logger.warn(
					{ err: tagErr, trackId: track.id, targetPath },
					"DownloadRunner: tagging failed — file kept; track marked downloaded",
				);
			}

			// D-02: final transition to downloaded.
			await this.repo.markDownloaded(track.id, targetPath);
			return "downloaded";
		} catch (err) {
			// Per-track isolation (D-03): catch any unexpected error, mark failed, continue.
			this.logger.error(
				{ err, trackId: track.id },
				"DownloadRunner.processTrack: unexpected error — marking failed",
			);
			try {
				await this.repo.markFailed(
					track.id,
					"ytdlp_crash",
					err instanceof Error ? err.message : String(err),
				);
			} catch (markErr) {
				this.logger.error(
					{ err: markErr, trackId: track.id },
					"DownloadRunner.processTrack: failed to mark track failed",
				);
			}
			return "failed";
		}
	}

	/**
	 * RESEARCH Pitfall #3: Verify yt-dlp + ffmpeg are available before any track work.
	 *
	 * Hybrid check:
	 *  - If bin is absolute-path, fs.access(X_OK) first as a fast-path.
	 *  - Always finish with a real spawn to confirm the binary actually executes.
	 *  - 5s timeout prevents a hung spawn from blocking the runner.
	 *
	 * Injected via DI (preflight in DownloadRunnerDeps) so unit tests stub it out.
	 */
	private async preflightBinaries(): Promise<PreflightResult> {
		const checks: Array<{
			bin: string;
			versionFlag: string;
			reason: "ytdlp_missing" | "ffmpeg_missing";
		}> = [
			{
				bin: env.YT_DLP_BIN ?? "yt-dlp",
				versionFlag: "--version",
				reason: "ytdlp_missing",
			},
			{ bin: "ffmpeg", versionFlag: "-version", reason: "ffmpeg_missing" },
		];

		for (const { bin, versionFlag, reason } of checks) {
			// Fast-path: absolute binary path — check X_OK before spawning.
			if (path.isAbsolute(bin)) {
				try {
					await fs.access(bin, fsConstants.X_OK);
				} catch (err) {
					return {
						ok: false,
						reason,
						error: (err as Error).message,
					};
				}
			}

			// Real spawn check — confirms binary actually executes (not just exists).
			try {
				await spawnVersionCheck(bin, versionFlag, 5000);
			} catch (err) {
				return {
					ok: false,
					reason,
					error: (err as Error).message,
				};
			}
		}

		return { ok: true };
	}
}
