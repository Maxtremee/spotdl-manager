import { promises as fs } from "node:fs";
import { createServerFn } from "@tanstack/solid-start";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { PlaylistSchema } from "~/modules/client/playlist/schema/playlist";
import { getDb, schema } from "../db";
import { InvocationRepository } from "../invocation/repository";
import { getScheduler } from "../scheduler/PlaylistScheduler";
import { PlaylistRepository } from "./repository";

// Define input schema for list playlists function
const listPlaylistsInputSchema = z.object({
	page: z.number().int().positive().default(1),
	limit: z.number().int().positive().default(10),
	status: z.enum(["active", "paused", "archived", "error"]).optional(),
	search: z.string().optional(),
});

/**
 * Server function to list playlists
 * Validates input and calls the repository
 */
export const listPlaylistsServerFn = createServerFn({ method: "GET" })
	.inputValidator(listPlaylistsInputSchema)
	.handler(async ({ data }) =>
		PlaylistRepository.listPlaylists({
			page: data.page,
			limit: data.limit,
			status: data.status,
			search: data.search,
		}),
	);

// Define input schema for create playlist function
const createPlaylistInputSchema = PlaylistSchema.omit({
	id: true,
	createdAt: true,
	updatedAt: true,
});

/**
 * Server function to create a new playlist
 * Validates input and calls the repository
 */
export const createPlaylistServerFn = createServerFn({ method: "POST" })
	.inputValidator(createPlaylistInputSchema)
	.handler(async ({ data }) => {
		try {
			const result = await PlaylistRepository.createPlaylist(data);
			return { success: true, data: result };
		} catch (error) {
			console.error("Failed to create playlist:", error);
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to create playlist",
			};
		}
	});

// Define input schema for get playlist by ID function
const getPlaylistByIdInputSchema = z.object({
	id: z.string().min(1),
});

/**
 * Server function to get a playlist by ID
 */
export const getPlaylistByIdServerFn = createServerFn({ method: "GET" })
	.inputValidator(getPlaylistByIdInputSchema)
	.handler(async ({ data }) => {
		const result = await PlaylistRepository.getPlaylistById(data.id);
		if (!result) {
			throw new Error(`Playlist with id ${data.id} not found`);
		}
		return result;
	});

// Define input schema for delete playlist function
const deletePlaylistInputSchema = z.object({
	id: z.string().min(1),
});

/**
 * Server function to delete a playlist
 */
export const deletePlaylistServerFn = createServerFn({ method: "POST" })
	.inputValidator(deletePlaylistInputSchema)
	.handler(async ({ data }) => {
		try {
			await PlaylistRepository.deletePlaylist(data.id);
			// Trigger scheduler reload to remove deleted playlist from scheduler
			const scheduler = getScheduler();
			await scheduler.reload();
			return { success: true };
		} catch (error) {
			console.error("Failed to delete playlist:", error);
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to delete playlist",
			};
		}
	});

// Define input schema for update playlist function
const updatePlaylistInputSchema = z.object({
	id: z.string().min(1),
	status: z.enum(["active", "paused", "archived", "error"]).optional(),
	flags: z
		.object({
			overwrite: z.boolean().optional(),
			retries: z.number().int().min(0).max(10).optional(),
			quality: z
				.enum(["worst", "low", "medium", "high", "very_high", "lossless"])
				.optional(),
			format: z
				.enum(["mp3", "flac", "ogg", "m4a", "opus", "vorbis", "wav"])
				.optional(),
		})
		.optional(),
	schedule: z
		.object({
			enabled: z.boolean().optional(),
			schedule: z
				.discriminatedUnion("type", [
					z.object({
						type: z.literal("cron"),
						cron: z.string(),
					}),
					z.object({
						type: z.literal("interval"),
						minutes: z.number().int().min(1).max(43200),
					}),
				])
				.optional(),
		})
		.optional(),
});

/**
 * Server function to update a playlist
 */
export const updatePlaylistServerFn = createServerFn({ method: "POST" })
	.inputValidator(updatePlaylistInputSchema)
	.handler(async ({ data }) => {
		try {
			const { id, flags, schedule, ...rest } = data;

			// Fetch existing playlist to merge partial updates
			const existing = await PlaylistRepository.getPlaylistById(id);
			if (!existing) {
				return { success: false, error: `Playlist with id ${id} not found` };
			}

			// Build complete update object, merging partials with existing data
			const updates: Parameters<typeof PlaylistRepository.updatePlaylist>[1] = {
				...rest,
			};

			if (flags) {
				updates.flags = {
					overwrite: flags.overwrite ?? existing.flags?.overwrite ?? false,
					retries: flags.retries ?? existing.flags?.retries ?? 3,
					quality: flags.quality ?? existing.flags?.quality ?? "high",
					format: flags.format ?? existing.flags?.format ?? "mp3",
				};
			}

			if (schedule) {
				updates.schedule = {
					enabled: schedule.enabled ?? existing.schedule?.enabled ?? false,
					schedule: schedule.schedule ??
						existing.schedule?.schedule ?? {
							type: "interval",
							minutes: 1440,
						},
				};
			}

			const result = await PlaylistRepository.updatePlaylist(id, updates);
			return { success: true, data: result };
		} catch (error) {
			console.error("Failed to update playlist:", error);
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to update playlist",
			};
		}
	});

// Define input schema for list invocations function
const listInvocationsInputSchema = z.object({
	playlistId: z.string().min(1),
	page: z.number().int().positive().default(1),
	limit: z.number().int().positive().default(10),
	status: z.enum(["running", "success", "failed", "canceled"]).optional(),
});

/**
 * Server function to list invocations for a playlist
 */
export const listInvocationsServerFn = createServerFn({ method: "GET" })
	.inputValidator(listInvocationsInputSchema)
	.handler(async ({ data }) =>
		InvocationRepository.listInvocations({
			playlistId: data.playlistId,
			page: data.page,
			limit: data.limit,
			status: data.status,
		}),
	);

// Define input schema for get playlist details (playlist + invocations)
const getPlaylistDetailsInputSchema = z.object({
	id: z.string().min(1),
	invocationsPage: z.number().int().positive().default(1),
	invocationsLimit: z.number().int().positive().default(10),
});

/**
 * Server function to get playlist details including invocations
 */
export const getPlaylistDetailsServerFn = createServerFn({ method: "GET" })
	.inputValidator(getPlaylistDetailsInputSchema)
	.handler(async ({ data }) => {
		const playlist = await PlaylistRepository.getPlaylistById(data.id);
		if (!playlist) {
			throw new Error(`Playlist with id ${data.id} not found`);
		}

		const invocations = await InvocationRepository.listInvocations({
			playlistId: data.id,
			page: data.invocationsPage,
			limit: data.invocationsLimit,
		});

		return {
			playlist,
			invocations,
		};
	});

// Define input schema for get invocation log function
const getInvocationLogInputSchema = z.object({
	invocationId: z.string().min(1),
});

/**
 * Server function to get the log content for an invocation
 * Supports both running (partial log) and completed invocations (full log)
 */
export const getInvocationLogServerFn = createServerFn({ method: "GET" })
	.inputValidator(getInvocationLogInputSchema)
	.handler(async ({ data }) => {
		const invocation = await InvocationRepository.getById(data.invocationId);
		if (!invocation) {
			return {
				success: false,
				error: `Invocation with id ${data.invocationId} not found`,
			};
		}

		if (!invocation.logPath) {
			return {
				success: true,
				data: {
					invocationId: invocation.id,
					status: invocation.status,
					content: "",
					isRunning: invocation.status === "running",
				},
			};
		}

		try {
			const content = await fs.readFile(invocation.logPath, "utf8");
			return {
				success: true,
				data: {
					invocationId: invocation.id,
					status: invocation.status,
					content,
					isRunning: invocation.status === "running",
				},
			};
		} catch (error) {
			// File may not exist yet if invocation just started
			if ((error as NodeJS.ErrnoException).code === "ENOENT") {
				return {
					success: true,
					data: {
						invocationId: invocation.id,
						status: invocation.status,
						content: "",
						isRunning: invocation.status === "running",
					},
				};
			}
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to read log file",
			};
		}
	});

// Define input schema for manual sync function
const triggerSyncInputSchema = z.object({
	playlistId: z.string().min(1),
});

/**
 * Server function to manually trigger a playlist sync
 * Bypasses scheduled timing and runs sync immediately
 */
export const triggerPlaylistSyncServerFn = createServerFn({ method: "POST" })
	.inputValidator(triggerSyncInputSchema)
	.handler(async ({ data }) => {
		try {
			// Get raw PlaylistRow from database for the scheduler
			const db = getDb();
			const [playlistRow] = await db
				.select()
				.from(schema.playlists)
				.where(eq(schema.playlists.id, data.playlistId));

			if (!playlistRow) {
				return {
					success: false,
					error: `Playlist with id ${data.playlistId} not found`,
				};
			}

			if (playlistRow.status !== "active") {
				return {
					success: false,
					error: `Cannot sync playlist with status "${playlistRow.status}". Only active playlists can be synced.`,
				};
			}

			const scheduler = getScheduler();

			if (scheduler.isRunning(playlistRow.id)) {
				return {
					success: false,
					error: "Playlist is already syncing",
				};
			}

			const result = await scheduler.triggerManualSync(playlistRow);

			if (!result) {
				return {
					success: false,
					error: "Failed to trigger sync",
				};
			}

			return {
				success: true,
				message: "Sync started successfully",
			};
		} catch (error) {
			console.error("Failed to trigger playlist sync:", error);
			return {
				success: false,
				error:
					error instanceof Error ? error.message : "Failed to trigger sync",
			};
		}
	});
