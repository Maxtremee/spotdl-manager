import { and, count, desc, eq, type SQL } from "drizzle-orm";
import { getDb, schema } from "../db";
import type { NewInvocationRow } from "../db/schema";

export type PaginationParams = {
	page?: number;
	limit?: number;
};

export type FilterParams = {
	playlistId?: string;
	status?: "running" | "success" | "failed" | "canceled";
};

export type ListInvocationsParams = PaginationParams & FilterParams;

/**
 * Server-side repository for invocation database operations
 * Tracks playlist sync/download executions
 */
export const InvocationRepository = {
	/**
	 * Create a new invocation record
	 */
	async create(data: NewInvocationRow) {
		const db = getDb();
		const [row] = await db.insert(schema.invocations).values(data).returning();
		return row;
	},

	/**
	 * Update an invocation (e.g., when it finishes)
	 */
	async update(
		id: string,
		data: Partial<Omit<NewInvocationRow, "id" | "playlistId" | "startedAt">>,
	) {
		const db = getDb();
		const [row] = await db
			.update(schema.invocations)
			.set(data)
			.where(eq(schema.invocations.id, id))
			.returning();
		return row;
	},

	/**
	 * List invocations with pagination and filtering
	 */
	async listInvocations(params: ListInvocationsParams = {}) {
		const db = getDb();
		const page = Math.max(1, params.page || 1);
		const limit = Math.min(100, Math.max(1, params.limit || 10));
		const offset = (page - 1) * limit;

		const conditions: SQL[] = [];

		if (params.playlistId) {
			conditions.push(eq(schema.invocations.playlistId, params.playlistId));
		}

		if (params.status) {
			conditions.push(eq(schema.invocations.status, params.status));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const countResult = await db
			.select({ count: count() })
			.from(schema.invocations)
			.where(whereClause);
		const totalCount = countResult[0].count;

		const rows = await db
			.select()
			.from(schema.invocations)
			.where(whereClause)
			.orderBy(desc(schema.invocations.startedAt))
			.limit(limit)
			.offset(offset);

		return {
			items: rows,
			pagination: {
				page,
				limit,
				total: totalCount,
				pages: Math.ceil(totalCount / limit),
			},
		};
	},

	/**
	 * Get a single invocation by ID
	 */
	async getById(id: string) {
		const db = getDb();
		const [row] = await db
			.select()
			.from(schema.invocations)
			.where(eq(schema.invocations.id, id));
		return row ?? null;
	},

	/**
	 * Get the latest invocation for a playlist
	 */
	async getLatestForPlaylist(playlistId: string) {
		const db = getDb();
		const [row] = await db
			.select()
			.from(schema.invocations)
			.where(eq(schema.invocations.playlistId, playlistId))
			.orderBy(desc(schema.invocations.startedAt))
			.limit(1);
		return row ?? null;
	},

	/**
	 * Get invocation counts by status for a playlist
	 */
	async getCountsByStatus(playlistId?: string) {
		const db = getDb();
		const conditions: SQL[] = [];

		if (playlistId) {
			conditions.push(eq(schema.invocations.playlistId, playlistId));
		}

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

		const result = await db
			.select({
				status: schema.invocations.status,
				count: count(),
			})
			.from(schema.invocations)
			.where(whereClause)
			.groupBy(schema.invocations.status);

		return result;
	},
};
