import { createFileRoute, Link } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack, vstack } from "styled-system/patterns";
import { z } from "zod";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import * as Table from "~/components/ui/table";
import { Text } from "~/components/ui/text";
import {
	LibraryFilters,
	type LibraryFiltersValue,
} from "~/modules/client/library/components/library-filters";
import { PlaylistService } from "~/modules/client/playlist/service/playlist";
import { listPlaylistsServerFn } from "~/modules/server/playlist/functions";

// Define search params schema with Zod
const playlistSearchSchema = z.object({
	page: fallback(z.int().positive(), 1).default(1),
	search: fallback(z.string(), "").default(""),
	status: fallback(
		z.enum(["active", "paused", "archived", "error"]).optional(),
		undefined,
	).default(undefined),
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

	const handleFilterSubmit = (value: LibraryFiltersValue) => {
		navigate({
			search: (prev) => ({
				...prev,
				page: 1,
				search: value.search,
				status: value.status,
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

			<LibraryFilters
				defaultSearch={search().search}
				defaultStatus={search().status}
				onSubmit={handleFilterSubmit}
			/>

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
						<Link to="/library/add">
							<Button variant="solid">+ New playlist</Button>
						</Link>
					</div>
				</Card.Header>

				<Card.Body class={css({ overflow: "auto" })}>
					<Show
						when={playlists() && playlists().items.length > 0}
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
									No playlists
								</Text>
								<Text
									class={css({
										color: "fg.muted",
										maxW: "md",
										textAlign: "center",
									})}
								>
									No playlists found. Create a new playlist to start downloading
									songs from Spotify.
								</Text>
								<Link to="/library/add">
									<Button variant="solid" class={css({ mt: "4" })}>
										+ Add playlist
									</Button>
								</Link>
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
												transition: "colors 200ms",
											})}
										>
											<Table.Cell class={css({ fontWeight: "500" })}>
												<Link
													to="/library/$playlistId"
													params={{ playlistId: playlist.id ?? "" }}
													class={css({
														color: "fg.default",
														textDecoration: "none",
														"&:hover": { textDecoration: "underline" },
													})}
												>
													{PlaylistService.truncateText(playlist.name, 40)}
												</Link>
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
													<Link
														to="/library/$playlistId"
														params={{ playlistId: playlist.id ?? "" }}
													>
														<Button
															size="sm"
															variant="outline"
															class={css({ fontSize: "xs" })}
														>
															View
														</Button>
													</Link>
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
					<ul class={stack({ gap: "2", color: "fg.muted", fontSize: "sm" })}>
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
