import NodeID3 from "node-id3";
import { Logger } from "~/logger";

const logger = Logger.get("Tagger");

/**
 * Cover art buffer + MIME type — returned by fetchCoverArt and consumed by embedTags.
 */
export interface CoverArt {
	buffer: Buffer;
	mime: string; // "image/jpeg" | "image/png"
}

/**
 * Input tags for the ID3v2 tagger.
 *
 * - album is optional (D-13): TALB frame is omitted entirely when undefined or null.
 * - coverArt is optional (D-14): APIC frame is omitted entirely when undefined or null.
 */
export interface TagInput {
	title: string;
	artist: string;
	album?: string | null;
	coverArt?: CoverArt | null;
}

/**
 * Phase 3 D-12: post-yt-dlp Node tagging step.
 *
 * Writes ID3v2 frames to the given MP3 file using node-id3's sync API.
 * Throws on any write failure (Pitfall #10: sync API returns true | Error).
 *
 * Frames written:
 *  - TIT2 (title)  — always
 *  - TPE1 (artist) — always
 *  - TALB (album)  — only when input.album is a non-empty string (D-13)
 *  - APIC (cover)  — only when input.coverArt is non-null with a non-empty buffer (D-14)
 */
export function embedTags(filepath: string, input: TagInput): void {
	const hasAlbum = typeof input.album === "string" && input.album.length > 0;
	const hasCover = input.coverArt != null && input.coverArt.buffer.length > 0;

	const tags: NodeID3.Tags = {
		title: input.title,
		artist: input.artist,
	};

	if (hasAlbum) {
		tags.album = input.album as string;
	}

	if (hasCover && input.coverArt != null) {
		// Pitfall #9: use the object form with imageBuffer, NOT the filepath string form
		tags.image = {
			mime: input.coverArt.mime,
			type: { id: 3 }, // 3 = front cover per id3.org
			description: "Cover",
			imageBuffer: input.coverArt.buffer,
		};
	}

	const result = NodeID3.write(tags, filepath);

	// Pitfall #10: sync API returns true | Error — does NOT throw
	if (result instanceof Error) {
		throw result;
	}
	if (result !== true) {
		throw new Error("node-id3 write returned non-true");
	}

	logger.debug({ filepath, hasAlbum, hasCover }, "Embedded ID3 tags");
}
