import { and, count, eq, like, type SQL } from "drizzle-orm";
import type { Playlist } from "~/modules/client/playlist/schema/playlist";
import { rowToPlaylist } from "~/modules/client/playlist/utils/mapper";
import { getDb, schema } from "../db";

export type PaginationParams = {
	page?: number;
	limit?: number;
};

export type FilterParams = {
	status?: Playlist["status"];
	search?: string;
};

export type ListPlaylistsParams = PaginationParams & FilterParams;

/**
 * Server-side repository for playlist database operations
 * Handles all direct database access and transformations
 */
export const PlaylistRepository = {
	/**
	 * List all playlists with pagination and filtering
	 * Returns raw database results and total count for SSR
	 */
	async listPlaylists(params: ListPlaylistsParams = {}) {
		const db = getDb();
		const page = Math.max(1, params.page || 1);
		const limit = Math.min(100, Math.max(1, params.limit || 10));
		const offset = (page - 1) * limit;

		// Build dynamic WHERE conditions array
		const conditions: SQL[] = [];

		// Apply status filter
		if (params.status) {
			conditions.push(eq(schema.playlists.status, params.status));
		}

		// Apply search filter (search in name)
		if (params.search) {
			const searchPattern = `%${params.search}%`;
			conditions.push(like(schema.playlists.name, searchPattern));
		}

		// Build WHERE clause from conditions
		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		// Get total count for pagination
		const countResult = await db
			.select({ count: count() })
			.from(schema.playlists)
			.where(whereClause);
		const totalCount = countResult[0].count;

		// Get paginated results
		const rows = await db
			.select()
			.from(schema.playlists)
			.where(whereClause)
			.limit(limit)
			.offset(offset);

		return {
			items: rows.map(rowToPlaylist),
			pagination: {
				page,
				limit,
				total: totalCount,
				pages: Math.ceil(totalCount / limit),
			},
		};
	},

	/**
	 * Get a single playlist by ID
	 */
	async getPlaylistById(id: string) {
		const db = getDb();
		const [row] = await db
			.select()
			.from(schema.playlists)
			.where(eq(schema.playlists.id, id));

		return row ? rowToPlaylist(row) : null;
	},

	/**
	 * Get total count of playlists
	 */
	async getTotalCount() {
		const db = getDb();
		const result = await db.select({ count: count() }).from(schema.playlists);

		return result[0].count;
	},

	/**
	 * Get playlists grouped by status
	 */
	async getPlaylistsByStatus() {
		const db = getDb();
		const result = await db
			.select({
				status: schema.playlists.status,
				count: count(),
			})
			.from(schema.playlists)
			.groupBy(schema.playlists.status);

		return result;
	},
};
