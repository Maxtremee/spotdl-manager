import { z } from "zod";

/**
 * Shared prefix for synthesized yt-dlp crash envelope messages.
 *
 * W-1: YtDlpBridge (Plan 03-02) writes this prefix in the synthesized error
 * envelope when yt-dlp exits non-zero without parseable stdout. DownloadRunner
 * (Plan 03-04) detects via `.startsWith(YTDLP_CRASH_PREFIX)` and reclassifies.
 * Bridge writes: `${YTDLP_CRASH_PREFIX} exit=N signal=... stderr=...`.
 */
export const YTDLP_CRASH_PREFIX = "yt-dlp crash:";

/**
 * Phase 3 D-08 / D-09: typed failure taxonomy for the YtDlpBridge envelope.
 * - no_results: empty stdout + exit 0 (yt-dlp ytsearch1 zero-hits, gh#8033)
 * - network_error: DNS / connection failure
 * - download_error: yt-dlp non-zero during download (e.g. 403, age-gated)
 * - ffmpeg_error: ffmpeg post-processor failure
 * - ytdlp_crash: unexpected non-zero exit / unparseable output
 * - tagger_error: node-id3 write failure (synthesized DownloadRunner-side, not bridge)
 */
export const YtDlpErrorSchema = z.object({
	type: z.enum([
		"no_results",
		"network_error",
		"download_error",
		"ffmpeg_error",
		"ytdlp_crash",
		"tagger_error",
	]),
	message: z.string(),
});
export type YtDlpError = z.infer<typeof YtDlpErrorSchema>;

/**
 * Probe envelope: yt-dlp --print id --print duration --skip-download.
 * stdout shape: "<videoId>\n<durationSeconds>\n" parsed by the bridge into the fields below.
 */
export const YtDlpProbeEnvelopeSchema = z.object({
	videoId: z.string().min(1).nullable(),
	durationSeconds: z.number().int().nonnegative().nullable(),
	error: YtDlpErrorSchema.nullable(),
});
export type YtDlpProbeEnvelope = z.infer<typeof YtDlpProbeEnvelopeSchema>;

/**
 * Download envelope: success carries no payload, failure carries a typed error.
 */
export const YtDlpDownloadEnvelopeSchema = z.object({
	error: YtDlpErrorSchema.nullable(),
});
export type YtDlpDownloadEnvelope = z.infer<typeof YtDlpDownloadEnvelopeSchema>;

/**
 * Phase 3 D-16: match-settings JSON row in global_settings.
 * Read once at DownloadRunner.run start; mid-run setting changes do NOT apply.
 */
export const MATCH_SETTINGS_KEY = "match" as const;

export const MatchSettingsSchema = z.object({
	tolerance_seconds: z.number().int().min(0).max(60).default(3),
	parallel: z.union([z.literal(2), z.literal(3), z.literal(4)]).default(3),
});
export type MatchSettings = z.infer<typeof MatchSettingsSchema>;

export const DEFAULT_MATCH_SETTINGS: MatchSettings = MatchSettingsSchema.parse(
	{},
);
