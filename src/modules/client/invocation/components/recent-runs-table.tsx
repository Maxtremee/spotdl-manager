import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { formatDuration } from "~/modules/client/invocation/service/duration";
import {
	StatusBadge,
	type InvocationStatus,
} from "~/modules/client/invocation/components/status-badge";

interface RecentRun {
	id: string;
	playlistId: string;
	status: InvocationStatus;
	startedAt: string | Date;
	finishedAt: string | Date | null;
	logPath: string | null;
}

interface PlaylistInfo {
	name: string;
}

interface PaginationInfo {
	total: number;
	pages: number;
	limit: number;
}

interface RecentRunsTableProps {
	items: RecentRun[];
	playlists: Record<string, PlaylistInfo>;
	pagination?: PaginationInfo;
	currentPage?: number;
	onPageChange?: (page: number) => void;
	emptyMessage?: string;
	title?: string;
	subtitle?: string;
	headerAction?: { label: string; href: string };
}

export function RecentRunsTable(props: RecentRunsTableProps) {
	const handlePageChange = (details: { page: number }) => {
		props.onPageChange?.(details.page);
	};

	return (
		<Card.Root>
			<Card.Header>
				<div class={hstack({ justify: "space-between", w: "full" })}>
					<div>
						<Card.Title>{props.title || "Recent Runs"}</Card.Title>
						<Show when={props.subtitle}>
							<Text class={css({ color: "fg.muted", fontSize: "sm", mt: "1" })}>
								{props.subtitle}
							</Text>
						</Show>
					</div>
					<Show when={props.headerAction}>
						{(action) => (
							<a href={action().href}>
								<Button variant="outline" size="sm">
									{action().label}
								</Button>
							</a>
						)}
					</Show>
				</div>
			</Card.Header>
			<Card.Body class={css({ overflow: "auto" })}>
				<Show
					when={props.items.length > 0}
					fallback={
						<Text class={css({ color: "fg.muted" })}>
							{props.emptyMessage || "No recent runs."}
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
							<For each={props.items}>
								{(item) => {
									const name =
										props.playlists[item.playlistId]?.name || item.playlistId;
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
												{item.status === "running" ? "--" : formatDuration(dur)}
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

			<Show when={props.pagination && (props.pagination.pages ?? 0) > 1}>
				{(pagination) => (
					<Card.Footer
						class={css({ borderTop: "1px solid token(colors.border.default)" })}
					>
						<Pagination.Root
							count={pagination().total || 0}
							pageSize={pagination().limit || 20}
							page={props.currentPage as PaginationRootProps["page"]}
							onPageChange={handlePageChange}
							class={css({ w: "full" })}
						>
							<div class={hstack({ gap: "2", justify: "center", w: "full" })}>
								<Pagination.PrevTrigger>
									<Button variant="outline" size="sm">
										Previous
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
										Next
									</Button>
								</Pagination.NextTrigger>
							</div>
						</Pagination.Root>
					</Card.Footer>
				)}
			</Show>
		</Card.Root>
	);
}
