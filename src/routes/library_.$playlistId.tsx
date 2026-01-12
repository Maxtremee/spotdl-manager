import { createListCollection } from "@ark-ui/solid/select";
import { createFileRoute, Link } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { createSignal, For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack, vstack } from "styled-system/patterns";
import { z } from "zod";
import { Badge } from "~/components/ui/badge";
import * as Breadcrumb from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Link as UILink } from "~/components/ui/link";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import * as Select from "~/components/ui/select";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import { toaster } from "~/components/ui/toast";
import { PlaylistService } from "~/modules/client/playlist/service/playlist";
import {
	getPlaylistDetailsServerFn,
	updatePlaylistServerFn,
} from "~/modules/server/playlist/functions";

const searchSchema = z.object({
	invocationsPage: fallback(z.int().positive(), 1).default(1),
});

export const Route = createFileRoute("/library_/$playlistId")({
	validateSearch: zodValidator(searchSchema),
	loaderDeps: ({ search }) => search,
	loader: ({ params, deps: search }) =>
		getPlaylistDetailsServerFn({
			data: {
				id: params.playlistId,
				invocationsPage: search.invocationsPage,
				invocationsLimit: 10,
			},
		}),
	component: PlaylistDetails,
});

function PlaylistDetails() {
	const navigate = Route.useNavigate();
	const params = Route.useParams();
	const search = Route.useSearch();
	const data = Route.useLoaderData();
	const [isUpdating, setIsUpdating] = createSignal(false);

	const playlist = () => data().playlist;
	const invocations = () => data().invocations;

	const handleStatusChange = async (newStatus: string) => {
		setIsUpdating(true);
		try {
			const result = await updatePlaylistServerFn({
				data: {
					id: playlist().id!,
					status: newStatus as "active" | "paused" | "archived" | "error",
				},
			});
			if (result.success) {
				toaster.success({
					title: "Status updated",
					description: `Playlist status changed to ${newStatus}`,
				});
				navigate({ to: ".", reloadDocument: true });
			} else {
				toaster.error({
					title: "Update failed",
					description: result.error || "Failed to update status",
				});
			}
		} catch (error) {
			toaster.error({
				title: "Error",
				description:
					error instanceof Error ? error.message : "Failed to update status",
			});
		} finally {
			setIsUpdating(false);
		}
	};

	const handleFormatChange = async (newFormat: string) => {
		setIsUpdating(true);
		try {
			const result = await updatePlaylistServerFn({
				data: {
					id: playlist().id!,
					flags: {
						format: newFormat as
							| "mp3"
							| "flac"
							| "ogg"
							| "m4a"
							| "opus"
							| "vorbis"
							| "wav",
					},
				},
			});
			if (result.success) {
				toaster.success({
					title: "Format updated",
					description: `Download format changed to ${newFormat.toUpperCase()}`,
				});
				navigate({ to: ".", reloadDocument: true });
			} else {
				toaster.error({
					title: "Update failed",
					description: result.error || "Failed to update format",
				});
			}
		} catch (error) {
			toaster.error({
				title: "Error",
				description:
					error instanceof Error ? error.message : "Failed to update format",
			});
		} finally {
			setIsUpdating(false);
		}
	};

	const handleQualityChange = async (newQuality: string) => {
		setIsUpdating(true);
		try {
			const result = await updatePlaylistServerFn({
				data: {
					id: playlist().id!,
					flags: {
						quality: newQuality as
							| "worst"
							| "low"
							| "medium"
							| "high"
							| "very_high"
							| "lossless",
					},
				},
			});
			if (result.success) {
				toaster.success({
					title: "Quality updated",
					description: `Download quality changed to ${newQuality}`,
				});
				navigate({ to: ".", reloadDocument: true });
			} else {
				toaster.error({
					title: "Update failed",
					description: result.error || "Failed to update quality",
				});
			}
		} catch (error) {
			toaster.error({
				title: "Error",
				description:
					error instanceof Error ? error.message : "Failed to update quality",
			});
		} finally {
			setIsUpdating(false);
		}
	};

	const handlePageChange = (details: { page: number }) => {
		navigate({
			search: (prev) => ({
				...prev,
				invocationsPage: details.page,
			}),
		});
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	const statusOptions = [
		{ label: "Active", value: "active" },
		{ label: "Paused", value: "paused" },
		{ label: "Archived", value: "archived" },
	];

	const formatOptions = [
		{ label: "MP3", value: "mp3" },
		{ label: "FLAC", value: "flac" },
		{ label: "OGG", value: "ogg" },
		{ label: "M4A", value: "m4a" },
		{ label: "Opus", value: "opus" },
		{ label: "Vorbis", value: "vorbis" },
		{ label: "WAV", value: "wav" },
	];

	const qualityOptions = [
		{ label: "Worst", value: "worst" },
		{ label: "Low", value: "low" },
		{ label: "Medium", value: "medium" },
		{ label: "High", value: "high" },
		{ label: "Very High", value: "very_high" },
		{ label: "Lossless", value: "lossless" },
	];

	const formatInvocationStatus = (
		status: "running" | "success" | "failed" | "canceled",
	) => {
		const labels = {
			running: "Running",
			success: "Success",
			failed: "Failed",
			canceled: "Canceled",
		};
		return labels[status];
	};

	const formatDuration = (startedAt: Date, finishedAt: Date | null): string => {
		if (!finishedAt) {
			return "In progress...";
		}
		const durationMs = finishedAt.getTime() - startedAt.getTime();
		const seconds = Math.floor(durationMs / 1000);
		if (seconds < 60) {
			return `${seconds}s`;
		}
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		return `${minutes}m ${remainingSeconds}s`;
	};

	return (
		<>
			{/* Header with breadcrumb navigation */}
			<header class={stack({ gap: "4", mb: "6" })}>
				<Breadcrumb.Root>
					<Breadcrumb.List>
						<Breadcrumb.Item>
							<Link
								to="/"
								class={css({
									color: "fg.muted",
									fontSize: "sm",
									"&:hover": { color: "fg.default" },
									textDecoration: "none",
								})}
							>
								Home
							</Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							<Link
								to="/library"
								class={css({
									color: "fg.muted",
									fontSize: "sm",
									"&:hover": { color: "fg.default" },
									textDecoration: "none",
								})}
							>
								Library
							</Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							<span
								class={css({
									color: "fg.default",
									fontSize: "sm",
									fontWeight: "medium",
								})}
							>
								{playlist().name}
							</span>
						</Breadcrumb.Item>
					</Breadcrumb.List>
				</Breadcrumb.Root>
				<Text
					as="h1"
					class={css({
						color: "fg.default",
						fontSize: { base: "2xl", md: "3xl" },
					})}
				>
					{playlist().name}
				</Text>
				<div class={hstack({ gap: "2" })}>
					<Badge>
						{PlaylistService.formatSourceType(playlist().source.type)}
					</Badge>
					<Badge>{PlaylistService.formatStatus(playlist().status)}</Badge>
				</div>
			</header>

			{/* Playlist Details Card */}
			<Card.Root class={css({ mb: "6" })}>
				<Card.Header>
					<Card.Title>Playlist Configuration</Card.Title>
				</Card.Header>
				<Card.Body>
					<div
						class={css({
							display: "grid",
							gridTemplateColumns: { base: "1fr", md: "repeat(2, 1fr)" },
							gap: "6",
						})}
					>
						{/* Left column - Info */}
						<div class={vstack({ gap: "4", alignItems: "stretch" })}>
							<Field.Root>
								<Field.Label>Source URL</Field.Label>
								<UILink
									class={css({
										fontSize: "sm",
										color: "fg.muted",
										wordBreak: "break-all",
									})}
									href={playlist().source.url}
									target="_blank"
									rel="noopener noreferrer"
								>
									{playlist().source.url}
								</UILink>
							</Field.Root>

							<Field.Root>
								<Field.Label>Output Directory</Field.Label>
								<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
									{playlist().outputDir}
								</Text>
							</Field.Root>

							<Field.Root>
								<Field.Label>Schedule</Field.Label>
								<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
									<Show when={playlist().schedule?.enabled} fallback="Disabled">
										{playlist().schedule?.schedule.type === "cron"
											? // @ts-expect-error
												`Cron: ${playlist().schedule?.schedule.cron}`
											: // @ts-expect-error
												`Every ${playlist().schedule?.schedule.minutes} minutes`}
									</Show>
								</Text>
							</Field.Root>
						</div>

						{/* Right column - Controls */}
						<div class={vstack({ gap: "4", alignItems: "stretch" })}>
							<Field.Root>
								<Field.Label>Status</Field.Label>
								<Select.Root
									collection={createListCollection({ items: statusOptions })}
									value={[playlist().status]}
									onValueChange={(details) => {
										if (details.value[0] !== playlist().status) {
											handleStatusChange(details.value[0]);
										}
									}}
									disabled={isUpdating()}
									positioning={{ sameWidth: true }}
								>
									<Select.Control>
										<Select.Trigger>
											<Select.ValueText placeholder="Select status" />
										</Select.Trigger>
									</Select.Control>
									<Select.Positioner>
										<Select.Content>
											<For each={statusOptions}>
												{(item) => (
													<Select.Item item={item}>
														<Select.ItemText>{item.label}</Select.ItemText>
													</Select.Item>
												)}
											</For>
										</Select.Content>
									</Select.Positioner>
								</Select.Root>
							</Field.Root>

							<Field.Root>
								<Field.Label>Format</Field.Label>
								<Select.Root
									collection={createListCollection({ items: formatOptions })}
									value={[playlist().flags?.format || "mp3"]}
									onValueChange={(details) => {
										if (details.value[0] !== playlist().flags?.format) {
											handleFormatChange(details.value[0]);
										}
									}}
									disabled={isUpdating()}
									positioning={{ sameWidth: true }}
								>
									<Select.Control>
										<Select.Trigger>
											<Select.ValueText placeholder="Select format" />
										</Select.Trigger>
									</Select.Control>
									<Select.Positioner>
										<Select.Content>
											<For each={formatOptions}>
												{(item) => (
													<Select.Item item={item}>
														<Select.ItemText>{item.label}</Select.ItemText>
													</Select.Item>
												)}
											</For>
										</Select.Content>
									</Select.Positioner>
								</Select.Root>
							</Field.Root>

							<Field.Root>
								<Field.Label>Quality</Field.Label>
								<Select.Root
									collection={createListCollection({ items: qualityOptions })}
									value={[playlist().flags?.quality || "high"]}
									onValueChange={(details) => {
										if (details.value[0] !== playlist().flags?.quality) {
											handleQualityChange(details.value[0]);
										}
									}}
									disabled={isUpdating()}
									positioning={{ sameWidth: true }}
								>
									<Select.Control>
										<Select.Trigger>
											<Select.ValueText placeholder="Select quality" />
										</Select.Trigger>
									</Select.Control>
									<Select.Positioner>
										<Select.Content>
											<For each={qualityOptions}>
												{(item) => (
													<Select.Item item={item}>
														<Select.ItemText>{item.label}</Select.ItemText>
													</Select.Item>
												)}
											</For>
										</Select.Content>
									</Select.Positioner>
								</Select.Root>
							</Field.Root>
						</div>
					</div>
				</Card.Body>
			</Card.Root>

			{/* Invocations Card */}
			<Card.Root>
				<Card.Header>
					<div class={hstack({ justify: "space-between", w: "full" })}>
						<div>
							<Card.Title>
								Sync History ({invocations().pagination.total || 0})
							</Card.Title>
							<Text class={css({ color: "fg.muted", fontSize: "sm", mt: "1" })}>
								Page {search().invocationsPage} of{" "}
								{invocations().pagination.pages || 1}
							</Text>
						</div>
					</div>
				</Card.Header>

				<Card.Body class={css({ overflow: "auto" })}>
					<Show
						when={invocations().items.length > 0}
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
									This playlist has not been synced yet. Sync history will
									appear here after the first run.
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
								<For each={invocations().items}>
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
												<Badge>
													{formatInvocationStatus(invocation.status)}
												</Badge>
											</Table.Cell>
											<Table.Cell
												class={css({ fontSize: "sm", color: "fg.muted" })}
											>
												{formatDuration(
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
														playlistId: params().playlistId,
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

				{/* Pagination */}
				<Show when={(invocations().pagination.pages ?? 0) > 1}>
					<Card.Footer
						class={css({ borderTop: "1px solid token(colors.border.default)" })}
					>
						<Pagination.Root
							count={invocations().pagination.total || 0}
							pageSize={invocations().pagination.limit || 10}
							page={search().invocationsPage as PaginationRootProps["page"]}
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
		</>
	);
}
