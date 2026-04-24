import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/sqlite-core";
import { describe, expect, it } from "vitest";
import { globalSettings, invocations, sources, tracks } from "./schema";

describe("db/schema — phase 1 contract", () => {
	describe("sources table (renamed from playlists)", () => {
		it("is named 'sources'", () => {
			expect(getTableName(sources)).toBe("sources");
		});

		it("has no flags_* columns", () => {
			const cols = Object.keys(getTableColumns(sources));
			expect(cols).not.toContain("flagsOverwrite");
			expect(cols).not.toContain("flagsRetries");
			expect(cols).not.toContain("flagsQuality");
			expect(cols).not.toContain("flagsFormat");
		});

		it("source_type enum is ['playlist','album'] (no 'track')", () => {
			const sourceType = getTableColumns(sources).sourceType;
			expect(sourceType.enumValues).toEqual(["playlist", "album"]);
		});

		it("has nullable coverArtUrl column", () => {
			const cols = getTableColumns(sources);
			expect(cols.coverArtUrl).toBeDefined();
			expect(cols.coverArtUrl.notNull).toBe(false);
		});
	});

	describe("tracks table (TRACK-01 + TRACK-02)", () => {
		it("is named 'tracks'", () => {
			expect(getTableName(tracks)).toBe("tracks");
		});

		it("exposes the full TRACK-02 column set", () => {
			const cols = Object.keys(getTableColumns(tracks)).sort();
			expect(cols).toEqual(
				[
					"id",
					"sourceId",
					"spotifyTrackId",
					"title",
					"artist",
					"durationMs",
					"state",
					"ytVideoId",
					"downloadPath",
					"failureReason",
					"position",
					"createdAt",
					"updatedAt",
				].sort(),
			);
		});

		it("state enum + default match TRACK-02 + D-09", () => {
			const state = getTableColumns(tracks).state;
			expect(state.enumValues).toEqual([
				"pending",
				"matched",
				"downloaded",
				"skipped_low_confidence",
				"failed",
			]);
			expect(state.default).toBe("pending");
		});

		it("has composite unique on (source_id, spotify_track_id) per TRACK-01", () => {
			const config = getTableConfig(tracks);
			const names = config.uniqueConstraints
				.map((u) =>
					u.columns
						.map((c) => c.name)
						.sort()
						.join(","),
				)
				.sort();
			expect(names).toContain("source_id,spotify_track_id");
		});

		it("cascades delete from sources to tracks", () => {
			const config = getTableConfig(tracks);
			const fk = config.foreignKeys.find(
				(f) => f.reference().columns[0].name === "source_id",
			);
			expect(fk).toBeDefined();
			expect(fk?.onDelete).toBe("cascade");
		});
	});

	describe("retained tables", () => {
		it("invocations + globalSettings still exported", () => {
			expect(invocations).toBeDefined();
			expect(globalSettings).toBeDefined();
		});
	});
});
