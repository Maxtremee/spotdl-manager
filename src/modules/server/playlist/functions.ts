import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
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
