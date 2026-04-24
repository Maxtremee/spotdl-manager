import { Link } from "@tanstack/solid-router";
import { For } from "solid-js";
import { css } from "styled-system/css";
import { Badge } from "~/components/ui/badge";
import * as Table from "~/components/ui/table";
import type { Playlist } from "~/modules/client/playlist/schema/playlist";
import { PlaylistService } from "~/modules/client/playlist/service/playlist";

interface PlaylistItem {
	id?: string;
	name: string;
	source: Playlist["source"];
	status: Playlist["status"];
	outputDir: string;
	updatedAt?: Date;
}

interface PlaylistTableProps {
	items: PlaylistItem[];
}

export function PlaylistTable(props: PlaylistTableProps) {
	return (
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
				</Table.Row>
			</Table.Head>
			<Table.Body>
				<For each={props.items}>
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
									{PlaylistService.formatSourceType(playlist.source.type)}
								</Badge>
							</Table.Cell>
							<Table.Cell>
								<Badge>{PlaylistService.formatStatus(playlist.status)}</Badge>
							</Table.Cell>
							<Table.Cell class={css({ fontSize: "sm", color: "fg.muted" })}>
								{PlaylistService.truncateText(playlist.outputDir, 30)}
							</Table.Cell>
							<Table.Cell class={css({ fontSize: "sm", color: "fg.muted" })}>
								{playlist.updatedAt
									? PlaylistService.formatDate(playlist.updatedAt)
									: "N/A"}
							</Table.Cell>
						</Table.Row>
					)}
				</For>
			</Table.Body>
		</Table.Root>
	);
}
