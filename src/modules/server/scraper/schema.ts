import { z } from "zod";
import { FailureReasonSchema } from "../events/schema";

/**
 * Shared prefix for synthesized python_crash envelope messages.
 *
 * W-1 (plan-checker review): bridge (this plan) and SyncRunner (Plan 04)
 * MUST import this constant rather than hand-duplicating the literal
 * string. Single source of truth — renaming it here forces the compiler
 * to flag every consumer.
 *
 * The bridge writes: `{PYTHON_CRASH_PREFIX} exit=N signal=... stderr=...`.
 * SyncRunner detects via `envelope.error.message.startsWith(PYTHON_CRASH_PREFIX)`.
 */
export const PYTHON_CRASH_PREFIX = "python crash:";

/**
 * Contract for Python → Node via stdout.
 * Emitted by `scraper/scraper.py` (Plan 01).
 *
 * NOTE: the `error.type` enum here is ONLY the 4 Python-side failure types;
 * `python_crash` is synthesized Node-side by SpotifyScraperBridge when Python
 * exits non-zero without a parseable envelope. See Plan 03 for the synthesis.
 */
export const PythonErrorSchema = z.object({
	type: z.enum(["invalid_url", "not_found", "parse_error", "network_error"]),
	message: z.string(),
});
export type PythonError = z.infer<typeof PythonErrorSchema>;

/**
 * Per-track shape emitted by Python's `_normalize`.
 * `spotify_track_id` derivation (uri.split(':')[-1]) happens Python-side —
 * we validate the shape but do not re-derive on Node.
 */
export const PythonTrackSchema = z.object({
	spotify_track_id: z.string().min(1),
	title: z.string(),
	artist: z.string(),
	duration_ms: z.number().int().nonnegative(),
	position: z.number().int().nonnegative(),
});
export type PythonTrack = z.infer<typeof PythonTrackSchema>;

export const PythonEnvelopeSchema = z.object({
	tracks: z.array(PythonTrackSchema).nullable(),
	// Relaxed from z.string().url() to handle Spotify CDN URLs defensively
	// (research Pitfall 7); Zod 4 URL parser tightened rules. Null is valid
	// when the playlist has no cover art.
	cover_art_url: z.string().min(1).nullable(),
	error: PythonErrorSchema.nullable(),
});
export type PythonEnvelope = z.infer<typeof PythonEnvelopeSchema>;

/**
 * Node → Python stdin contract. Phase 2 hardcodes source_type: "playlist";
 * Phase 4 will widen to include "album".
 */
export interface ScrapeRequest {
	url: string;
	source_type: "playlist";
}

// Re-export so callers (SyncRunner, tests) don't need two imports.
export { FailureReasonSchema };
export type { FailureReason } from "../events/schema";
