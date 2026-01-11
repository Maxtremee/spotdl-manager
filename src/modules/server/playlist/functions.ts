import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { PlaylistSchema } from "~/modules/client/playlist/schema/playlist";
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
