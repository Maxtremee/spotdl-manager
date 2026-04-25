import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppLogger } from "~/logger";
import { fetchCoverArt } from "./cover-art";

// Minimal mock Response helper
function mockResponse(
	ok: boolean,
	status: number,
	contentType: string,
	bodyBytes: Uint8Array,
): Response {
	return {
		ok,
		status,
		headers: {
			get(name: string) {
				if (name.toLowerCase() === "content-type") {
					return contentType;
				}
				return null;
			},
		},
		arrayBuffer: async () => bodyBytes.buffer as ArrayBuffer,
	} as unknown as Response;
}

// Silent logger stub for test isolation
const noopLog: AppLogger = {
	warn: vi.fn(),
	debug: vi.fn(),
	info: vi.fn(),
	error: vi.fn(),
	trace: vi.fn(),
	fatal: vi.fn(),
	child: () => noopLog,
} as unknown as AppLogger;

describe("fetchCoverArt", () => {
	beforeEach(() => {
		vi.stubGlobal("fetch", vi.fn());
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("happy path JPEG — returns buffer and image/jpeg mime", async () => {
		const imgBytes = new Uint8Array(100).fill(0xff);
		vi.mocked(fetch).mockResolvedValueOnce(
			mockResponse(true, 200, "image/jpeg", imgBytes),
		);

		const result = await fetchCoverArt(
			"https://example.com/cover.jpg",
			noopLog,
		);
		expect(result).not.toBeNull();
		expect(result?.mime).toBe("image/jpeg");
		expect(result?.buffer.length).toBe(100);
	});

	it("happy path PNG — returns buffer and image/png mime", async () => {
		const imgBytes = new Uint8Array(50).fill(0xaa);
		vi.mocked(fetch).mockResolvedValueOnce(
			mockResponse(true, 200, "image/png", imgBytes),
		);

		const result = await fetchCoverArt(
			"https://example.com/cover.png",
			noopLog,
		);
		expect(result).not.toBeNull();
		expect(result?.mime).toBe("image/png");
	});

	it("null url returns null without calling fetch", async () => {
		const result = await fetchCoverArt(null, noopLog);
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("empty string url returns null without calling fetch", async () => {
		const result = await fetchCoverArt("", noopLog);
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});

	it("non-2xx (404) returns null — warn logged", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			mockResponse(false, 404, "text/html", new Uint8Array(0)),
		);

		const result = await fetchCoverArt(
			"https://example.com/missing.jpg",
			noopLog,
		);
		expect(result).toBeNull();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("http:// URL rejected (T-3-04 SSRF guard) — fetch not called", async () => {
		const result = await fetchCoverArt(
			"http://evil.example.com/foo.jpg",
			noopLog,
		);
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("file:// URL rejected — fetch not called", async () => {
		const result = await fetchCoverArt("file:///etc/passwd", noopLog);
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("data: URL rejected — fetch not called", async () => {
		const result = await fetchCoverArt(
			"data:image/jpeg;base64,/9j/4AAQSkZJRg==",
			noopLog,
		);
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("invalid MIME type (text/html) rejected — returns null", async () => {
		vi.mocked(fetch).mockResolvedValueOnce(
			mockResponse(true, 200, "text/html; charset=utf-8", new Uint8Array(10)),
		);

		const result = await fetchCoverArt(
			"https://example.com/page.html",
			noopLog,
		);
		expect(result).toBeNull();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("size cap >5MB — returns null", async () => {
		const bigBytes = new Uint8Array(6 * 1024 * 1024).fill(0);
		vi.mocked(fetch).mockResolvedValueOnce(
			mockResponse(true, 200, "image/jpeg", bigBytes),
		);

		const result = await fetchCoverArt("https://example.com/huge.jpg", noopLog);
		expect(result).toBeNull();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("network error returns null without throwing", async () => {
		vi.mocked(fetch).mockRejectedValueOnce(new Error("Connection refused"));

		const result = await fetchCoverArt(
			"https://example.com/cover.jpg",
			noopLog,
		);
		expect(result).toBeNull();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("AbortError (timeout) returns null without throwing", async () => {
		const abortErr = Object.assign(new Error("The operation was aborted"), {
			name: "AbortError",
		});
		vi.mocked(fetch).mockRejectedValueOnce(abortErr);

		const result = await fetchCoverArt("https://example.com/slow.jpg", noopLog);
		expect(result).toBeNull();
		expect(noopLog.warn).toHaveBeenCalled();
	});

	it("invalid URL string returns null without throwing", async () => {
		const result = await fetchCoverArt("not a url", noopLog);
		expect(result).toBeNull();
		expect(fetch).not.toHaveBeenCalled();
	});
});
