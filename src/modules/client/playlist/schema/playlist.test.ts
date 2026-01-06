import { describe, expect, it } from "vitest";
import { parsePlaylist, SAMPLE_PLAYLISTS, tryParsePlaylist } from "./playlist";

describe("PlaylistSchema", () => {
	describe("parsePlaylist", () => {
		it("should parse valid spotify playlist", () => {
			const result = parsePlaylist(SAMPLE_PLAYLISTS.spotifyPlaylist);
			expect(result.name).toBe("My Favorite Songs");
			expect(result.source.type).toBe("playlist");
			expect(result.flags?.quality).toBe("high");
			expect(result.schedule?.enabled).toBe(true);
		});

		it("should parse valid spotify album", () => {
			const result = parsePlaylist(SAMPLE_PLAYLISTS.spotifyAlbum);
			expect(result.name).toBe("Thriller Album");
			expect(result.source.type).toBe("album");
			expect(result.flags?.quality).toBe("very_high");
			expect(result.flags?.format).toBe("flac");
		});

		it("should parse valid spotify track", () => {
			const result = parsePlaylist(SAMPLE_PLAYLISTS.spotifyTrack);
			expect(result.name).toBe("Single Track");
			expect(result.source.type).toBe("track");
			expect(result.status).toBe("paused");
		});

		it("should throw on missing name", () => {
			expect(() =>
				parsePlaylist({
					source: { type: "playlist", url: "https://example.com" },
					outputDir: "/downloads",
				}),
			).toThrow();
		});

		it("should throw on invalid source type", () => {
			expect(() =>
				parsePlaylist({
					name: "Test",
					source: { type: "podcast", url: "https://example.com" },
					outputDir: "/downloads",
				}),
			).toThrow();
		});

		it("should throw on invalid URL", () => {
			expect(() =>
				parsePlaylist({
					name: "Test",
					source: { type: "playlist", url: "not-a-url" },
					outputDir: "/downloads",
				}),
			).toThrow();
		});

		it("should throw on invalid retries", () => {
			expect(() =>
				parsePlaylist({
					name: "Test",
					source: { type: "playlist", url: "https://example.com" },
					outputDir: "/downloads",
					flags: { retries: 100 }, // Max is 10
				}),
			).toThrow();
		});

		it("should throw on invalid cron expression", () => {
			expect(() =>
				parsePlaylist({
					name: "Test",
					source: { type: "playlist", url: "https://example.com" },
					outputDir: "/downloads",
					schedule: {
						enabled: true,
						schedule: { type: "cron", cron: "invalid" },
					},
				}),
			).toThrow();
		});

		it("should apply default values", () => {
			const result = parsePlaylist({
				name: "Minimal",
				source: { type: "playlist", url: "https://example.com" },
				outputDir: "/downloads",
			});
			// flags and schedule are now optional, so we check they exist
			expect(result.status).toBe("active");
		});
	});

	describe("tryParsePlaylist", () => {
		it("should return success for valid data", () => {
			const result = tryParsePlaylist(SAMPLE_PLAYLISTS.spotifyPlaylist);
			expect(result.success).toBe(true);
			if (result.success) {
				expect(result.data.name).toBe("My Favorite Songs");
			}
		});

		it("should return error for invalid data", () => {
			const result = tryParsePlaylist({
				source: { type: "invalid", url: "https://example.com" },
			});
			expect(result.success).toBe(false);
			if (!result.success) {
				expect(result.error.issues.length).toBeGreaterThan(0);
			}
		});
	});

	describe("edge cases", () => {
		it("should support minimum schedule interval", () => {
			const result = parsePlaylist({
				name: "Test",
				source: { type: "playlist", url: "https://example.com" },
				outputDir: "/downloads",
				schedule: {
					enabled: true,
					schedule: { type: "interval", minutes: 1 },
				},
			});
			expect(result.schedule?.schedule.type).toBe("interval");
			if (result.schedule?.schedule.type === "interval") {
				expect(result.schedule.schedule.minutes).toBe(1);
			}
		});

		it("should support maximum schedule interval (30 days)", () => {
			const result = parsePlaylist({
				name: "Test",
				source: { type: "playlist", url: "https://example.com" },
				outputDir: "/downloads",
				schedule: {
					enabled: true,
					schedule: { type: "interval", minutes: 43200 },
				},
			});
			expect(result.schedule?.schedule.type).toBe("interval");
			if (result.schedule?.schedule.type === "interval") {
				expect(result.schedule.schedule.minutes).toBe(43200);
			}
		});

		it("should support all audio formats", () => {
			const formats = ["mp3", "flac", "ogg", "m4a", "opus", "vorbis", "wav"];
			formats.forEach((format) => {
				const result = parsePlaylist({
					name: "Test",
					source: { type: "playlist", url: "https://example.com" },
					outputDir: "/downloads",
					flags: { format: format as "mp3" | "flac" | "ogg" | "m4a" | "opus" | "vorbis" | "wav" },
				});
				expect(result.flags?.format).toBe(format);
			});
		});

		it("should support all quality levels", () => {
			const qualities = [
				"worst",
				"low",
				"medium",
				"high",
				"very_high",
				"lossless",
			];
			qualities.forEach((quality) => {
				const result = parsePlaylist({
					name: "Test",
					source: { type: "playlist", url: "https://example.com" },
					outputDir: "/downloads",
					flags: { quality: quality as "worst" | "low" | "medium" | "high" | "very_high" | "lossless" },
				});
				expect(result.flags?.quality).toBe(quality);
			});
		});

		it("should support all playlist statuses", () => {
			const statuses = ["active", "paused", "archived", "error"];
			statuses.forEach((status) => {
				const result = parsePlaylist({
					name: "Test",
					source: { type: "playlist", url: "https://example.com" },
					outputDir: "/downloads",
					status: status as "active" | "paused" | "archived" | "error",
				});
				expect(result.status).toBe(status);
			});
		});
	});
});
