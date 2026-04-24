import { createForm } from "@tanstack/solid-form";
import { createFileRoute } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack, vstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";
import { toaster } from "~/components/ui/toast";
import { BasicFieldsSection } from "~/modules/client/playlist/components/basic-fields-section";
import { ScheduleSection } from "~/modules/client/playlist/components/schedule-section";
import {
	type CreatePlaylistFormData,
	CreatePlaylistFormSchema,
	formDataToPlaylistPayload,
} from "~/modules/client/playlist/schema/create-playlist-form";
import { createPlaylistServerFn } from "~/modules/server/playlist/functions";

export const Route = createFileRoute("/library_/add")({
	component: AddPlaylist,
});

function AddPlaylist() {
	const navigate = Route.useNavigate();

	// @ts-expect-error -- Solid Form types ---
	const form = createForm(() => ({
		validators: {
			onSubmit: CreatePlaylistFormSchema,
		},
		defaultValues: {
			name: "",
			sourceUrl: "",
			outputDir: "/downloads/spotify",
			enableSchedule: false,
			scheduleType: "interval" as const,
			scheduleCron: "",
			scheduleMinutes: 1440,
		} as CreatePlaylistFormData,
		onSubmit: async ({ value }) => {
			try {
				const payload = formDataToPlaylistPayload(value);
				const result = await createPlaylistServerFn({ data: payload });

				if (result.success) {
					toaster.success({
						title: "Success",
						description: "Playlist created successfully",
					});
					navigate({
						to: "/library/$playlistId",
						params: { playlistId: result.data.id ?? "" },
					});
				} else {
					toaster.error({
						title: "Error",
						description: result.error || "Failed to create playlist",
					});
				}
			} catch (error) {
				console.error("Form submission error:", error);
				toaster.error({
					title: "Validation Error",
					description: error instanceof Error ? error.message : "Invalid data",
				});
			}
		},
	}));

	const handleCancel = () => {
		navigate({ to: "/library" });
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
					Add New Playlist
				</Text>
				<Text class={css({ color: "fg.subtle" })}>
					Create a new playlist to start downloading tracks from Spotify.
				</Text>
			</header>

			<Card.Root>
				<Card.Header>
					<Card.Title>Playlist Details</Card.Title>
				</Card.Header>

				<Card.Body>
					<form
						onSubmit={(e) => {
							e.preventDefault();
							form.handleSubmit();
						}}
						class={vstack({ gap: "6", alignItems: "stretch" })}
					>
						<BasicFieldsSection form={form} />
						<ScheduleSection form={form} />

						<form.Subscribe
							selector={(state) => ({
								isSubmitting: state.isSubmitting,
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
										type="button"
										variant="outline"
										onClick={handleCancel}
										disabled={state().isSubmitting}
									>
										Cancel
									</Button>
									<Button
										type="submit"
										variant="solid"
										disabled={state().isSubmitting}
										loading={state().isSubmitting}
									>
										{state().isSubmitting ? "Creating..." : "Create Playlist"}
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
