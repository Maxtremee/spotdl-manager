import { createFileRoute } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import { Text } from "~/components/ui/text";
import { WebhookSettingsForm } from "~/modules/client/settings";
import { getWebhookSettingsServerFn } from "~/modules/server/webhooks/functions";

export const Route = createFileRoute("/settings")({
	loader: async () => {
		const webhookSettings = await getWebhookSettingsServerFn();
		return { webhookSettings };
	},
	component: Settings,
});

function Settings() {
	const data = Route.useLoaderData();

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
					Configure notifications and integrations.
				</Text>
			</header>

			<WebhookSettingsForm initialSettings={data().webhookSettings} />
		</>
	);
}
