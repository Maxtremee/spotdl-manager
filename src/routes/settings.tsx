import { createForm } from "@tanstack/solid-form";
import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { For, Index } from "solid-js";
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
	getWebhookSettingsServerFn,
	testWebhookServerFn,
	updateWebhookSettingsServerFn,
} from "~/modules/server/webhooks/functions";

const WebhookEventItems = WebhookEventTypes.map((type) => ({
	value: type,
	label: WebhookEventLabels[type],
	description: WebhookEventDescriptions[type],
}));

export const Route = createFileRoute("/settings")({
	loader: () => getWebhookSettingsServerFn(),
	component: Settings,
});

function Settings() {
	const settings = Route.useLoaderData();
	const router = useRouter();

	const form = createForm(() => ({
		defaultValues: {
			url: settings().url ?? "",
			enabledEvents: settings().enabledEvents,
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
		const url = form.getFieldValue("url");
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
							form.handleSubmit();
						}}
						class={vstack({ gap: "6", alignItems: "stretch" })}
					>
						<form.Field name="url">
							{(field) => (
								<Field.Root>
									<Field.Label>Webhook URL</Field.Label>
									<div class={stack({ gap: "2", direction: "row" })}>
										<Input
											value={field().state.value}
											onInput={(e) =>
												field().handleChange(e.currentTarget.value)
											}
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
										Create a webhook in your Discord server settings and paste
										the URL here
									</Field.HelperText>
								</Field.Root>
							)}
						</form.Field>

						<form.Field name="enabledEvents">
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
														<Checkbox.Label
															class={css({ fontWeight: "medium" })}
														>
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
						</form.Field>

						<form.Subscribe
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
						</form.Subscribe>
					</form>
				</Card.Body>
			</Card.Root>
		</>
	);
}

interface EventCheckboxProps {
	eventType: WebhookEventType;
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
}

function EventCheckbox(props: EventCheckboxProps) {
	return (
		<Checkbox.Root
			ids={{
				label: props.eventType,
				hiddenInput: props.eventType,
			}}
			checked={props.checked}
			onCheckedChange={(details) =>
				props.onCheckedChange(details.checked === true)
			}
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
			<div class={vstack({ gap: "0.5", alignItems: "flex-start" })}>
				<Checkbox.Label class={css({ fontWeight: "medium" })}>
					{WebhookEventLabels[props.eventType]}
				</Checkbox.Label>
				<Text class={css({ color: "fg.muted", fontSize: "sm" })}>
					{WebhookEventDescriptions[props.eventType]}
				</Text>
			</div>
		</Checkbox.Root>
	);
}
