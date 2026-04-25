import { copyFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import NodeID3 from "node-id3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type CoverArt, embedTags, type TagInput } from "./tagger";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(__dirname, "fixtures", "silence.mp3");

describe("embedTags", () => {
	let testFile: string;

	beforeEach(async () => {
		testFile = path.join(
			tmpdir(),
			`tagger-test-${Date.now()}-${Math.random()}.mp3`,
		);
		await copyFile(FIXTURE, testFile);
	});

	afterEach(async () => {
		try {
			await unlink(testFile);
		} catch {
			// ENOENT is fine — test may have already removed the file
		}
	});

	it("TIT2 + TPE1 round-trip — writes title and artist", () => {
		embedTags(testFile, { title: "Foo", artist: "Bar" });
		const tags = NodeID3.read(testFile);
		expect(tags.title).toBe("Foo");
		expect(tags.artist).toBe("Bar");
	});

	it("TALB present when album set", () => {
		embedTags(testFile, { title: "Song", artist: "Artist", album: "MyAlbum" });
		const tags = NodeID3.read(testFile);
		expect(tags.album).toBe("MyAlbum");
	});

	it("TALB omitted when album=undefined (D-13)", () => {
		embedTags(testFile, { title: "Song", artist: "Artist" });
		const tags = NodeID3.read(testFile);
		// album should be absent or empty — never a meaningful value
		expect(tags.album == null || tags.album === "").toBe(true);
	});

	it("TALB omitted when album=null (D-13)", () => {
		embedTags(testFile, { title: "Song", artist: "Artist", album: null });
		const tags = NodeID3.read(testFile);
		expect(tags.album == null || tags.album === "").toBe(true);
	});

	it("APIC present when coverArt set", () => {
		// Create a minimal valid JPEG-like buffer (just needs to be non-empty)
		const fakeImageBuffer = Buffer.alloc(64, 0xff);
		const coverArt: CoverArt = { buffer: fakeImageBuffer, mime: "image/jpeg" };
		embedTags(testFile, { title: "Song", artist: "Artist", coverArt });
		const tags = NodeID3.read(testFile);
		// image should be present and have data
		expect(tags.image).toBeDefined();
		const imageData = tags.image as { imageBuffer: Buffer };
		expect(imageData.imageBuffer.length).toBeGreaterThan(0);
	});

	it("APIC omitted when coverArt=undefined (D-14)", () => {
		embedTags(testFile, { title: "Song", artist: "Artist" });
		const tags = NodeID3.read(testFile);
		// No cover art should be embedded
		expect(tags.image == null || tags.image === "").toBe(true);
	});

	it("APIC omitted when coverArt=null (D-14)", () => {
		embedTags(testFile, { title: "Song", artist: "Artist", coverArt: null });
		const tags = NodeID3.read(testFile);
		expect(tags.image == null || tags.image === "").toBe(true);
	});

	it("throws when node-id3 returns an Error (Pitfall #10) — missing parent dir", () => {
		const badPath = `/tmp/nope-${Date.now()}/file.mp3`;
		expect(() => embedTags(badPath, { title: "X", artist: "Y" })).toThrow();
	});

	it("determinism / idempotence — second write produces same read values", () => {
		const input: TagInput = {
			title: "Replay",
			artist: "Artist2",
			album: "Album2",
		};
		embedTags(testFile, input);
		embedTags(testFile, input);
		const tags = NodeID3.read(testFile);
		expect(tags.title).toBe("Replay");
		expect(tags.artist).toBe("Artist2");
		expect(tags.album).toBe("Album2");
	});
});
