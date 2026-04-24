import { describe, expect, it } from "vitest";
import { CreatePlaylistFormSchema } from "./create-playlist-form";

/**
 * URL validation test matrix for CreatePlaylistFormSchema (SCRAPE-01, T-2-04 SSRF guard).
 *
 * The schema enforces:
 * - hostname must be exactly "open.spotify.com" (no subdomains, no other hosts)
 * - pathname must contain "/playlist/" OR "/album/"
 * - must be a valid URL (rejects bare strings)
 *
 * T-2-04 threat: a user-supplied sourceUrl could be used for SSRF if not validated.
 * The hostname exact-match mitigation lives here (client fast feedback) and is
 * duplicated server-side in Plan 04's SyncRunner (defense in depth).
 */

const validBase = {
	name: "Test Playlist",
	outputDir: "/data/music/test",
	enableSchedule: false,
	scheduleType: "interval" as const,
	scheduleMinutes: 1440,
};

describe("CreatePlaylistFormSchema — URL validation (SCRAPE-01, T-2-04 SSRF guard)", () => {
	// ─── Accept cases ─────────────────────────────────────────────────────────

	it("Test 1: accepts an open.spotify.com playlist URL", () => {
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
		});
		expect(result.success).toBe(true);
	});

	it("Test 2: accepts a playlist URL with query string (si param preserved)", () => {
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl:
				"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc123",
		});
		expect(result.success).toBe(true);
	});

	it("Test 3: accepts an album URL (Phase 4 scope — validator is intentionally broad; Phase 2 runtime rejects invalid source_type)", () => {
		// Phase 2 scraper rejects album at runtime with invalid_url until Phase 4 unlocks.
		// Keeping the validator broad means Phase 4 needs no client-side change.
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "https://open.spotify.com/album/1DFixLWuPkv3KT3TnV35m3",
		});
		expect(result.success).toBe(true);
	});

	// ─── Reject cases ─────────────────────────────────────────────────────────

	it("Test 4: rejects a non-spotify hostname (SSRF mitigation — T-2-04)", () => {
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "https://evil.example.com/playlist/abc",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe(
				"URL must be from Spotify (playlist or album)",
			);
		}
	});

	it("Test 5: rejects a Spotify subdomain (hostname must be exact match, not endsWith)", () => {
		// api.open.spotify.com is not open.spotify.com — endsWith would wrongly accept it.
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "https://api.open.spotify.com/playlist/abc",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe(
				"URL must be from Spotify (playlist or album)",
			);
		}
	});

	it("Test 6: documents current behavior for http:// (protocol not restricted in Phase 2 scope)", () => {
		// Phase 2 scope: validator accepts http:// for compatibility; T-2-04 mitigation
		// is "hostname must be open.spotify.com" — protocol hardening is out of scope.
		// If Phase 5 tightens this, this test flips to .toBe(false) and the comment moves.
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "http://open.spotify.com/playlist/abc",
		});
		// Document current behavior: http is accepted (validator does not restrict protocol).
		expect(result.success).toBe(true);
	});

	it("Test 7: rejects a wrong-path URL (artist page is not playlist or album)", () => {
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "https://open.spotify.com/artist/abc",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe(
				"URL must be from Spotify (playlist or album)",
			);
		}
	});

	it("Test 8: rejects a track URL (track path removed in Phase 1 D-11; Phase 2 preserves)", () => {
		// /track/ was removed from the allowed paths in Phase 1 D-11.
		// This test ensures Phase 2 did not accidentally re-add it.
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "https://open.spotify.com/track/abc",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues[0].message).toBe(
				"URL must be from Spotify (playlist or album)",
			);
		}
	});

	it("Test 9: rejects a non-URL string", () => {
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "not a url",
		});
		expect(result.success).toBe(false);
		// z.string().url() fires before the refine, so the message comes from the URL validator.
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});

	it("Test 10: rejects an empty string", () => {
		const result = CreatePlaylistFormSchema.safeParse({
			...validBase,
			sourceUrl: "",
		});
		expect(result.success).toBe(false);
		if (!result.success) {
			expect(result.error.issues.length).toBeGreaterThan(0);
		}
	});
});
