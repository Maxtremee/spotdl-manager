import { Link } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { vstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import { Text } from "~/components/ui/text";

export function EmptyPlaylistsState() {
	return (
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
				No playlists found. Create a new playlist to start downloading songs
				from Spotify.
			</Text>
			<Link to="/library/add">
				<Button variant="solid" class={css({ mt: "4" })}>
					+ Add playlist
				</Button>
			</Link>
		</div>
	);
}
