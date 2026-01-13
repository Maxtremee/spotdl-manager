import { createFileRoute } from "@tanstack/solid-router";
import { createMemo, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack } from "styled-system/patterns";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
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

	const successRatePct = createMemo(() =>
		Math.round((data().summary.successRate || 0) * 100),
	);

	const formatDuration = (ms: number) => {
		if (!ms || ms <= 0) {
			return "--";
		}
		const sec = Math.round(ms / 1000);
		if (sec < 60) {
			return `${sec}s`;
		}
		const m = Math.floor(sec / 60);
		const s = sec % 60;
		if (m < 60) {
			return `${m}m ${s}s`;
		}
		const h = Math.floor(m / 60);
		const mm = m % 60;
		return `${h}h ${mm}m`;
	};

	const StatusBadge = (props: {
		status: "running" | "success" | "failed" | "canceled";
	}) => {
		const label = {
			running: "Running",
			success: "Success",
			failed: "Failed",
			canceled: "Canceled",
		}[props.status];
		return <Badge>{label}</Badge>;
	};

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
					<div class={hstack({ gap: "4", flexWrap: "wrap" })}>
						<Card.Root class={css({ p: "4", minW: "56" })}>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								Success rate
							</Text>
							<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
								{successRatePct()}%
							</Text>
						</Card.Root>
						<Card.Root class={css({ p: "4", minW: "56" })}>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								Avg duration
							</Text>
							<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
								{formatDuration(data().summary.windowAvgDurationMs)}
							</Text>
						</Card.Root>
						<Card.Root class={css({ p: "4", minW: "56" })}>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								Success
							</Text>
							<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
								{countsByStatus().get("success") ?? 0}
							</Text>
						</Card.Root>
						<Card.Root class={css({ p: "4", minW: "56" })}>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								Failed
							</Text>
							<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
								{countsByStatus().get("failed") ?? 0}
							</Text>
						</Card.Root>
					</div>
				</Card.Body>
			</Card.Root>

			<Card.Root class={css({ mt: "6" })}>
				<Card.Header>
					<div class={hstack({ justify: "space-between", w: "full" })}>
						<div>
							<Card.Title>Recent Runs</Card.Title>
							<Text class={css({ color: "fg.muted", fontSize: "sm", mt: "1" })}>
								Last {data().recent.items.length} runs
							</Text>
						</div>
						<a href="/status">
							<Button variant="outline" size="sm">
								Open full dashboard
							</Button>
						</a>
					</div>
				</Card.Header>
				<Card.Body class={css({ overflow: "auto" })}>
					<Show
						when={data().recent.items.length > 0}
						fallback={
							<Text class={css({ color: "fg.muted" })}>No recent runs.</Text>
						}
					>
						<Table.Root class={css({ w: "full" })}>
							<Table.Head>
								<Table.Row>
									<Table.Header>Started</Table.Header>
									<Table.Header>Playlist</Table.Header>
									<Table.Header>Status</Table.Header>
									<Table.Header>Duration</Table.Header>
									<Table.Header>Log</Table.Header>
								</Table.Row>
							</Table.Head>
							<Table.Body>
								<For each={data().recent.items}>
									{(item) => {
										const name =
											data().playlists[item.playlistId]?.name ||
											item.playlistId;
										const started = new Date(item.startedAt).toLocaleString();
										const dur = item.finishedAt
											? new Date(item.finishedAt).getTime() -
												new Date(item.startedAt).getTime()
											: 0;
										return (
											<Table.Row>
												<Table.Cell>{started}</Table.Cell>
												<Table.Cell>
													<a
														class={css({
															color: "fg.default",
															textDecoration: "underline",
														})}
														href={`/library/${item.playlistId}`}
													>
														{name}
													</a>
												</Table.Cell>
												<Table.Cell>
													<StatusBadge status={item.status} />
												</Table.Cell>
												<Table.Cell>
													{item.status === "running"
														? "--"
														: formatDuration(dur)}
												</Table.Cell>
												<Table.Cell>
													<Show when={item.logPath}>
														<a
															class={css({
																color: "fg.default",
																textDecoration: "underline",
															})}
															href={`/library/${item.playlistId}/logs/${item.id}`}
														>
															Open
														</a>
													</Show>
												</Table.Cell>
											</Table.Row>
										);
									}}
								</For>
							</Table.Body>
						</Table.Root>
					</Show>
				</Card.Body>
			</Card.Root>
		</>
	);
}
