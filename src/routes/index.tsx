import { createFileRoute } from "@tanstack/solid-router";
import { createMemo } from "solid-js";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";
import { RecentRunsTable } from "~/modules/client/invocation/components/recent-runs-table";
import { SummaryStatsCards } from "~/modules/client/invocation/components/summary-stats-cards";
import { getStatusSummaryServerFn } from "~/modules/server/invocation/functions";

export const Route = createFileRoute("/")({
	loader: () =>
		getStatusSummaryServerFn({
			data: { page: 1, limit: 10, window: "24h" },
		}),
	component: App,
});

function App() {
	const data = Route.useLoaderData();

	const countsByStatus = createMemo(() => {
		const map = new Map<string, number>();
		for (const c of data().summary.windowCounts) {
			map.set(c.status, c.count);
		}
		return map;
	});

	return (
		<>
			<header class={stack({ gap: "2" })}>
				<Text
					as="h1"
					class={css({
						color: "fg.default",
						fontSize: { base: "2xl", md: "3xl" },
					})}
				>
					Overview
				</Text>
				<Text class={css({ color: "fg.subtle" })}>
					Quick status of recent downloads and queue health.
				</Text>
			</header>
			<Card.Root>
				<Card.Header>
					<Card.Title>Summary (last 24h)</Card.Title>
					<Text class={css({ color: "fg.muted" })}>
						Aggregated run metrics.
					</Text>
				</Card.Header>
				<Card.Body>
					<SummaryStatsCards
						successRate={data().summary.successRate || 0}
						avgDurationMs={data().summary.windowAvgDurationMs}
						successCount={countsByStatus().get("success") ?? 0}
						failedCount={countsByStatus().get("failed") ?? 0}
					/>
				</Card.Body>
			</Card.Root>

			<div class={css({ mt: "6" })}>
				<RecentRunsTable
					items={data().recent.items}
					playlists={data().playlists}
					subtitle={`Last ${data().recent.items.length} runs`}
					headerAction={{ label: "Open full dashboard", href: "/status" }}
				/>
			</div>
		</>
	);
}
