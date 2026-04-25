import { describe, expect, it } from "vitest";
import { safeFilename, sourceSlug } from "./slug";

describe("sourceSlug", () => {
	it("slugifies a standard playlist name", () => {
		expect(sourceSlug("Today's Top Hits")).toBe("todays-top-hits");
	});

	it("handles special characters like #", () => {
		expect(sourceSlug("Daily Mix #1")).toBe("daily-mix-1");
	});

	it("returns 'untitled' for an empty string", () => {
		expect(sourceSlug("")).toBe("untitled");
	});

	it("returns a non-empty deterministic string for unicode titles", () => {
		const result = sourceSlug("日本語 タイトル");
		expect(typeof result).toBe("string");
		expect(result.length).toBeGreaterThan(0);
		// deterministic: same input produces same output
		expect(result).toBe(sourceSlug("日本語 タイトル"));
	});
});

describe("safeFilename", () => {
	it("produces standard 'Artist - Title.mp3' format", () => {
		expect(safeFilename("Artist", "Title")).toBe("Artist - Title.mp3");
	});

	it("strips filesystem-unsafe characters from artist and title", () => {
		const result = safeFilename("Bad/Char\\Name", "X*Y?Z");
		expect(result).not.toMatch(/[/\\*?]/);
		expect(result.endsWith(".mp3")).toBe(true);
	});

	it("prepends _ for Windows reserved name CON", () => {
		expect(safeFilename("CON", "Test")).toMatch(/^_/);
	});

	it("prepends _ for Windows reserved name PRN", () => {
		expect(safeFilename("PRN", "X")).toMatch(/^_/);
	});

	it("prepends _ for Windows reserved name AUX", () => {
		expect(safeFilename("AUX", "X")).toMatch(/^_/);
	});

	it("prepends _ for Windows reserved name NUL", () => {
		expect(safeFilename("NUL", "X")).toMatch(/^_/);
	});

	it("prepends _ for Windows reserved name COM1", () => {
		expect(safeFilename("COM1", "X")).toMatch(/^_/);
	});

	it("prepends _ for Windows reserved name LPT9", () => {
		expect(safeFilename("LPT9", "X")).toMatch(/^_/);
	});

	it("strips trailing dots before .mp3 extension", () => {
		const result = safeFilename("Trailing.", "Dots..");
		// The result should not have trailing dots just before .mp3
		expect(result).not.toMatch(/\.+\.mp3$/);
		expect(result.endsWith(".mp3")).toBe(true);
	});

	it("caps total filename length at 204 chars (200 + .mp3)", () => {
		const longArtist = "A".repeat(150);
		const longTitle = "B".repeat(150);
		const result = safeFilename(longArtist, longTitle);
		expect(result.length).toBeLessThanOrEqual(204);
	});

	it("is deterministic — same input always produces same output", () => {
		expect(safeFilename("Artist", "Title")).toBe(
			safeFilename("Artist", "Title"),
		);
	});
});
