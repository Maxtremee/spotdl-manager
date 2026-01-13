import { Link } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, vstack } from "styled-system/patterns";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { formatDurationFromDates } from "~/modules/client/invocation/service/duration";
import { PlaylistService } from "~/modules/client/playlist/service/playlist";

interface Invocation {
	id: string;
	status: "running" | "success" | "failed" | "canceled";
	startedAt: Date;
	finishedAt: Date | null;
	exitCode: number | null;
	summary: string | null;
}

interface PaginationInfo {
	total: number;
	pages: number;
	limit: number;
}

interface SyncHistoryCardProps {
	playlistId: string;
	invocations: Invocation[];
	pagination: PaginationInfo;
	currentPage: number;
	onPageChange: (page: number) => void;
}

const statusLabels = {
	running: "Running",
	success: "Success",
	failed: "Failed",
	canceled: "Canceled",
};

export function SyncHistoryCard(props: SyncHistoryCardProps) {
	const handlePageChange = (details: { page: number }) => {
		props.onPageChange(details.page);
	};

	return (
		<Card.Root>
			<Card.Header>
				<div class={hstack({ justify: "space-between", w: "full" })}>
					<div>
						<Card.Title>
							Sync History ({props.pagination.total || 0})
						</Card.Title>
						<Text class={css({ color: "fg.muted", fontSize: "sm", mt: "1" })}>
							Page {props.currentPage} of {props.pagination.pages || 1}
						</Text>
					</div>
				</div>
			</Card.Header>

			<Card.Body class={css({ overflow: "auto" })}>
				<Show
					when={props.invocations.length > 0}
					fallback={
						<div class={vstack({ gap: "2", py: "8", alignItems: "center" })}>
							<Text
								as="h3"
								class={css({
									fontSize: "lg",
									fontWeight: "semibold",
									color: "fg.default",
								})}
							>
								No sync history
							</Text>
							<Text
								class={css({
									color: "fg.muted",
									maxW: "md",
									textAlign: "center",
								})}
							>
								This playlist has not been synced yet. Sync history will appear
								here after the first run.
							</Text>
						</div>
					}
				>
					<Table.Root class={css({ w: "full" })}>
						<Table.Head>
							<Table.Row>
								<Table.Header class={css({ fontWeight: "semibold" })}>
									Started
								</Table.Header>
								<Table.Header class={css({ fontWeight: "semibold" })}>
									Status
								</Table.Header>
								<Table.Header class={css({ fontWeight: "semibold" })}>
									Duration
								</Table.Header>
								<Table.Header class={css({ fontWeight: "semibold" })}>
									Exit Code
								</Table.Header>
								<Table.Header class={css({ fontWeight: "semibold" })}>
									Summary
								</Table.Header>
								<Table.Header class={css({ fontWeight: "semibold" })}>
									Actions
								</Table.Header>
							</Table.Row>
						</Table.Head>
						<Table.Body>
							<For each={props.invocations}>
								{(invocation) => (
									<Table.Row
										class={css({
											"&:hover": { bgColor: "bg.muted" },
										})}
									>
										<Table.Cell class={css({ fontSize: "sm" })}>
											{PlaylistService.formatDate(invocation.startedAt)}
										</Table.Cell>
										<Table.Cell>
											<Badge>{statusLabels[invocation.status]}</Badge>
										</Table.Cell>
										<Table.Cell
											class={css({ fontSize: "sm", color: "fg.muted" })}
										>
											{formatDurationFromDates(
												invocation.startedAt,
												invocation.finishedAt,
											)}
										</Table.Cell>
										<Table.Cell
											class={css({ fontSize: "sm", color: "fg.muted" })}
										>
											{invocation.exitCode ?? "-"}
										</Table.Cell>
										<Table.Cell
											class={css({ fontSize: "sm", color: "fg.muted" })}
										>
											{invocation.summary
												? PlaylistService.truncateText(invocation.summary, 50)
												: "-"}
										</Table.Cell>
										<Table.Cell>
											<Link
												to="/library/$playlistId/logs/$logId"
												params={{
													playlistId: props.playlistId,
													logId: invocation.id,
												}}
											>
												<Button variant="subtle" size="xs">
													View Log
												</Button>
											</Link>
										</Table.Cell>
									</Table.Row>
								)}
							</For>
						</Table.Body>
					</Table.Root>
				</Show>
			</Card.Body>

			<Show when={(props.pagination.pages ?? 0) > 1}>
				<Card.Footer
					class={css({ borderTop: "1px solid token(colors.border.default)" })}
				>
					<Pagination.Root
						count={props.pagination.total || 0}
						pageSize={props.pagination.limit || 10}
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
			</Show>
		</Card.Root>
	);
}
