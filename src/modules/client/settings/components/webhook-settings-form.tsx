import { createForm } from "@tanstack/solid-form";
import { useRouter } from "@tanstack/solid-router";
import { Index } from "solid-js";
import { css } from "styled-system/css";
import { stack, vstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Checkbox from "~/components/ui/checkbox";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { Text } from "~/components/ui/text";
import { toaster } from "~/components/ui/toast";
import {
	WebhookEventDescriptions,
	WebhookEventLabels,
	type WebhookEventType,
	WebhookEventTypes,
} from "~/modules/client/webhooks";
import {
	testWebhookServerFn,
	updateWebhookSettingsServerFn,
} from "~/modules/server/webhooks/functions";
import type { WebhookSettings } from "~/modules/server/webhooks/schema";

const WebhookEventItems = WebhookEventTypes.map((type) => ({
	value: type,
	label: WebhookEventLabels[type],
	description: WebhookEventDescriptions[type],
}));

interface WebhookSettingsFormProps {
	initialSettings: WebhookSettings;
}

export function WebhookSettingsForm(props: WebhookSettingsFormProps) {
	const router = useRouter();

	const webhookForm = createForm(() => ({
		defaultValues: {
			url: props.initialSettings.url ?? "",
			enabledEvents: props.initialSettings.enabledEvents,
		},
		onSubmit: async ({ value }) => {
			try {
				const result = await updateWebhookSettingsServerFn({
					data: {
						url: value.url,
						enabledEvents: value.enabledEvents,
					},
				});

				if (result.success) {
					toaster.success({
						title: "Settings saved",
						description: "Webhook configuration updated successfully",
					});
					router.invalidate();
				} else {
					toaster.error({
						title: "Error",
						description: result.error || "Failed to save settings",
					});
				}
			} catch (error) {
				console.error("Form submission error:", error);
				toaster.error({
					title: "Error",
					description:
						error instanceof Error ? error.message : "Failed to save settings",
				});
			}
		},
	}));

	const handleTestWebhook = async () => {
		const url = webhookForm.getFieldValue("url");
		if (!url) {
			toaster.error({
				title: "No URL",
				description: "Please enter a webhook URL first",
			});
			return;
		}

		try {
			const result = await testWebhookServerFn({ data: { url } });
			if (result.success) {
				toaster.success({
					title: "Test sent",
					description: "Check your Discord channel for the test message",
				});
			} else {
				toaster.error({
					title: "Test failed",
					description: result.error || "Failed to send test message",
				});
			}
		} catch (error) {
			toaster.error({
				title: "Error",
				description:
					error instanceof Error ? error.message : "Failed to send test",
			});
		}
	};

	return (
		<Card.Root>
			<Card.Header>
				<Card.Title>Discord Webhook</Card.Title>
				<Text class={css({ color: "fg.muted" })}>
					Receive notifications in Discord when playlists sync.
				</Text>
			</Card.Header>

			<Card.Body>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						webhookForm.handleSubmit();
					}}
					class={vstack({ gap: "6", alignItems: "stretch" })}
				>
					<webhookForm.Field name="url">
						{(field) => (
							<Field.Root>
								<Field.Label>Webhook URL</Field.Label>
								<div class={stack({ gap: "2", direction: "row" })}>
									<Input
										value={field().state.value}
										onInput={(e) => field().handleChange(e.currentTarget.value)}
										onBlur={field().handleBlur}
										placeholder="https://discord.com/api/webhooks/..."
										class={css({ flex: 1 })}
									/>
									<Button
										type="button"
										variant="outline"
										onClick={handleTestWebhook}
									>
										Test
									</Button>
								</div>
								<Field.HelperText>
									Create a webhook in your Discord server settings and paste the
									URL here
								</Field.HelperText>
							</Field.Root>
						)}
					</webhookForm.Field>

					<webhookForm.Field name="enabledEvents">
						{(field) => (
							<Field.Root>
								<Field.Label>Events</Field.Label>
								<Text
									class={css({ color: "fg.muted", fontSize: "sm", mb: "3" })}
								>
									Select which events should trigger Discord notifications
								</Text>
								<Checkbox.Group
									defaultValue={field().state.value}
									onValueChange={(value) =>
										field().handleChange(value as WebhookEventType[])
									}
									class={vstack({ gap: "3", alignItems: "stretch" })}
								>
									<Index each={WebhookEventItems}>
										{(item) => (
											<Checkbox.Root
												ids={{
													label: item().value,
													hiddenInput: item().value,
												}}
												class={css({
													display: "flex",
													alignItems: "flex-start",
													gap: "3",
													p: "3",
													borderRadius: "md",
													borderWidth: "1px",
													borderColor: "border",
													cursor: "pointer",
													_hover: {
														bg: "gray.surface.bg",
													},
												})}
											>
												<Checkbox.HiddenInput />
												<Checkbox.Control
													class={css({
														mt: "0.5",
													})}
												>
													<Checkbox.Indicator />
												</Checkbox.Control>
												<div
													class={vstack({
														gap: "0.5",
														alignItems: "flex-start",
													})}
												>
													<Checkbox.Label class={css({ fontWeight: "medium" })}>
														{item().label}
													</Checkbox.Label>
													<Text
														class={css({
															color: "fg.muted",
															fontSize: "sm",
														})}
													>
														{item().description}
													</Text>
												</div>
											</Checkbox.Root>
										)}
									</Index>
								</Checkbox.Group>
							</Field.Root>
						)}
					</webhookForm.Field>

					<webhookForm.Subscribe
						selector={(state) => ({
							isSubmitting: state.isSubmitting,
							isDirty: state.isDirty,
						})}
					>
						{(state) => (
							<div
								class={stack({
									gap: "3",
									direction: "row",
									justify: "flex-end",
								})}
							>
								<Button
									type="submit"
									variant="solid"
									disabled={state().isSubmitting || !state().isDirty}
									loading={state().isSubmitting}
								>
									{state().isSubmitting ? "Saving..." : "Save Changes"}
								</Button>
							</div>
						)}
					</webhookForm.Subscribe>
				</form>
			</Card.Body>
		</Card.Root>
	);
}
