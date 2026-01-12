import { createListCollection } from "@ark-ui/solid/select";
import { createForm } from "@tanstack/solid-form";
import { createFileRoute } from "@tanstack/solid-router";
import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { stack, vstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import * as Switch from "~/components/ui/switch";
import { Text } from "~/components/ui/text";
import { toaster } from "~/components/ui/toast";
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
			enableAdvancedFlags: false,
			overwrite: false,
			retries: 3,
			quality: "high" as const,
			format: "mp3" as const,
			enableSchedule: false,
			scheduleType: "interval" as const,
			scheduleCron: "",
			scheduleMinutes: 1440,
		} as CreatePlaylistFormData,
		onSubmit: async ({ value }) => {
			try {
				// Transform to playlist payload
				const payload = formDataToPlaylistPayload(value);
				// Call server function
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

	const qualityOptions = [
		{ label: "Worst", value: "worst" },
		{ label: "Low", value: "low" },
		{ label: "Medium", value: "medium" },
		{ label: "High", value: "high" },
		{ label: "Very High", value: "very_high" },
		{ label: "Lossless", value: "lossless" },
	];

	const formatOptions = [
		{ label: "MP3", value: "mp3" },
		{ label: "FLAC", value: "flac" },
		{ label: "OGG", value: "ogg" },
		{ label: "M4A", value: "m4a" },
		{ label: "Opus", value: "opus" },
		{ label: "Vorbis", value: "vorbis" },
		{ label: "WAV", value: "wav" },
	];

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
						{/* Basic Fields */}
						<form.Field name="name">
							{(field) => (
								<Field.Root invalid={!!field().state.meta.errors.length}>
									<Field.Label>Playlist Name</Field.Label>
									<Input
										value={field().state.value}
										onInput={(e) => field().handleChange(e.currentTarget.value)}
										onBlur={field().handleBlur}
										placeholder="My Playlist"
									/>
									<Show when={field().state.meta.errors.length > 0}>
										<Field.ErrorText>
											{field().state.meta.errors[0]}
										</Field.ErrorText>
									</Show>
								</Field.Root>
							)}
						</form.Field>

						<form.Field name="sourceUrl">
							{(field) => (
								<Field.Root invalid={!!field().state.meta.errors.length}>
									<Field.Label>Spotify URL</Field.Label>
									<Input
										value={field().state.value}
										onInput={(e) => field().handleChange(e.currentTarget.value)}
										onBlur={field().handleBlur}
										placeholder="https://open.spotify.com/playlist/..."
									/>
									<Field.HelperText>
										Paste a link to a playlist, album, or track from Spotify
									</Field.HelperText>
									<Show when={field().state.meta.errors.length > 0}>
										<Field.ErrorText>
											{field().state.meta.errors[0]}
										</Field.ErrorText>
									</Show>
								</Field.Root>
							)}
						</form.Field>

						<form.Field name="outputDir">
							{(field) => (
								<Field.Root invalid={!!field().state.meta.errors.length}>
									<Field.Label>Output Directory</Field.Label>
									<Input
										value={field().state.value}
										onInput={(e) => field().handleChange(e.currentTarget.value)}
										onBlur={field().handleBlur}
										placeholder="/downloads/spotify"
									/>
									<Field.HelperText>
										Path to the folder where downloaded files will be saved
									</Field.HelperText>
									<Show when={field().state.meta.errors.length > 0}>
										<Field.ErrorText>
											{field().state.meta.errors[0]}
										</Field.ErrorText>
									</Show>
								</Field.Root>
							)}
						</form.Field>

						{/* Advanced Flags Section */}
						<form.Field name="enableAdvancedFlags">
							{(field) => (
								<>
									<div class={vstack({ gap: "4", alignItems: "stretch" })}>
										<Switch.Root
											checked={field().state.value}
											onCheckedChange={(details) =>
												field().handleChange(details.checked)
											}
										>
											<Switch.HiddenInput />
											<Switch.Control>
												<Switch.Thumb />
											</Switch.Control>
											<Switch.Label>Advanced Download Options</Switch.Label>
										</Switch.Root>
									</div>

									<Show when={field().state.value}>
										<div
											class={stack({
												gap: "4",
												p: "4",
											})}
										>
											<form.Field name="quality">
												{(field) => (
													<Field.Root>
														<Field.Label>Audio Quality</Field.Label>
														<Select.Root
															collection={createListCollection({
																items: qualityOptions,
															})}
															value={[field().state.value]}
															onValueChange={(details) =>
																field().handleChange(
																	details.value[0] as
																		| "worst"
																		| "low"
																		| "medium"
																		| "high"
																		| "very_high"
																		| "lossless",
																)
															}
															positioning={{ sameWidth: true }}
														>
															<Select.Control>
																<Select.Trigger>
																	<Select.ValueText placeholder="Select quality" />
																</Select.Trigger>
															</Select.Control>
															<Select.Positioner>
																<Select.Content>
																	<For each={qualityOptions}>
																		{(item) => (
																			<Select.Item item={item}>
																				<Select.ItemText>
																					{item.label}
																				</Select.ItemText>
																			</Select.Item>
																		)}
																	</For>
																</Select.Content>
															</Select.Positioner>
														</Select.Root>
													</Field.Root>
												)}
											</form.Field>

											<form.Field name="format">
												{(field) => (
													<Field.Root>
														<Field.Label>File Format</Field.Label>
														<Select.Root
															collection={createListCollection({
																items: formatOptions,
															})}
															value={[field().state.value]}
															onValueChange={(details) =>
																field().handleChange(
																	details.value[0] as
																		| "mp3"
																		| "flac"
																		| "ogg"
																		| "m4a"
																		| "opus"
																		| "vorbis"
																		| "wav",
																)
															}
															positioning={{ sameWidth: true }}
														>
															<Select.Control>
																<Select.Trigger>
																	<Select.ValueText placeholder="Select format" />
																</Select.Trigger>
															</Select.Control>
															<Select.Positioner>
																<Select.Content>
																	<For each={formatOptions}>
																		{(item) => (
																			<Select.Item item={item}>
																				<Select.ItemText>
																					{item.label}
																				</Select.ItemText>
																			</Select.Item>
																		)}
																	</For>
																</Select.Content>
															</Select.Positioner>
														</Select.Root>
													</Field.Root>
												)}
											</form.Field>

											<form.Field name="retries">
												{(field) => (
													<Field.Root>
														<Field.Label>Number of Retries</Field.Label>
														<Input
															type="number"
															min={0}
															max={10}
															value={field().state.value}
															onInput={(e) =>
																field().handleChange(
																	Number(e.currentTarget.value),
																)
															}
														/>
													</Field.Root>
												)}
											</form.Field>

											<form.Field name="overwrite">
												{(field) => (
													<Switch.Root
														checked={field().state.value}
														onCheckedChange={(details) =>
															field().handleChange(details.checked)
														}
													>
														<Switch.HiddenInput />
														<Switch.Control>
															<Switch.Thumb />
														</Switch.Control>
														<Switch.Label>
															Overwrite Existing Files
														</Switch.Label>
													</Switch.Root>
												)}
											</form.Field>
										</div>
									</Show>
								</>
							)}
						</form.Field>

						{/* Schedule Section */}
						<form.Field name="enableSchedule">
							{(field) => (
								<>
									<div class={vstack({ gap: "4", alignItems: "stretch" })}>
										<Switch.Root
											checked={field().state.value}
											onCheckedChange={(details) =>
												field().handleChange(details.checked)
											}
										>
											<Switch.HiddenInput />
											<Switch.Control>
												<Switch.Thumb />
											</Switch.Control>
											<Switch.Label>Automatic Schedules</Switch.Label>
										</Switch.Root>
									</div>
									<Show when={field().state.value}>
										<div
											class={stack({
												gap: "4",
												p: "4",
											})}
										>
											<form.Field name="scheduleType">
												{(field) => (
													<>
														<Field.Root>
															<Field.Label>Schedule Type</Field.Label>
															<Select.Root
																collection={createListCollection({
																	items: [
																		{
																			label: "Time Interval",
																			value: "interval",
																		},
																		{ label: "Cron Expression", value: "cron" },
																	],
																})}
																value={[field().state.value]}
																onValueChange={(details) =>
																	field().handleChange(
																		details.value[0] as "interval" | "cron",
																	)
																}
																positioning={{ sameWidth: true }}
															>
																<Select.Control>
																	<Select.Trigger>
																		<Select.ValueText placeholder="Choose type" />
																	</Select.Trigger>
																</Select.Control>
																<Select.Positioner>
																	<Select.Content>
																		<Select.Item
																			item={{
																				label: "Time Interval",
																				value: "interval",
																			}}
																		>
																			<Select.ItemText>
																				Time Interval
																			</Select.ItemText>
																		</Select.Item>
																		<Select.Item
																			item={{
																				label: "Cron Expression",
																				value: "cron",
																			}}
																		>
																			<Select.ItemText>
																				Cron Expression
																			</Select.ItemText>
																		</Select.Item>
																	</Select.Content>
																</Select.Positioner>
															</Select.Root>
														</Field.Root>
														<Show when={field().state.value === "interval"}>
															<form.Field name="scheduleMinutes">
																{(field) => (
																	<Field.Root>
																		<Field.Label>
																			Interval (in minutes)
																		</Field.Label>
																		<Input
																			type="number"
																			min={1}
																			max={43200}
																			value={field().state.value}
																			onInput={(e) =>
																				field().handleChange(
																					Number(e.currentTarget.value),
																				)
																			}
																		/>
																		<Field.HelperText>
																			1440 minutes = 24 hours (daily)
																		</Field.HelperText>
																	</Field.Root>
																)}
															</form.Field>
														</Show>

														<Show when={field().state.value === "cron"}>
															<form.Field name="scheduleCron">
																{(field) => (
																	<Field.Root
																		invalid={!!field().state.meta.errors.length}
																	>
																		<Field.Label>Cron Expression</Field.Label>
																		<Input
																			value={field().state.value}
																			onInput={(e) =>
																				field().handleChange(
																					e.currentTarget.value,
																				)
																			}
																			placeholder="0 0 * * *"
																		/>
																		<Field.HelperText>
																			Example: "0 0 * * *" = every day at
																			midnight
																		</Field.HelperText>
																		<Show
																			when={
																				field().state.meta.errors.length > 0
																			}
																		>
																			<Field.ErrorText>
																				{field().state.meta.errors[0]}
																			</Field.ErrorText>
																		</Show>
																	</Field.Root>
																)}
															</form.Field>
														</Show>
													</>
												)}
											</form.Field>
										</div>
									</Show>
								</>
							)}
						</form.Field>

						{/* Submit */}
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
