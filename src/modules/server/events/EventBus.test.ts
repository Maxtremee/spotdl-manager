import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventBus } from "./EventBus";
import type { PlaylistSyncCompletedEvent } from "./schema";

describe("EventBus", () => {
	let eventBus: EventBus;

	beforeEach(() => {
		EventBus.resetInstance();
		eventBus = EventBus.getInstance();
	});

	afterEach(() => {
		eventBus.clear();
	});

	describe("Singleton", () => {
		it("should return the same instance", () => {
			const instance1 = EventBus.getInstance();
			const instance2 = EventBus.getInstance();
			expect(instance1).toBe(instance2);
		});

		it("should reset instance", () => {
			const instance1 = EventBus.getInstance();
			EventBus.resetInstance();
			const instance2 = EventBus.getInstance();
			expect(instance1).not.toBe(instance2);
		});
	});

	describe("on", () => {
		it("should register event handler", async () => {
			const handler = vi.fn();
			eventBus.on("playlist.sync.started", handler);

			await eventBus.emit({
				type: "playlist.sync.started",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test Playlist",
					invocationId: randomUUID(),
					sourceUrl: "https://spotify.com/test",
					outputDir: "/output",
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "playlist.sync.started",
					id: expect.any(String),
					timestamp: expect.any(Date),
				}),
			);
		});

		it("should handle multiple handlers for same event", async () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			eventBus.on("playlist.sync.completed", handler1);
			eventBus.on("playlist.sync.completed", handler2);

			await eventBus.emit({
				type: "playlist.sync.completed",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					invocationId: randomUUID(),
					duration: 5000,
					exitCode: 0,
				},
			});

			expect(handler1).toHaveBeenCalledTimes(1);
			expect(handler2).toHaveBeenCalledTimes(1);
		});

		it("should return unsubscribe function", async () => {
			const handler = vi.fn();
			const unsubscribe = eventBus.on("playlist.sync.started", handler);

			await eventBus.emit({
				type: "playlist.sync.started",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					invocationId: randomUUID(),
					sourceUrl: "url",
					outputDir: "/out",
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);

			unsubscribe();

			await eventBus.emit({
				type: "playlist.sync.started",
				payload: {
					playlistId: "pl-2",
					playlistName: "Test 2",
					invocationId: randomUUID(),
					sourceUrl: "url",
					outputDir: "/out",
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe("onAny", () => {
		it("should register handler for all events", async () => {
			const handler = vi.fn();
			eventBus.onAny(handler);

			await eventBus.emit({
				type: "playlist.sync.started",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					invocationId: randomUUID(),
					sourceUrl: "url",
					outputDir: "/out",
				},
			});

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-2",
					playlistName: "New Playlist",
					sourceUrl: "url",
				},
			});

			expect(handler).toHaveBeenCalledTimes(2);
		});

		it("should return unsubscribe function", async () => {
			const handler = vi.fn();
			const unsubscribe = eventBus.onAny(handler);

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);

			unsubscribe();

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-2",
					playlistName: "Test 2",
					sourceUrl: "url",
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);
		});
	});

	describe("once", () => {
		it("should invoke handler only once", async () => {
			const handler = vi.fn();
			eventBus.once("playlist.sync.completed", handler);

			const payload = {
				playlistId: "pl-1",
				playlistName: "Test",
				invocationId: randomUUID(),
				duration: 5000,
				exitCode: 0,
			};

			await eventBus.emit({
				type: "playlist.sync.completed",
				payload,
			});

			await eventBus.emit({
				type: "playlist.sync.completed",
				payload,
			});

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should return unsubscribe function", async () => {
			const handler = vi.fn();
			const unsubscribe = eventBus.once("playlist.sync.completed", handler);

			unsubscribe();

			await eventBus.emit({
				type: "playlist.sync.completed",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					invocationId: randomUUID(),
					duration: 5000,
					exitCode: 0,
				},
			});

			expect(handler).not.toHaveBeenCalled();
		});
	});

	describe("emit", () => {
		it("should enrich event with id and timestamp", async () => {
			const handler = vi.fn();
			eventBus.on("playlist.created", handler);

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					id: expect.any(String),
					timestamp: expect.any(Date),
					type: "playlist.created",
				}),
			);
		});

		it("should preserve existing id and timestamp", async () => {
			const handler = vi.fn();
			eventBus.on("playlist.created", handler);

			const id = randomUUID();
			const timestamp = new Date("2024-01-01");

			await eventBus.emit({
				id,
				timestamp,
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({
					id,
					timestamp,
				}),
			);
		});

		it("should handle async handlers", async () => {
			const handler = vi.fn(async () => {
				await new Promise((resolve) => setTimeout(resolve, 10));
			});

			eventBus.on("playlist.created", handler);

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(handler).toHaveBeenCalledTimes(1);
		});

		it("should handle handler errors gracefully", async () => {
			const consoleErrorSpy = vi
				.spyOn(console, "error")
				.mockImplementation(() => {});
			const errorHandler = vi.fn(() => {
				throw new Error("Handler error");
			});
			const successHandler = vi.fn();

			eventBus.on("playlist.created", errorHandler);
			eventBus.on("playlist.created", successHandler);

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(errorHandler).toHaveBeenCalled();
			expect(successHandler).toHaveBeenCalled();
			expect(consoleErrorSpy).toHaveBeenCalled();

			consoleErrorSpy.mockRestore();
		});
	});

	describe("off", () => {
		it("should remove all handlers for event type", async () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();

			eventBus.on("playlist.created", handler1);
			eventBus.on("playlist.created", handler2);

			eventBus.off("playlist.created");

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
		});
	});

	describe("clear", () => {
		it("should remove all handlers", async () => {
			const handler1 = vi.fn();
			const handler2 = vi.fn();
			const anyHandler = vi.fn();

			eventBus.on("playlist.created", handler1);
			eventBus.on("playlist.deleted", handler2);
			eventBus.onAny(anyHandler);

			eventBus.clear();

			await eventBus.emit({
				type: "playlist.created",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					sourceUrl: "url",
				},
			});

			expect(handler1).not.toHaveBeenCalled();
			expect(handler2).not.toHaveBeenCalled();
			expect(anyHandler).not.toHaveBeenCalled();
		});
	});

	describe("getHandlerCount", () => {
		it("should return count for specific event type", () => {
			eventBus.on("playlist.created", vi.fn());
			eventBus.on("playlist.created", vi.fn());
			eventBus.on("playlist.deleted", vi.fn());

			expect(eventBus.getHandlerCount("playlist.created")).toBe(2);
			expect(eventBus.getHandlerCount("playlist.deleted")).toBe(1);
		});

		it("should return total count without event type", () => {
			eventBus.on("playlist.created", vi.fn());
			eventBus.on("playlist.deleted", vi.fn());
			eventBus.onAny(vi.fn());

			expect(eventBus.getHandlerCount()).toBe(3);
		});

		it("should return 0 for unregistered event type", () => {
			expect(eventBus.getHandlerCount("playlist.created")).toBe(0);
		});
	});

	describe("Type Safety", () => {
		it("should enforce correct payload structure", async () => {
			const handler = vi.fn((event: PlaylistSyncCompletedEvent) => {
				expect(event.payload.playlistId).toBeDefined();
				expect(event.payload.duration).toBeTypeOf("number");
			});

			eventBus.on("playlist.sync.completed", handler);

			await eventBus.emit({
				type: "playlist.sync.completed",
				payload: {
					playlistId: "pl-1",
					playlistName: "Test",
					invocationId: randomUUID(),
					duration: 5000,
					exitCode: 0,
				},
			});

			expect(handler).toHaveBeenCalled();
		});
	});
});
