import { createFileRoute } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";

export const Route = createFileRoute("/settings")({ component: Settings });

function Settings() {
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
					Settings
				</Text>
				<Text class={css({ color: "fg.subtle" })}>
					Control output paths, formats, and service tokens.
				</Text>
			</header>
			<Card.Root>
				<Card.Header>
					<Card.Title>Preferences</Card.Title>
					<Text class={css({ color: "fg.muted" })}>
						Configure defaults for spotDL, manage auth, and tune conversion
						options.
					</Text>
				</Card.Header>
				<Card.Body>
					<Text class={css({ color: "fg.subtle" })}>
						Coming soon: environment validation, token management, and output
						presets.
					</Text>
				</Card.Body>
			</Card.Root>
		</>
	);
}
