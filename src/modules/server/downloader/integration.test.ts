/**
 * Phase 3 integration test — real yt-dlp + ffmpeg subprocesses.
 *
 * GATED on DOWNLOADER_INTEGRATION=1. Requires yt-dlp + ffmpeg installed and
 * on PATH (or YT_DLP_BIN env override) — guaranteed inside the Docker dev
 * container after Phase 3's Dockerfile additions (which install yt-dlp from
 * scraper/requirements.txt and export YT_DLP_BIN=/app/scraper/.venv/bin/yt-dlp).
 *
 * Run locally (inside the dev container after rebuild):
 *   pnpm docker:dev  # in another shell — rebuilds with yt-dlp pinned
 *   docker exec -it <dev-container> sh -c "DOWNLOADER_INTEGRATION=1 pnpm test src/modules/server/downloader/integration.test.ts"
 *
 * Fail modes handled: network/YouTube unavailability is tolerated (test logs a
 * warning + skips shape asserts); the test asserts contract correctness WHEN the
 * live fetch succeeds. CI / sandboxed runners without YouTube access still pass.
 *
 * Track choice: "Kevin MacLeod Carefree" — royalty-free, widely indexed on YouTube,
 * short duration (~2 min), stable for CI use. MacLeod publishes under CC-BY licence.
 */

import { stat, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import NodeID3 from "node-id3";
import { afterEach, describe, expect, it } from "vitest";
import { safeFilename } from "./slug";
import { embedTags } from "./tagger";
import { YtDlpBridge } from "./YtDlpBridge";

const KNOWN_GOOD_QUERY = "Kevin MacLeod Carefree";

const gated = process.env.DOWNLOADER_INTEGRATION === "1";
const d = gated ? describe : describe.skip;

// Track temp files created during tests for afterEach cleanup.
const tempFiles: string[] = [];

afterEach(async () => {
	for (const filePath of tempFiles.splice(0)) {
		await unlink(filePath).catch(() => {
			// ENOENT is expected if the test already unlinked or never created the file.
		});
	}
});

d("YtDlpBridge + tagger + node-id3 (gated — real subprocesses)", () => {
	it("probe known-good track returns shaped envelope", async () => {
		const bridge = new YtDlpBridge();
		const probe = await bridge.probe(KNOWN_GOOD_QUERY);

		// Tolerant branch: if YouTube is unreachable, skip shape asserts.
		if (probe.error?.type === "network_error") {
			console.warn(
				"[integration] network_error — YouTube may be unreachable; skipping shape asserts",
				probe.error.message.slice(0, 200),
			);
			return;
		}

		expect(probe.error).toBeNull();
		expect(probe.videoId).toBeTruthy();
		// yt-dlp video IDs are 11 characters (alphanumeric + _ and -).
		expect(probe.videoId?.length).toBeGreaterThanOrEqual(8);
		expect(probe.durationSeconds).not.toBeNull();
		expect(probe.durationSeconds).toBeGreaterThan(0);
	}, 60_000);

	it("probe deliberately-unmatchable query returns no_results", async () => {
		const bridge = new YtDlpBridge();
		const probe = await bridge.probe(
			"qwerasdfzxcv impossible nonsense 12345 2026",
		);

		// Tolerant branch: a network_error here is also acceptable.
		if (probe.error?.type === "network_error") {
			console.warn(
				"[integration] network_error during no_results probe — YouTube may be unreachable; skipping assert",
				probe.error.message.slice(0, 200),
			);
			return;
		}

		expect(probe.error).not.toBeNull();
		expect(probe.error?.type).toBe("no_results");
		expect(probe.videoId).toBeNull();
	}, 60_000);

	it("download produces a real MP3 on disk", async () => {
		const bridge = new YtDlpBridge();

		// Probe first so we get the canonical videoId rather than hardcoding one.
		const probe = await bridge.probe(KNOWN_GOOD_QUERY);

		if (probe.error?.type === "network_error") {
			console.warn(
				"[integration] network_error in probe — skipping download test",
				probe.error.message.slice(0, 200),
			);
			return;
		}

		expect(probe.error).toBeNull();
		expect(probe.videoId).toBeTruthy();

		const targetPath = path.join(tmpdir(), `dl-test-${Date.now()}.mp3`);
		tempFiles.push(targetPath);

		const dl = await bridge.download(probe.videoId as string, targetPath);

		if (dl.error?.type === "network_error") {
			console.warn(
				"[integration] network_error during download — skipping file assert",
				dl.error.message.slice(0, 200),
			);
			return;
		}

		expect(dl.error).toBeNull();

		const stats = await stat(targetPath);
		// A real MP3 must be larger than 1 KB.
		expect(stats.size).toBeGreaterThan(1024);
	}, 120_000);

	it("tag round-trip: embedTags writes TIT2/TPE1 readable by NodeID3.read", async () => {
		const bridge = new YtDlpBridge();

		const probe = await bridge.probe(KNOWN_GOOD_QUERY);

		if (probe.error?.type === "network_error") {
			console.warn(
				"[integration] network_error in probe — skipping tag round-trip test",
				probe.error.message.slice(0, 200),
			);
			return;
		}

		expect(probe.error).toBeNull();
		expect(probe.videoId).toBeTruthy();

		const targetPath = path.join(tmpdir(), `tag-roundtrip-${Date.now()}.mp3`);
		tempFiles.push(targetPath);

		const dl = await bridge.download(probe.videoId as string, targetPath);

		if (dl.error?.type === "network_error") {
			console.warn(
				"[integration] network_error during download — skipping tag round-trip test",
				dl.error.message.slice(0, 200),
			);
			return;
		}

		expect(dl.error).toBeNull();

		// Embed tags using the production tagger.
		embedTags(targetPath, { title: "Test Title", artist: "Test Artist" });

		// Read back via NodeID3 and verify the round-trip.
		const read = NodeID3.read(targetPath);
		expect(read.title).toBe("Test Title");
		expect(read.artist).toBe("Test Artist");
		// No album was passed — TALB frame must be absent (D-13).
		expect(read.album).toBeFalsy();
	}, 120_000);

	it("end-to-end: safeFilename produces a sanitized path for the canonical output shape", async () => {
		const bridge = new YtDlpBridge();

		const probe = await bridge.probe(KNOWN_GOOD_QUERY);

		if (probe.error?.type === "network_error") {
			console.warn(
				"[integration] network_error in probe — skipping end-to-end test",
				probe.error.message.slice(0, 200),
			);
			return;
		}

		expect(probe.error).toBeNull();
		expect(probe.videoId).toBeTruthy();

		// Compute the canonical output filename before downloading.
		const filename = safeFilename("Kevin MacLeod", "Carefree");
		// Verify sanitization: no filesystem-unsafe characters, ends in .mp3.
		expect(filename).toMatch(/\.mp3$/);
		expect(filename).not.toMatch(/[<>:"/\\|?*]/);

		const targetPath = path.join(tmpdir(), `e2e-${Date.now()}-${filename}`);
		tempFiles.push(targetPath);

		const dl = await bridge.download(probe.videoId as string, targetPath);

		if (dl.error?.type === "network_error") {
			console.warn(
				"[integration] network_error during download — skipping end-to-end file assert",
				dl.error.message.slice(0, 200),
			);
			return;
		}

		expect(dl.error).toBeNull();

		// Embed production-style tags then verify the full pipeline output.
		embedTags(targetPath, { title: "Carefree", artist: "Kevin MacLeod" });

		const stats = await stat(targetPath);
		expect(stats.size).toBeGreaterThan(1024);

		const read = NodeID3.read(targetPath);
		expect(read.title).toBe("Carefree");
		expect(read.artist).toBe("Kevin MacLeod");
	}, 120_000);
});
