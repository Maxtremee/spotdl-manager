import { createFileRoute } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { createMemo, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack } from "styled-system/patterns";
import { z } from "zod";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import {
	StatusFilters,
	type StatusFiltersValue,
} from "~/modules/client/invocation/components/status-filters";
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

function formatDuration(ms: number) {
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
}

function StatusBadge(props: {
	status: "running" | "success" | "failed" | "canceled";
}) {
	const label = {
		running: "Running",
		success: "Success",
		failed: "Failed",
		canceled: "Canceled",
	}[props.status];
	return <Badge>{label}</Badge>;
}

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

	const successRatePct = createMemo(() =>
		Math.round((data().summary.successRate || 0) * 100),
	);

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

	const onPageChange = (details: { page: number }) => {
		navigate({ search: (prev) => ({ ...prev, page: details.page }) });
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

			{/* Summary cards */}
			<div class={hstack({ gap: "4", flexWrap: "wrap", mb: "6" })}>
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
					<Text class={css({ fontSize: "sm", color: "fg.muted" })}>Failed</Text>
					<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
						{countsByStatus().get("failed") ?? 0}
					</Text>
				</Card.Root>
			</div>

			{/* Recent table */}
			<Card.Root>
				<Card.Header>
					<Card.Title>Recent Runs</Card.Title>
				</Card.Header>
				<Card.Body class={css({ overflow: "auto" })}>
					<Show
						when={data().recent.items.length > 0}
						fallback={
							<Text class={css({ color: "fg.muted" })}>
								No runs found for this filter.
							</Text>
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

				<Show when={(data().recent.pagination.pages ?? 0) > 1}>
					<Card.Footer
						class={css({ borderTop: "1px solid token(colors.border.default)" })}
					>
						<Pagination.Root
							count={data().recent.pagination.total || 0}
							pageSize={data().recent.pagination.limit || 20}
							page={search().page as PaginationRootProps["page"]}
							onPageChange={onPageChange}
							class={css({ w: "full" })}
						>
							<div class={hstack({ gap: "2", justify: "center", w: "full" })}>
								<Pagination.PrevTrigger>
									<Button variant="outline" size="sm">
										← Previous
									</Button>
								</Pagination.PrevTrigger>
								<Pagination.Items
									render={(page) => (
										<Pagination.Item
											{...page}
											class={css({
												"&[data-selected]": { fontWeight: "bold" },
											})}
										>
											<Button
												variant={page.selected ? "solid" : "outline"}
												size="sm"
											>
												{page.value}
											</Button>
										</Pagination.Item>
									)}
									ellipsis={<span>...</span>}
								/>
								<Pagination.NextTrigger>
									<Button variant="outline" size="sm">
										Next →
									</Button>
								</Pagination.NextTrigger>
							</div>
						</Pagination.Root>
					</Card.Footer>
				</Show>
			</Card.Root>
		</>
	);
}
