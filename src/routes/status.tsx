import { createFileRoute } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { createMemo } from "solid-js";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import { z } from "zod";
import { Text } from "~/components/ui/text";
import { RecentRunsTable } from "~/modules/client/invocation/components/recent-runs-table";
import {
	StatusFilters,
	type StatusFiltersValue,
} from "~/modules/client/invocation/components/status-filters";
import { SummaryStatsCards } from "~/modules/client/invocation/components/summary-stats-cards";
import { getStatusSummaryServerFn } from "~/modules/server/invocation/functions";

const statusSearchSchema = z.object({
	page: fallback(z.int().positive(), 1).default(1),
	status: fallback(
		z.enum(["running", "success", "failed", "canceled"]).optional(),
		undefined,
	).default(undefined),
	playlistId: fallback(z.string().optional(), undefined).default(undefined),
	window: fallback(
		z.enum(["24h", "7d", "30d", "all"]).default("24h"),
		"24h",
	).default("24h"),
});

export const Route = createFileRoute("/status")({
	validateSearch: zodValidator(statusSearchSchema),
	loaderDeps: ({ search }) => search,
	loader: ({ deps: search }) =>
		getStatusSummaryServerFn({
			data: {
				page: search.page,
				limit: 20,
				status: search.status,
				playlistId: search.playlistId,
				window: search.window,
			},
		}),
	component: StatusDashboard,
});

function StatusDashboard() {
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const data = Route.useLoaderData();

	const countsByStatus = createMemo(() => {
		const map = new Map<string, number>();
		for (const c of data().summary.windowCounts) {
			map.set(c.status, c.count);
		}
		return map;
	});

	const handleFilterSubmit = (value: StatusFiltersValue) => {
		navigate({
			search: (prev) => ({
				...prev,
				page: 1,
				window: value.window,
				status: value.status,
				playlistId: value.playlistId,
			}),
		});
	};

	const onPageChange = (page: number) => {
		navigate({ search: (prev) => ({ ...prev, page }) });
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	return (
		<>
			<header class={stack({ gap: "2", mb: "6" })}>
				<Text
					as="h1"
					class={css({
						color: "fg.default",
						fontSize: { base: "2xl", md: "3xl" },
					})}
				>
					Status
				</Text>
				<Text class={css({ color: "fg.subtle" })}>
					Recent runs, failures, and durations.
				</Text>
			</header>

			<StatusFilters
				defaultWindow={search().window}
				defaultStatus={search().status}
				defaultPlaylistId={search().playlistId}
				onSubmit={handleFilterSubmit}
			/>

			<div class={css({ mb: "6" })}>
				<SummaryStatsCards
					successRate={data().summary.successRate || 0}
					avgDurationMs={data().summary.windowAvgDurationMs}
					successCount={countsByStatus().get("success") ?? 0}
					failedCount={countsByStatus().get("failed") ?? 0}
				/>
			</div>

			<RecentRunsTable
				items={data().recent.items}
				playlists={data().playlists}
				pagination={data().recent.pagination}
				currentPage={search().page}
				onPageChange={onPageChange}
				emptyMessage="No runs found for this filter."
			/>
		</>
	);
}
