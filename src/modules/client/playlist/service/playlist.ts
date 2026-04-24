import type { Playlist } from "../schema/playlist";

export type PaginationState = {
	page: number;
	limit: number;
	total: number;
	pages: number;
};

export type FilterState = {
	status?: Playlist["status"];
	search?: string;
};

export type PlaylistsResponse = {
	items: Playlist[];
	pagination: PaginationState;
};

/**
 * Client-side playlist service
 * Handles application logic for playlist data fetching and state management
 */
export const PlaylistService = {
	/**
	 * Build query parameters from filter and pagination state
	 */
	buildQueryParams(filter: FilterState, pagination: PaginationState) {
		const params = new URLSearchParams();

		if (pagination.page > 1) {
			params.append("page", String(pagination.page));
		}
		if (pagination.limit !== 10) {
			params.append("limit", String(pagination.limit));
		}
		if (filter.status) {
			params.append("status", filter.status);
		}
		if (filter.search) {
			params.append("search", filter.search);
		}

		return params.toString();
	},

	/**
	 * Parse query string into filter and pagination state
	 */
	parseQueryParams(queryString: string) {
		const params = new URLSearchParams(queryString);

		return {
			filter: {
				status: (params.get("status") as Playlist["status"]) || undefined,
				search: params.get("search") || undefined,
			},
			pagination: {
				page: Math.max(1, Number(params.get("page")) || 1),
				limit: Math.min(100, Math.max(1, Number(params.get("limit")) || 10)),
			},
		};
	},

	/**
	 * Get default pagination state
	 */
	getDefaultPagination(): PaginationState {
		return {
			page: 1,
			limit: 10,
			total: 0,
			pages: 0,
		};
	},

	/**
	 * Get default filter state
	 */
	getDefaultFilter(): FilterState {
		return {
			status: undefined,
			search: undefined,
		};
	},

	/**
	 * Format playlist status for display
	 */
	formatStatus(status: Playlist["status"]): string {
		const labels: Record<Playlist["status"], string> = {
			active: "Active",
			paused: "Paused",
			archived: "Archived",
			error: "Error",
		};
		return labels[status];
	},

	/**
	 * Get status badge color variant
	 */
	getStatusVariant(
		status: Playlist["status"],
	): "default" | "success" | "warning" | "error" {
		const variants: Record<
			Playlist["status"],
			"default" | "success" | "warning" | "error"
		> = {
			active: "success",
			paused: "warning",
			archived: "default",
			error: "error",
		};
		return variants[status];
	},

	/**
	 * Format source type for display
	 */
	formatSourceType(
		type: Playlist["source"]["type"],
	): "Playlist" | "Album" {
		const labels = {
			playlist: "Playlist",
			album: "Album",
		} as const;
		return labels[type];
	},

	/**
	 * Truncate long text with ellipsis
	 */
	truncateText(text: string, maxLength: number = 50): string {
		if (text.length <= maxLength) {
			return text;
		}
		return `${text.slice(0, maxLength - 3)}...`;
	},

	/**
	 * Format date for display
	 */
	formatDate(date: Date): string {
		return new Intl.DateTimeFormat("en-US", {
			year: "numeric",
			month: "2-digit",
			day: "2-digit",
			hour: "2-digit",
			minute: "2-digit",
		}).format(date);
	},
};
