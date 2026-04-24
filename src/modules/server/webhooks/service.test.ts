import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { WebhookMessageFormatter } from "./service";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function completedEvent(payloadOverrides: Record<string, unknown> = {}) {
	return {
		id: randomUUID(),
		timestamp: new Date(),
		type: "playlist.sync.completed" as const,
		payload: {
			playlistId: "src-1",
			playlistName: "Test Playlist",
			invocationId: randomUUID(),
			duration: 4567,
			exitCode: 0,
			...payloadOverrides,
		},
	};
}

function failedEvent(payloadOverrides: Record<string, unknown> = {}) {
	return {
		id: randomUUID(),
		timestamp: new Date(),
		type: "playlist.sync.failed" as const,
		payload: {
			playlistId: "src-1",
			playlistName: "Test Playlist",
			invocationId: randomUUID(),
			error: "boom",
			...payloadOverrides,
		},
	};
}

// ---------------------------------------------------------------------------
// WebhookMessageFormatter.formatCompleted — truncation + trackCount (D-11)
// ---------------------------------------------------------------------------

describe("WebhookMessageFormatter.formatCompleted — truncation + trackCount (D-11)", () => {
	it("Test 1: includes track count and truncation warning when truncationSuspected=true", () => {
		const event = completedEvent({
			trackCount: 100,
			truncationSuspected: true,
		});
		const out = WebhookMessageFormatter.formatCompleted(event as any);
		expect(out).toContain("100 tracks");
		expect(out).toContain("possibly truncated");
		expect(out).toContain("Test Playlist");
	});

	it("Test 2: renders only base line when no trackCount and no truncationSuspected", () => {
		const event = completedEvent();
		const out = WebhookMessageFormatter.formatCompleted(event as any);
		expect(out).toContain("Completed syncing");
		expect(out).toContain("Test Playlist");
		expect(out).not.toContain("tracks");
		expect(out).not.toContain("possibly truncated");
	});

	it("Test 3: includes track count but NO truncation warning when truncationSuspected=false", () => {
		const event = completedEvent({
			trackCount: 50,
			truncationSuspected: false,
		});
		const out = WebhookMessageFormatter.formatCompleted(event as any);
		expect(out).toContain("50 tracks");
		expect(out).not.toContain("possibly truncated");
	});
});

// ---------------------------------------------------------------------------
// WebhookMessageFormatter.formatFailed — failureReason + T-2-05 sanitization
// ---------------------------------------------------------------------------

describe("WebhookMessageFormatter.formatFailed — failureReason + T-2-05 sanitization", () => {
	it("Test 4: includes failureReason enum inline in backticks", () => {
		const event = failedEvent({ failureReason: "network_error" });
		const out = WebhookMessageFormatter.formatFailed(event as any);
		expect(out).toContain("`network_error`");
		expect(out).toContain("Test Playlist");
	});

	it("Test 5: renders correctly without failureReason (backward compat)", () => {
		const event = failedEvent();
		const out = WebhookMessageFormatter.formatFailed(event as any);
		expect(out).toContain("Failed syncing");
		expect(out).toContain("Test Playlist");
		expect(out).toContain("boom");
		// No failureReason section
		expect(out).not.toContain("reason:");
	});

	it("T-2-05: sanitizes multi-line stderr tail to a single bounded line", () => {
		// Build a realistic Python traceback + overflow payload
		const stderrTail =
			"Traceback (most recent call last):\n" +
			"  File \"/app/scraper/scraper.py\", line 42, in main\n" +
			"    client.get_playlist_info(url)\n".repeat(10) +
			"ValueError: oops " +
			"X".repeat(500);

		const out = WebhookMessageFormatter.formatFailed(
			failedEvent({ error: stderrTail, failureReason: "python_crash" }) as any,
		);

		// The sanitized error body is everything after the final "> " marker line.
		const lines = out.split("\n");
		const errorBodyLine = lines[lines.length - 1];

		// Line starts with "> " — strip the marker.
		expect(errorBodyLine.startsWith("> ")).toBe(true);
		const body = errorBodyLine.slice(2);

		// T-2-05: bounded at 200 chars, no newlines or carriage returns.
		expect(body.length).toBeLessThanOrEqual(200);
		expect(body).not.toMatch(/\n/);
		expect(body).not.toMatch(/\r/);

		// The traceback content should be collapsed — "Traceback" not on its own line.
		expect(out.split("\n").filter((l) => l.trim() === "Traceback (most recent call last):").length).toBe(0);
	});
});
