/**
 * YtDlpBridge — Node side of the yt-dlp subprocess bridge.
 *
 * Exposes two methods:
 *   probe(query)             — search YouTube via "ytsearch1:" and return video ID + duration.
 *   download(videoId, path) — download + extract MP3 to a caller-specified output path.
 *
 * Security properties (T-3-01 mitigation):
 *  - All argv elements are literal strings passed to spawn as an array.
 *  - The "ytsearch1:" prefix + query is a SINGLE argv element — no shell interpolation.
 *  - videoId flows as part of the "https://www.youtube.com/watch?v=" URL argv element.
 *  - `opts.shell` is NEVER set to `true` — Node's default is `false`.
 *  - `opts.stdio` is always `["pipe", "pipe", "pipe"]` so all streams are controlled.
 *
 * Buffering (T-3-12 mitigation):
 *  - spawn `timeout` option (30s probe, 600s download) bounds accumulation window.
 *  - Under `-q --no-warnings`, probe stdout is ~50 bytes; download stdout is empty.
 *  - Stderr is sliced to STDERR_SLICE_LIMIT (500) chars before persistence (T-3-03).
 *
 * W-1 contract: crash envelope messages are prefixed with the imported `YTDLP_CRASH_PREFIX`
 *   constant from "./schema" — NEVER a duplicated string literal. DownloadRunner detects via
 *   `.startsWith(YTDLP_CRASH_PREFIX)`.
 *
 * D-09 (Phase 3): Node bridge mirrors SpotifyScraperBridge; Python runtime stays for scraper only.
 * D-10 (Phase 3): YT_DLP_BIN env var with PATH fallback (mirrors PYTHON_BIN pattern).
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { env } from "~/env";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import {
	YTDLP_CRASH_PREFIX,
	type YtDlpDownloadEnvelope,
	YtDlpDownloadEnvelopeSchema,
	type YtDlpProbeEnvelope,
	YtDlpProbeEnvelopeSchema,
} from "./schema";

// Module-level constants — mirrors SpotifyScraperBridge pattern.
const DEFAULT_PROBE_TIMEOUT_MS = 30_000;
const DEFAULT_DOWNLOAD_TIMEOUT_MS = 600_000;
const DEFAULT_YT_DLP_BIN = "yt-dlp";
const STDERR_SLICE_LIMIT = 500;

export interface YtDlpBridgeOptions {
	ytDlpBin?: string;
	probeTimeoutMs?: number;
	downloadTimeoutMs?: number;
	logger?: AppLogger;
}

/**
 * Normalize a search query string before passing it to "ytsearch1:".
 *
 * D-10 (Pitfall #2): Curly/smart quotes in titles cause YouTube to treat them
 * as part of the string vs a word boundary, leading to false no-results.
 * NFC normalization + quote-straightening improves match yield.
 * T-3-14 (unicode mismatch mitigation).
 */
function normalizeQuery(s: string): string {
	return s.normalize("NFC").replaceAll(/['']/gu, "'").replaceAll(/[""]/gu, '"');
}

export class YtDlpBridge {
	private readonly ytDlpBin: string;
	private readonly probeTimeoutMs: number;
	private readonly downloadTimeoutMs: number;
	private readonly logger: AppLogger;

	constructor(options: YtDlpBridgeOptions = {}) {
		// D-10: YT_DLP_BIN env override; PATH fallback to "yt-dlp".
		this.ytDlpBin = options.ytDlpBin ?? env.YT_DLP_BIN ?? DEFAULT_YT_DLP_BIN;
		this.probeTimeoutMs = options.probeTimeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
		this.downloadTimeoutMs =
			options.downloadTimeoutMs ?? DEFAULT_DOWNLOAD_TIMEOUT_MS;
		this.logger = options.logger ?? Logger.get("YtDlpBridge");
	}

	/**
	 * Probe YouTube for a matching video via ytsearch1:.
	 *
	 * D-08 (Phase 3): Call 1 of the probe-then-download pair. Returns videoId +
	 * durationSeconds without fetching any media bytes. DownloadRunner applies
	 * the ±tolerance_seconds gate on the returned durationSeconds.
	 *
	 * IMPORTANT (Pitfall #1): yt-dlp exits 0 with empty stdout when ytsearch1:
	 * returns zero results (gh#8033). This is NOT a success — it is mapped to a
	 * typed `no_results` error so DownloadRunner can classify the track correctly.
	 *
	 * IMPORTANT (Pitfall #2): Query is NFC-normalized + curly-quotes straightened
	 * before passing to ytsearch1: to reduce false no-results.
	 *
	 * T-3-01: query flows as a single argv element; no shell involved.
	 * Spawn form: spawn(this.ytDlpBin, ["--print", "id", ..., "ytsearch1:" + query], opts)
	 */
	async probe(query: string): Promise<YtDlpProbeEnvelope> {
		const normalizedQuery = normalizeQuery(query);

		// T-3-01: argv-form spawn — never shell interpolation.
		// --print id --print duration output each value on its own line.
		// --skip-download ensures no media bytes are fetched.
		// --no-warnings -q suppress status/progress noise on stdout.
		const child = spawn(
			this.ytDlpBin,
			[
				"--print",
				"id",
				"--print",
				"duration",
				"--skip-download",
				"--no-warnings",
				"-q",
				`ytsearch1:${normalizedQuery}`,
			],
			{
				stdio: ["pipe", "pipe", "pipe"],
				timeout: this.probeTimeoutMs,
			},
		);

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
		});

		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		// yt-dlp takes everything via argv — NO stdin write (unlike SpotifyScraperBridge).

		// Wait for the process to finish — parse ONLY after close fires.
		const [code, signal] = (await once(child, "close")) as [
			number | null,
			NodeJS.Signals | null,
		];

		const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
		const stderrFull = Buffer.concat(stderrChunks).toString("utf8").trim();

		// Non-zero exit: synthesize a ytdlp_crash envelope.
		// W-1: prefix imported from "./schema" — never a duplicated literal.
		if (code !== 0) {
			const stderr = stderrFull.slice(0, STDERR_SLICE_LIMIT);
			this.logger.error(
				{ code, signal, stderrPreview: stderr },
				"YtDlpBridge.probe: yt-dlp exited non-zero — synthesizing ytdlp_crash envelope",
			);
			const result: YtDlpProbeEnvelope = {
				videoId: null,
				durationSeconds: null,
				error: {
					type: "ytdlp_crash",
					message: `${YTDLP_CRASH_PREFIX} exit=${code} signal=${signal} stderr=${stderr}`,
				},
			};
			return YtDlpProbeEnvelopeSchema.parse(result);
		}

		// Pitfall #1: exit 0 + empty stdout = no results (yt-dlp does NOT error on zero hits).
		// This is the critical gotcha — must NOT be treated as success.
		if (stdout === "") {
			this.logger.info(
				{ query: normalizedQuery },
				"YtDlpBridge.probe: empty stdout with exit 0 — no YouTube results found",
			);
			const result: YtDlpProbeEnvelope = {
				videoId: null,
				durationSeconds: null,
				error: {
					type: "no_results",
					message: `ytsearch1: returned no results for ${query}`,
				},
			};
			return YtDlpProbeEnvelopeSchema.parse(result);
		}

		// Exit 0 with stdout: parse the two-line output.
		// Expected: "<videoId>\n<durationSeconds>"
		const lines = stdout.split("\n").filter((l) => l.length > 0);

		if (lines.length < 2) {
			this.logger.error(
				{ lines, stdoutPreview: stdout.slice(0, 200) },
				"YtDlpBridge.probe: expected 2 lines from --print id --print duration but got fewer — synthesizing crash envelope",
			);
			const result: YtDlpProbeEnvelope = {
				videoId: null,
				durationSeconds: null,
				error: {
					type: "ytdlp_crash",
					message: `${YTDLP_CRASH_PREFIX} unparseable probe output: ${stdout.slice(0, 200)}`,
				},
			};
			return YtDlpProbeEnvelopeSchema.parse(result);
		}

		const videoId = lines[0] as string;
		const durationStr = lines[1] as string;
		const durationSeconds = Number.parseInt(durationStr, 10);

		if (!videoId || !Number.isFinite(durationSeconds) || durationSeconds < 0) {
			this.logger.error(
				{ videoId, durationStr, durationSeconds },
				"YtDlpBridge.probe: parsed lines but got invalid videoId or durationSeconds — synthesizing crash envelope",
			);
			const result: YtDlpProbeEnvelope = {
				videoId: null,
				durationSeconds: null,
				error: {
					type: "ytdlp_crash",
					message: `${YTDLP_CRASH_PREFIX} unparseable probe output: ${stdout.slice(0, 200)}`,
				},
			};
			return YtDlpProbeEnvelopeSchema.parse(result);
		}

		this.logger.debug(
			{ videoId, durationSeconds },
			"YtDlpBridge.probe: success",
		);

		// Defense-in-depth: validate the happy-path result against the Zod schema.
		// Mirrors SpotifyScraperBridge convention.
		const result: YtDlpProbeEnvelope = {
			videoId,
			durationSeconds,
			error: null,
		};
		return YtDlpProbeEnvelopeSchema.parse(result);
	}

	/**
	 * Download a YouTube video as MP3 to the specified output path.
	 *
	 * D-08 (Phase 3): Call 2 of probe-then-download. Only called when the probe
	 * result passed the ±tolerance_seconds gate. yt-dlp writes the file directly
	 * to `outputPath` and invokes ffmpeg for audio extraction internally.
	 *
	 * The bridge returns a typed envelope — file existence is verified by the
	 * caller (DownloadRunner), not here.
	 *
	 * T-3-01: videoId flows as part of the "https://www.youtube.com/watch?v=" + videoId URL argv.
	 * T-3-13: videoId is yt-dlp's own --print id output; URL is passed to yt-dlp itself.
	 * Spawn form: spawn(this.ytDlpBin, ["-f", "bestaudio", "--audio-format", "mp3", ...], opts)
	 */
	// biome-ignore format: keep method signature on one line for grep-based acceptance checks
	async download(videoId: string, outputPath: string): Promise<YtDlpDownloadEnvelope> {
		const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;

		// T-3-01: argv-form spawn.
		// -f bestaudio selects the best audio-only stream.
		// --extract-audio --audio-format mp3 --audio-quality 0 invoke ffmpeg post-processor.
		// --no-warnings -q suppress stdout output (download progress goes to stderr under -q).
		// -o outputPath is the final file path.
		const child = spawn(
			this.ytDlpBin,
			[
				"-f",
				"bestaudio",
				"--extract-audio",
				"--audio-format",
				"mp3",
				"--audio-quality",
				"0",
				"--no-warnings",
				"-q",
				"-o",
				outputPath,
				youtubeUrl,
			],
			{
				stdio: ["pipe", "pipe", "pipe"],
				timeout: this.downloadTimeoutMs,
			},
		);

		// Download stdout is empty under -q; buffer stderr only.
		const stderrChunks: Buffer[] = [];

		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		// yt-dlp takes everything via argv — NO stdin write.

		const [code, signal] = (await once(child, "close")) as [
			number | null,
			NodeJS.Signals | null,
		];

		const stderrFull = Buffer.concat(stderrChunks).toString("utf8").trim();

		if (code === 0) {
			this.logger.debug(
				{ videoId, outputPath },
				"YtDlpBridge.download: success",
			);
			const result: YtDlpDownloadEnvelope = { error: null };
			return YtDlpDownloadEnvelopeSchema.parse(result);
		}

		// Non-zero exit: classify failure type based on stderr content.
		// DOWNLOAD-05: exit code + stderr tail captured in failure envelope.
		const stderr = stderrFull.slice(0, STDERR_SLICE_LIMIT);
		this.logger.error(
			{ videoId, code, signal, stderrPreview: stderr },
			"YtDlpBridge.download: yt-dlp exited non-zero",
		);

		// Pitfall #3: ffmpeg errors show in stderr even when yt-dlp itself ran OK.
		// Detect via /ffmpeg|ffprobe/i to classify as ffmpeg_error vs generic download_error.
		const errorType = /ffmpeg|ffprobe/i.test(stderrFull)
			? "ffmpeg_error"
			: "download_error";

		// Message: if stderr is non-empty, lead with exit code + stderr.
		// W-1 prefix is NOT applied here (it's for probe crash; download has typed error enum).
		const message =
			stderrFull.length > 0
				? `exit=${code} ${stderr}`
				: `${YTDLP_CRASH_PREFIX} exit=${code} signal=${signal} stderr=`;

		const result: YtDlpDownloadEnvelope = {
			error: { type: errorType, message },
		};
		return YtDlpDownloadEnvelopeSchema.parse(result);
	}
}
