import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import type { CoverArt } from "./tagger";

const logger = Logger.get("CoverArtFetcher");

const FETCH_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024; // T-3-04: 5MB cap
const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png"]);

/**
 * Phase 3 D-14: per-track cover-art fetch with HTTPS-only + size + MIME guards.
 *
 * Returns null on ANY failure (no throws — Pitfall #8). The track's tag step
 * proceeds without an APIC frame; the track is NOT marked failed.
 *
 * Security (T-3-04 cover-art SSRF mitigation):
 *  - Protocol whitelist: https: only
 *  - MIME whitelist: image/jpeg, image/png
 *  - Response size cap: 5MB
 *  - Timeout: 10s via AbortSignal.timeout
 */
export async function fetchCoverArt(
	url: string | null,
	log: AppLogger = logger,
): Promise<CoverArt | null> {
	if (!url) {
		return null;
	}

	let parsed: URL;
	try {
		parsed = new URL(url);
	} catch {
		log.warn({ url }, "cover-art URL is not parseable — skipping APIC");
		return null;
	}

	if (parsed.protocol !== "https:") {
		log.warn(
			{ url, protocol: parsed.protocol },
			"cover-art URL must use https: — skipping APIC (T-3-04 SSRF guard)",
		);
		return null;
	}

	try {
		const response = await fetch(url, {
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
		});

		if (!response.ok) {
			log.warn(
				{ url, status: response.status },
				"cover-art fetch returned non-2xx — skipping APIC",
			);
			return null;
		}

		const contentTypeHeader = response.headers.get("content-type") ?? "";
		const mime = contentTypeHeader.split(";")[0]?.trim().toLowerCase() ?? "";

		if (!ALLOWED_MIME_TYPES.has(mime)) {
			log.warn(
				{ url, mime: contentTypeHeader },
				"cover-art content-type not in allowlist — skipping APIC",
			);
			return null;
		}

		const arrayBuffer = await response.arrayBuffer();

		if (arrayBuffer.byteLength > MAX_RESPONSE_BYTES) {
			log.warn(
				{ url, bytes: arrayBuffer.byteLength },
				"cover-art exceeds 5MB cap — skipping APIC",
			);
			return null;
		}

		return { buffer: Buffer.from(arrayBuffer), mime };
	} catch (err) {
		log.warn({ url, err }, "cover-art fetch failed — skipping APIC");
		return null;
	}
}
