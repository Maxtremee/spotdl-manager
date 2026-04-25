/**
 * Phase 3 D-15: deterministic, cross-platform-safe path helpers.
 *
 * sourceSlug — folder name under data/music/<slug>/. slugify with strict mode
 * strips filesystem-unsafe chars and lowercases. Empty input → "untitled".
 *
 * safeFilename — "Artist - Title.mp3" filename with Windows reserved-name protection.
 */
import slugify from "slugify";

// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional — strips null and control chars from filenames
const FS_UNSAFE_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const WINDOWS_RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(\..*)?$/i;
const MAX_FILENAME_LEN = 200;

export function sourceSlug(name: string): string {
	const slug = slugify(name, { lower: true, strict: true, trim: true });
	return slug.length > 0 ? slug : "untitled";
}

export function safeFilename(artist: string, title: string): string {
	const sanitize = (s: string): string =>
		s.replace(FS_UNSAFE_CHARS, "_").trim().replace(/\.+$/, "");
	const safeArtist = sanitize(artist);
	const safeTitle = sanitize(title);
	let basename = `${safeArtist} - ${safeTitle}`;
	// Windows reserved name guard (case-insensitive, with or without extension).
	if (WINDOWS_RESERVED.test(safeArtist) || WINDOWS_RESERVED.test(basename)) {
		basename = `_${basename}`;
	}
	if (basename.length > MAX_FILENAME_LEN) {
		basename = basename.slice(0, MAX_FILENAME_LEN);
	}
	return `${basename}.mp3`;
}
