import { createFileRoute } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";

export const Route = createFileRoute("/library")({ component: Library });

function Library() {
	return (
		<>
			<header class={stack({ gap: "2" })}>
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
			<Card.Root>
				<Card.Header>
					<Card.Title>Your Library</Card.Title>
					<Text class={css({ color: "fg.muted" })}>
						Find songs, tweak tags, and export playlists for your players.
					</Text>
				</Card.Header>
				<Card.Body>
					<Text class={css({ color: "fg.subtle" })}>
						Coming soon: filters, search, and bulk actions.
					</Text>
				</Card.Body>
			</Card.Root>
		</>
	);
}
