/**
 * DownloadRepository tests — in-memory SQLite via better-sqlite3 + the latest
 * Drizzle migration (W-5: do NOT hand-write CREATE TABLE).
 */

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import * as schema from "../db/schema";
import { DEFAULT_MATCH_SETTINGS } from "./schema";
import { DownloadRepository } from "./repository";

// ---------------------------------------------------------------------------
// Schema setup — W-5: read the latest Drizzle migration instead of hand-writing
// ---------------------------------------------------------------------------

function createTestDb() {
	const sqlite = new Database(":memory:");
	// Apply ALL migrations in order (W-5: delta migrations added by Phase 3+
	// require all prior migrations to run first).
	const migrationDir = path.resolve("drizzle");
	const migrations = fs
		.readdirSync(migrationDir)
		.filter((f) => f.endsWith(".sql"))
		.sort();
	for (const migration of migrations) {
		const migrationSql = fs
			.readFileSync(path.join(migrationDir, migration), "utf8")
			.replace(/--> statement-breakpoint/g, "");
		sqlite.exec(migrationSql);
	}
	return drizzle(sqlite, { schema });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function seedSource(db: ReturnType<typeof createTestDb>, id = "src-1") {
	await db.insert(schema.sources).values({
		id,
		name: "Test Playlist",
		sourceType: "playlist",
		sourceUrl: "https://open.spotify.com/playlist/abc",
		outputDir: "/data/music/test",
	});
}

async function seedTrack(
	db: ReturnType<typeof createTestDb>,
	overrides: Partial<schema.NewTrackRow> = {},
) {
	const row: schema.NewTrackRow = {
		id: randomUUID(),
		sourceId: "src-1",
		spotifyTrackId: randomUUID(),
		title: "Test Song",
		artist: "Test Artist",
		durationMs: 180000,
		state: "pending",
		position: 0,
		...overrides,
	};
	await db.insert(schema.tracks).values(row);
	return row;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

let db: ReturnType<typeof createTestDb>;
let repo: DownloadRepository;

beforeEach(async () => {
	db = createTestDb();
	repo = new DownloadRepository(db as unknown as import("../db").TDatabase);
	await seedSource(db);
});

describe("DownloadRepository.getTracksToProcess", () => {
	it("Test 1: returns only state=pending+matched rows for the given sourceId", async () => {
		await seedTrack(db, { state: "pending", spotifyTrackId: "t-pending" });
		await seedTrack(db, { state: "matched", spotifyTrackId: "t-matched" });

		const rows = await repo.getTracksToProcess("src-1");
		expect(rows).toHaveLength(2);
		const states = rows.map((r) => r.state).sort();
		expect(states).toEqual(["matched", "pending"]);
	});

	it("Test 2: excludes downloaded, failed, skipped_low_confidence states", async () => {
		await seedTrack(db, { state: "downloaded", spotifyTrackId: "t-dl" });
		await seedTrack(db, { state: "failed", spotifyTrackId: "t-fail" });
		await seedTrack(db, { state: "skipped_low_confidence", spotifyTrackId: "t-skip" });

		const rows = await repo.getTracksToProcess("src-1");
		expect(rows).toHaveLength(0);
	});

	it("Test 3: excludes other sources' rows", async () => {
		await seedSource(db, "src-2");
		await seedTrack(db, { sourceId: "src-1", state: "pending", spotifyTrackId: "t1" });
		await seedTrack(db, { sourceId: "src-2", state: "pending", spotifyTrackId: "t2" });

		const rows = await repo.getTracksToProcess("src-1");
		expect(rows).toHaveLength(1);
		expect(rows[0].sourceId).toBe("src-1");
	});
});

describe("DownloadRepository.markMatched", () => {
	it("Test 4: writes state=matched + ytVideoId, preserves other fields", async () => {
		const track = await seedTrack(db, { title: "My Song", artist: "My Artist", durationMs: 120000 });

		await repo.markMatched(track.id, "yt-abc123");

		const [row] = await db.select().from(schema.tracks).where(
			(await import("drizzle-orm")).eq(schema.tracks.id, track.id),
		);
		expect(row.state).toBe("matched");
		expect(row.ytVideoId).toBe("yt-abc123");
		expect(row.title).toBe("My Song");
		expect(row.artist).toBe("My Artist");
		expect(row.durationMs).toBe(120000);
	});
});

describe("DownloadRepository.markDownloaded", () => {
	it("Test 5: writes state=downloaded + downloadPath", async () => {
		const track = await seedTrack(db, { state: "matched", ytVideoId: "yt-vid" });

		await repo.markDownloaded(track.id, "/data/music/test/Artist - Song.mp3");

		const [row] = await db.select().from(schema.tracks).where(
			(await import("drizzle-orm")).eq(schema.tracks.id, track.id),
		);
		expect(row.state).toBe("downloaded");
		expect(row.downloadPath).toBe("/data/music/test/Artist - Song.mp3");
	});
});

describe("DownloadRepository.markFailed", () => {
	it("Test 6: truncates message > 500 chars and prefixes with errorType", async () => {
		const track = await seedTrack(db);
		const longMessage = "x".repeat(600);

		await repo.markFailed(track.id, "download_error", longMessage);

		const [row] = await db.select().from(schema.tracks).where(
			(await import("drizzle-orm")).eq(schema.tracks.id, track.id),
		);
		expect(row.state).toBe("failed");
		expect(row.failureReason).toBeDefined();
		// prefix included
		expect(row.failureReason).toContain("download_error:");
		// message portion is capped at 500
		const messagePart = row.failureReason!.replace("download_error: ", "");
		expect(messagePart.length).toBeLessThanOrEqual(500);
	});

	it("Test 7: stores errorType: message format with exact prefix", async () => {
		const track = await seedTrack(db);

		await repo.markFailed(track.id, "ytdlp_crash", "spawn error ENOENT");

		const [row] = await db.select().from(schema.tracks).where(
			(await import("drizzle-orm")).eq(schema.tracks.id, track.id),
		);
		expect(row.failureReason).toBe("ytdlp_crash: spawn error ENOENT");
	});
});

describe("DownloadRepository.markSkippedLowConfidence", () => {
	it("Test 8: writes state=skipped_low_confidence + reason; downloadPath stays null", async () => {
		const track = await seedTrack(db);

		await repo.markSkippedLowConfidence(track.id, null, "delta=10s, tolerance=3s");

		const [row] = await db.select().from(schema.tracks).where(
			(await import("drizzle-orm")).eq(schema.tracks.id, track.id),
		);
		expect(row.state).toBe("skipped_low_confidence");
		expect(row.failureReason).toBe("delta=10s, tolerance=3s");
		expect(row.downloadPath).toBeNull();
	});

	it("Test 9: writes ytVideoId when provided", async () => {
		const track = await seedTrack(db);

		await repo.markSkippedLowConfidence(track.id, "yt-vid-skipped", "delta=5s, tolerance=3s");

		const [row] = await db.select().from(schema.tracks).where(
			(await import("drizzle-orm")).eq(schema.tracks.id, track.id),
		);
		expect(row.ytVideoId).toBe("yt-vid-skipped");
	});
});

describe("DownloadRepository.getMatchSettings", () => {
	it("Test 10: returns DEFAULT_MATCH_SETTINGS when row absent", async () => {
		const settings = await repo.getMatchSettings();
		expect(settings).toEqual(DEFAULT_MATCH_SETTINGS);
	});

	it("Test 11: returns parsed JSON when row exists", async () => {
		await db.insert(schema.globalSettings).values({
			key: "match",
			value: JSON.stringify({ tolerance_seconds: 5, parallel: 2 }),
		});

		const settings = await repo.getMatchSettings();
		expect(settings.tolerance_seconds).toBe(5);
		expect(settings.parallel).toBe(2);
	});

	it("Test 12: returns DEFAULT on JSON.parse failure (graceful)", async () => {
		await db.insert(schema.globalSettings).values({
			key: "match",
			value: "not-valid-json{{{",
		});

		const settings = await repo.getMatchSettings();
		expect(settings).toEqual(DEFAULT_MATCH_SETTINGS);
	});
});

describe("DownloadRepository.saveMatchSettings", () => {
	it("Test 13: inserts new row when key absent", async () => {
		await repo.saveMatchSettings({ tolerance_seconds: 4, parallel: 4 });

		const [row] = await db.select().from(schema.globalSettings).where(
			(await import("drizzle-orm")).eq(schema.globalSettings.key, "match"),
		);
		expect(row).toBeDefined();
		const val = JSON.parse(row.value);
		expect(val.tolerance_seconds).toBe(4);
		expect(val.parallel).toBe(4);
	});

	it("Test 14: upserts existing row (idempotent re-save)", async () => {
		await repo.saveMatchSettings({ tolerance_seconds: 3, parallel: 3 });
		await repo.saveMatchSettings({ tolerance_seconds: 2, parallel: 2 });

		const rows = await db.select().from(schema.globalSettings).where(
			(await import("drizzle-orm")).eq(schema.globalSettings.key, "match"),
		);
		expect(rows).toHaveLength(1);
		const val = JSON.parse(rows[0].value);
		expect(val.parallel).toBe(2);
	});
});

describe("DownloadRepository.getSource", () => {
	it("Test 15: returns the row by id", async () => {
		const source = await repo.getSource("src-1");
		expect(source).not.toBeNull();
		expect(source!.id).toBe("src-1");
		expect(source!.name).toBe("Test Playlist");
	});

	it("Test 16: returns null when absent", async () => {
		const source = await repo.getSource("nonexistent-id");
		expect(source).toBeNull();
	});
});
