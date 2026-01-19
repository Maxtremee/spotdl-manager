import { createForm } from "@tanstack/solid-form";
import { useRouter } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack, vstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import * as Switch from "~/components/ui/switch";
import { Text } from "~/components/ui/text";
import { toaster } from "~/components/ui/toast";
import { updateSpotdlSettingsServerFn } from "~/modules/server/spotdl/functions";
import type { SpotdlSettings } from "~/modules/server/spotdl/schema";

interface CookiesSettingsFormProps {
	initialSettings: SpotdlSettings;
}

export function CookiesSettingsForm(props: CookiesSettingsFormProps) {
	const router = useRouter();

	const cookiesForm = createForm(() => ({
		defaultValues: {
			useCookies: props.initialSettings.useCookies ?? false,
		},
		onSubmit: async ({ value }) => {
			try {
				const result = await updateSpotdlSettingsServerFn({
					data: {
						useCookies: value.useCookies,
					},
				});

				if (result.success) {
					toaster.success({
						title: "Settings saved",
						description: "Cookies configuration updated successfully",
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

	return (
		<Card.Root>
			<Card.Header>
				<Card.Title>Spotdl Cookies</Card.Title>
				<Text class={css({ color: "fg.muted" })}>
					Enable cookies to download in better quality. The cookies file path
					must be set via the SPOTDL_COOKIES_FILE environment variable.
				</Text>
			</Card.Header>

			<Card.Body>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						cookiesForm.handleSubmit();
					}}
					class={vstack({ gap: "6", alignItems: "stretch" })}
				>
					<cookiesForm.Field name="useCookies">
						{(field) => (
							<Field.Root>
								<Switch.Root
									checked={field().state.value}
									onCheckedChange={(details: { checked: boolean }) =>
										field().handleChange(details.checked)
									}
								>
									<Switch.HiddenInput />
									<Switch.Control>
										<Switch.Thumb />
									</Switch.Control>
									<Switch.Label>Use Cookies File</Switch.Label>
								</Switch.Root>
								<Field.HelperText>
									When enabled, spotdl will use the cookies file specified in
									the SPOTDL_COOKIES_FILE environment variable. Export cookies
									from your browser (e.g., using "Get cookies.txt LOCALLY"
									extension), save it to your server, and set the environment
									variable to its path.
								</Field.HelperText>
							</Field.Root>
						)}
					</cookiesForm.Field>

					<cookiesForm.Subscribe
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
					</cookiesForm.Subscribe>
				</form>
			</Card.Body>
		</Card.Root>
	);
}
