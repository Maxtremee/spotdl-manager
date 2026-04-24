import { Link } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { hstack, stack } from "styled-system/patterns";
import { Badge } from "~/components/ui/badge";
import * as Breadcrumb from "~/components/ui/breadcrumb";
import { Text } from "~/components/ui/text";
import type { Playlist } from "~/modules/client/playlist/schema/playlist";
import { PlaylistService } from "~/modules/client/playlist/service/playlist";

interface PlaylistHeaderProps {
	name: string;
	sourceType: Playlist["source"]["type"];
	status: Playlist["status"];
}

export function PlaylistHeader(props: PlaylistHeaderProps) {
	return (
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
							{props.name}
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
				{props.name}
			</Text>
			<div class={hstack({ gap: "2" })}>
				<Badge>{PlaylistService.formatSourceType(props.sourceType)}</Badge>
				<Badge>{PlaylistService.formatStatus(props.status)}</Badge>
			</div>
		</header>
	);
}
