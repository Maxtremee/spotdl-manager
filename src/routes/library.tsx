import { createListCollection } from "@ark-ui/solid";
import { createFileRoute } from "@tanstack/solid-router";
import { zodValidator } from "@tanstack/zod-adapter";
import { For, Show, Suspense } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack, vstack } from "styled-system/patterns";
import { z } from "zod";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Fieldset from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { InputGroup } from "~/components/ui/input-group";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import type { ValueChangeDetails } from "~/components/ui/select";
import * as Select from "~/components/ui/select";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import type { Playlist } from "~/modules/client/playlist/schema/playlist";
import { PlaylistService } from "~/modules/client/playlist/service/playlist";
import { listPlaylistsServerFn } from "~/modules/server/playlist/functions";

const statusOptions = createListCollection<{
	label: string;
	value: Playlist["status"];
}>({
	items: [
		{ label: "Active", value: "active" },
		{ label: "Paused", value: "paused" },
		{ label: "Archived", value: "archived" },
		{ label: "Error", value: "error" },
	],
});

// Define search params schema with Zod
const playlistSearchSchema = z.object({
	page: z.number().int().positive().catch(1),
	search: z.string().catch(""),
	status: z
		.enum(["active", "paused", "archived", "error"])
		.optional()
		.catch(undefined),
});

export const Route = createFileRoute("/library")({
	validateSearch: zodValidator(playlistSearchSchema),
	loaderDeps: ({ search }) => search,
	loader: ({ deps: search }) =>
		listPlaylistsServerFn({
			data: {
				limit: 10,
				page: search.page,
				status: search.status,
				search: search.search || undefined,
			},
		}),
	component: Library,
});

function Library() {
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const playlists = Route.useLoaderData();

	// Handlers
	const handleSearch = (e: Event) => {
		e.preventDefault();
		navigate({
			search: (prev) => ({
				...prev,
				page: 1,
				search: search().search,
			}),
		});
	};

	const handlePageChange = (details: { page: number }) => {
		navigate({
			search: (prev) => ({
				...prev,
				page: details.page,
			}),
		});
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	const handleStatusChange = (value: string | undefined) => {
		navigate({
			search: (prev) => ({
				...prev,
				status: value as Playlist["status"] | undefined,
				page: 1,
			}),
		});
	};

	const handleSearchInput = (value: string) => {
		navigate({
			search: (prev) => ({
				...prev,
				search: value,
				page: 1,
			}),
		});
	};

	return (
		<>
			{/* Keep the existing Library header unchanged */}
			<header class={stack({ gap: "2", mb: "6" })}>
				<Text
					as="h1"
					class={css({
						color: "fg.default",
						fontSize: { base: "2xl", md: "3xl" },
					})}
				>
					Library
				</Text>
				<Text class={css({ color: "fg.subtle" })}>
					Browse downloaded tracks and manage metadata.
				</Text>
			</header>

			{/* Filters Card (moved from playlists) */}
			<Card.Root class={css({ mb: "6" })}>
				<Card.Header>
					<Card.Title>Filters and search</Card.Title>
				</Card.Header>
				<Card.Body>
					<div class={hstack({ gap: "4", flexWrap: "wrap" })}>
						{/* Search input */}
						<Fieldset.Root class={css({ flex: 1, minW: "250px" })}>
							<Fieldset.Legend
								class={css({ fontSize: "sm", fontWeight: "500" })}
							>
								Search
							</Fieldset.Legend>
							<InputGroup>
								<Input
									type="text"
									placeholder="Search playlist..."
									value={search().search}
									onChange={(e) => handleSearchInput(e.target.value)}
									onKeyDown={(e) => {
										if (e.key === "Enter") {
											handleSearch(e);
										}
									}}
								/>
							</InputGroup>
						</Fieldset.Root>

						{/* Status filter */}
						<Fieldset.Root class={css({ flex: 1, minW: "200px" })}>
							<Fieldset.Legend
								class={css({ fontSize: "sm", fontWeight: "500" })}
							>
								Status
							</Fieldset.Legend>
							<Select.Root
								collection={statusOptions}
								value={search().status ? [search().status ?? ""] : []}
								onValueChange={(details) => {
									handleStatusChange(details.value?.[0]);
								}}
							>
								<Select.Control>
									<Select.Trigger>
										<Select.ValueText placeholder="All statuses" />
										<Select.Indicator />
									</Select.Trigger>
								</Select.Control>
								<Select.Positioner>
									<Select.Content>
										<Select.List>
											<For each={statusOptions.items}>
												{(option) => (
													<Select.Item item={option}>
														<Select.ItemText>{option.label}</Select.ItemText>
													</Select.Item>
												)}
											</For>
										</Select.List>
									</Select.Content>
								</Select.Positioner>
							</Select.Root>
						</Fieldset.Root>

						{/* Action button */}
						<div class={hstack({ gap: "2", alignSelf: "flex-end" })}>
							<Button
								onClick={handleSearch}
								variant="solid"
								class={css({ mt: "auto" })}
							>
								Search
							</Button>
						</div>
					</div>
				</Card.Body>
			</Card.Root>

			{/* Main Content */}
			<Card.Root>
				<Card.Header>
					<div class={hstack({ justify: "space-between", w: "full" })}>
						<div>
							<Card.Title>
								Playlists ({playlists().pagination.total || 0})
							</Card.Title>
							<Text class={css({ color: "fg.muted", fontSize: "sm", mt: "1" })}>
								Page {search().page} of {playlists().pagination.pages || 0}
							</Text>
						</div>
						<Button variant="solid">+ New playlist</Button>
					</div>
				</Card.Header>

				<Card.Body class={css({ overflow: "auto" })}>
					<Suspense
						fallback={
							<div class={vstack({ gap: "4", py: "8", alignItems: "center" })}>
								<Text class={css({ color: "fg.muted" })}>
									Loading playlists...
								</Text>
							</div>
						}
					>
						<Show
							when={playlists() && playlists().items.length > 0}
							fallback={
								<div
									class={vstack({ gap: "2", py: "8", alignItems: "center" })}
								>
									<Text
										as="h3"
										class={css({
											fontSize: "lg",
											fontWeight: "semibold",
											color: "fg.default",
										})}
									>
										No playlists
									</Text>
									<Text
										class={css({
											color: "fg.muted",
											maxW: "md",
											textAlign: "center",
										})}
									>
										No playlists found. Create a new playlist to start
										downloading songs from Spotify.
									</Text>
									<Button variant="solid" class={css({ mt: "4" })}>
										+ Add playlist
									</Button>
								</div>
							}
						>
							<Table.Root class={css({ w: "full" })}>
								<Table.Head>
									<Table.Row>
										<Table.Header class={css({ fontWeight: "semibold" })}>
											Name
										</Table.Header>
										<Table.Header class={css({ fontWeight: "semibold" })}>
											Type
										</Table.Header>
										<Table.Header class={css({ fontWeight: "semibold" })}>
											Status
										</Table.Header>
										<Table.Header class={css({ fontWeight: "semibold" })}>
											Output
										</Table.Header>
										<Table.Header class={css({ fontWeight: "semibold" })}>
											Updated
										</Table.Header>
										<Table.Header class={css({ fontWeight: "semibold" })}>
											Actions
										</Table.Header>
									</Table.Row>
								</Table.Head>
								<Table.Body>
									<For each={playlists().items || []}>
										{(playlist) => (
											<Table.Row
												class={css({
													"&:hover": { bgColor: "bg.muted" },
													cursor: "pointer",
													transition: "colors 200ms",
												})}
											>
												<Table.Cell class={css({ fontWeight: "500" })}>
													{PlaylistService.truncateText(playlist.name, 40)}
												</Table.Cell>
												<Table.Cell>
													<Badge>
														{PlaylistService.formatSourceType(
															playlist.source.type,
														)}
													</Badge>
												</Table.Cell>
												<Table.Cell>
													<Badge>
														{PlaylistService.formatStatus(playlist.status)}
													</Badge>
												</Table.Cell>
												<Table.Cell
													class={css({ fontSize: "sm", color: "fg.muted" })}
												>
													{PlaylistService.truncateText(playlist.outputDir, 30)}
												</Table.Cell>
												<Table.Cell
													class={css({ fontSize: "sm", color: "fg.muted" })}
												>
													{playlist.updatedAt
														? PlaylistService.formatDate(playlist.updatedAt)
														: "N/A"}
												</Table.Cell>
												<Table.Cell>
													<div class={hstack({ gap: "2" })}>
														<Button
															size="sm"
															variant="outline"
															class={css({ fontSize: "xs" })}
														>
															Edit
														</Button>
														<Button
															size="sm"
															variant="outline"
															class={css({ fontSize: "xs" })}
														>
															Delete
														</Button>
													</div>
												</Table.Cell>
											</Table.Row>
										)}
									</For>
								</Table.Body>
							</Table.Root>
						</Show>
					</Suspense>
				</Card.Body>

				{/* Pagination */}
				<Show when={playlists().pagination.pages ?? 0 > 1}>
					<Card.Footer
						class={css({ borderTop: "1px solid token(colors.border.default)" })}
					>
						<Pagination.Root
							count={playlists().pagination.total || 0}
							pageSize={playlists().pagination.limit || 10}
							page={search().page as PaginationRootProps["page"]}
							onPageChange={handlePageChange}
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

			{/* Info Panel */}
			<Card.Root class={css({ mt: "6", bgColor: "bg.muted" })}>
				<Card.Header>
					<Card.Title>Information</Card.Title>
				</Card.Header>
				<Card.Body>
					<ul class={vstack({ gap: "2", color: "fg.muted", fontSize: "sm" })}>
						<li>
							• Each playlist will automatically sync according to the set
							schedule
						</li>
						<li>
							• You can edit quality and format settings for each playlist
						</li>
						<li>• Track download progress in the playlist details view</li>
						<li>• Archive old playlists to keep things clean</li>
					</ul>
				</Card.Body>
			</Card.Root>
		</>
	);
}
