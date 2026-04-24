import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
	FailureReasonSchema,
	PlaylistSyncCompletedEventSchema,
	PlaylistSyncFailedEventSchema,
} from "./schema";

const baseCompletedEvent = (
	payloadOverrides: Record<string, unknown> = {},
) => ({
	id: randomUUID(),
	timestamp: new Date(),
	type: "playlist.sync.completed" as const,
	payload: {
		playlistId: "src-1",
		playlistName: "Test Playlist",
		invocationId: randomUUID(),
		duration: 1000,
		exitCode: 0,
		...payloadOverrides,
	},
});

const baseFailedEvent = (payloadOverrides: Record<string, unknown> = {}) => ({
	id: randomUUID(),
	timestamp: new Date(),
	type: "playlist.sync.failed" as const,
	payload: {
		playlistId: "src-1",
		playlistName: "Test Playlist",
		invocationId: randomUUID(),
		error: "Something went wrong",
		...payloadOverrides,
	},
});

describe("PlaylistSyncCompletedEventSchema", () => {
	it("Test 1: accepts payload with truncationSuspected and trackCount", () => {
		const event = baseCompletedEvent({
			truncationSuspected: true,
			trackCount: 100,
		});
		const result = PlaylistSyncCompletedEventSchema.parse(event);
		expect(result.payload.truncationSuspected).toBe(true);
		expect(result.payload.trackCount).toBe(100);
	});

	it("Test 2: accepts payload WITHOUT truncationSuspected or trackCount (backward compat)", () => {
		const event = baseCompletedEvent();
		const result = PlaylistSyncCompletedEventSchema.parse(event);
		expect(result.payload.truncationSuspected).toBeUndefined();
		expect(result.payload.trackCount).toBeUndefined();
	});

	it("Test 3: rejects trackCount: -1 (must be nonnegative)", () => {
		const event = baseCompletedEvent({ trackCount: -1 });
		const result = PlaylistSyncCompletedEventSchema.safeParse(event);
		expect(result.success).toBe(false);
	});

	it("Test 4: rejects trackCount: 3.5 (must be integer)", () => {
		const event = baseCompletedEvent({ trackCount: 3.5 });
		const result = PlaylistSyncCompletedEventSchema.safeParse(event);
		expect(result.success).toBe(false);
	});
});

describe("PlaylistSyncFailedEventSchema", () => {
	it("Test 5: accepts payload with failureReason: invalid_url", () => {
		const event = baseFailedEvent({ failureReason: "invalid_url" });
		const result = PlaylistSyncFailedEventSchema.parse(event);
		expect(result.payload.failureReason).toBe("invalid_url");
	});

	it("Test 6: accepts payload with failureReason: python_crash", () => {
		const event = baseFailedEvent({ failureReason: "python_crash" });
		const result = PlaylistSyncFailedEventSchema.parse(event);
		expect(result.payload.failureReason).toBe("python_crash");
	});

	it("Test 7: rejects failureReason: unknown (not in enum)", () => {
		const event = baseFailedEvent({ failureReason: "unknown" });
		const result = PlaylistSyncFailedEventSchema.safeParse(event);
		expect(result.success).toBe(false);
	});

	it("Test 8: accepts payload WITHOUT failureReason (optional, backward compat)", () => {
		const event = baseFailedEvent();
		const result = PlaylistSyncFailedEventSchema.parse(event);
		expect(result.payload.failureReason).toBeUndefined();
	});
});

describe("FailureReasonSchema", () => {
	it("Test 9: options contains exactly 5 locked enum values", () => {
		const expectedValues = [
			"invalid_url",
			"not_found",
			"parse_error",
			"network_error",
			"python_crash",
		];
		const actualValues = [...FailureReasonSchema.options].sort();
		const expected = [...expectedValues].sort();
		expect(actualValues).toEqual(expected);
		expect(actualValues).toHaveLength(5);
	});
});
