/**
 * Phase 2 integration test — real Python subprocess.
 *
 * GATED on SCRAPER_INTEGRATION=1. The scraper requires Python 3 + the
 * spotifyscraper venv at scraper/.venv/bin/python, which is only
 * guaranteed inside the Docker dev container (D-04 Docker-only dev).
 * Host `pnpm test` skips this file entirely so the fast feedback loop
 * stays fast.
 *
 * Run locally:
 *   pnpm docker:dev  # in another shell
 *   docker exec -it <dev-container> sh -c "SCRAPER_INTEGRATION=1 pnpm test -- integration"
 *
 * Fail modes handled: network errors during the live fetch are tolerated
 * (Spotify could be down); the test asserts contract correctness WHEN
 * the bridge returns a successful envelope. A network error envelope is
 * logged + the test is skipped-at-runtime with a message, not a hard fail.
 */
import { describe, expect, it } from "vitest";
import { SpotifyScraperBridge } from "./SpotifyScraperBridge";

// Spike-001 known-good public playlist URL (Today's Top Hits).
// Confirmed via .planning/spikes/001-spotifyscraper-feasibility/test_basic.py
// which hit this URL successfully on 2026-04-24 and returned 50 tracks.
const KNOWN_GOOD_PLAYLIST =
	"https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M";

const gated = process.env.SCRAPER_INTEGRATION === "1";
const d = gated ? describe : describe.skip;

d("SpotifyScraperBridge (gated — real Python subprocess)", () => {
	it("fetches the known-good playlist and returns a shaped envelope", async () => {
		const bridge = new SpotifyScraperBridge();
		const envelope = await bridge.fetchPlaylist(KNOWN_GOOD_PLAYLIST);

		// Tolerant branch: if the live network failed, don't hard-fail —
		// the contract test is about shape, not network availability.
		if (envelope.error?.type === "network_error") {
			// eslint-disable-next-line no-console
			console.warn(
				"[integration] network_error — Spotify may be unreachable; skipping shape asserts",
				envelope.error.message.slice(0, 200),
			);
			return;
		}

		expect(envelope.error).toBeNull();
		expect(envelope.tracks).not.toBeNull();
		expect(envelope.tracks?.length).toBeGreaterThanOrEqual(1);

		const firstTrack = envelope.tracks?.[0];
		expect(firstTrack?.spotify_track_id).toMatch(/^[a-zA-Z0-9]{20,30}$/);
		expect(firstTrack?.title).toBeTypeOf("string");
		expect(typeof firstTrack?.title === "string" && firstTrack.title.length).toBeGreaterThan(0);
		expect(firstTrack?.artist).toBeTypeOf("string");
		expect(firstTrack?.duration_ms).toBeGreaterThan(0);
		expect(firstTrack?.position).toBe(0);

		// cover_art_url can be null for playlists without art — but Today's
		// Top Hits always has art. If the spike's chosen URL changes, this
		// may need to relax to `typeof === "string" | null`.
		if (envelope.cover_art_url !== null) {
			expect(envelope.cover_art_url).toMatch(/^https:\/\//);
		}
	}, 60_000 /* timeout: 60s — real network + real Python */);

	it("fetches a deliberately invalid URL and returns a typed error envelope", async () => {
		const bridge = new SpotifyScraperBridge();
		const envelope = await bridge.fetchPlaylist(
			"https://open.spotify.com/playlist/DOES-NOT-EXIST-0000000000",
		);
		// Spotify may return parse_error or not_found depending on heuristic
		expect(envelope.tracks).toBeNull();
		expect(envelope.error).not.toBeNull();
		expect(["not_found", "parse_error", "network_error"]).toContain(
			envelope.error?.type,
		);
	}, 60_000);
});
