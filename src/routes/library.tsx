import { createFileRoute, Link } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack } from "styled-system/patterns";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import type { RootProps as PaginationRootProps } from "~/components/ui/pagination";
import * as Pagination from "~/components/ui/pagination";
import { Text } from "~/components/ui/text";
import { EmptyPlaylistsState } from "~/modules/client/library/components/empty-playlists-state";
import {
	LibraryFilters,
	type LibraryFiltersValue,
} from "~/modules/client/library/components/library-filters";
import { LibraryInfoPanel } from "~/modules/client/library/components/library-info-panel";
import { PlaylistTable } from "~/modules/client/library/components/playlist-table";
import { listPlaylistsServerFn } from "~/modules/server/playlist/functions";

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
			search: (prev) => ({ ...prev, page: details.page }),
		});
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
						fallback={<EmptyPlaylistsState />}
					>
						<PlaylistTable items={playlists().items || []} />
					</Show>
				</Card.Body>

				<Show when={(playlists().pagination.pages ?? 0) > 1}>
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

			<LibraryInfoPanel />
		</>
	);
}
