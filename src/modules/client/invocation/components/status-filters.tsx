import { createListCollection } from "@ark-ui/solid";
import { createForm } from "@tanstack/solid-form";
import { For } from "solid-js";
import { css } from "styled-system/css";
import { hstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import * as Fieldset from "~/components/ui/fieldset";
import { Input } from "~/components/ui/input";
import { InputGroup } from "~/components/ui/input-group";
import * as Select from "~/components/ui/select";

const windowOptions = createListCollection({
	items: [
		{ label: "Last 24h", value: "24h" },
		{ label: "Last 7 days", value: "7d" },
		{ label: "Last 30 days", value: "30d" },
		{ label: "All time", value: "all" },
	],
});

const statusOptions = createListCollection({
	items: [
		{ label: "Running", value: "running" },
		{ label: "Success", value: "success" },
		{ label: "Failed", value: "failed" },
		{ label: "Canceled", value: "canceled" },
	],
});

export interface StatusFiltersValue {
	window: "24h" | "7d" | "30d" | "all";
	status: "running" | "success" | "failed" | "canceled" | undefined;
	playlistId: string | undefined;
}

export interface StatusFiltersProps {
	defaultWindow: "24h" | "7d" | "30d" | "all";
	defaultStatus: "running" | "success" | "failed" | "canceled" | undefined;
	defaultPlaylistId: string | undefined;
	onSubmit: (value: StatusFiltersValue) => void;
}

export function StatusFilters(props: StatusFiltersProps) {
	const form = createForm(() => ({
		defaultValues: {
			window: props.defaultWindow,
			status: props.defaultStatus,
			playlistId: props.defaultPlaylistId || "",
		},
		onSubmit: ({ value }) => {
			props.onSubmit({
				window: value.window,
				status: value.status,
				playlistId: value.playlistId || undefined,
			});
		},
	}));

	return (
		<Card.Root class={css({ mb: "6" })}>
			<Card.Header>
				<Card.Title>Filters</Card.Title>
			</Card.Header>
			<Card.Body>
				<form
					onSubmit={(e) => {
						e.preventDefault();
						e.stopPropagation();
						form.handleSubmit();
					}}
				>
					<div class={hstack({ gap: "4", flexWrap: "wrap" })}>
						{/* Window filter */}
						<form.Field name="window">
							{(field) => (
								<Fieldset.Root class={css({ flex: 1, minW: "200px" })}>
									<Fieldset.Legend
										class={css({ fontSize: "sm", fontWeight: "500" })}
									>
										Window
									</Fieldset.Legend>
									<Select.Root
										collection={windowOptions}
										value={[field().state.value]}
										onValueChange={(details) => {
											field().handleChange(details.value[0] as any);
										}}
									>
										<Select.Control>
											<Select.Trigger>
												<Select.ValueText />
												<Select.Indicator />
											</Select.Trigger>
										</Select.Control>
										<Select.Positioner>
											<Select.Content>
												<Select.List>
													<For each={windowOptions.items}>
														{(option) => (
															<Select.Item item={option}>
																<Select.ItemText>
																	{option.label}
																</Select.ItemText>
															</Select.Item>
														)}
													</For>
												</Select.List>
											</Select.Content>
										</Select.Positioner>
									</Select.Root>
								</Fieldset.Root>
							)}
						</form.Field>

						{/* Status filter */}
						<form.Field name="status">
							{(field) => (
								<Fieldset.Root class={css({ flex: 1, minW: "200px" })}>
									<Fieldset.Legend
										class={css({ fontSize: "sm", fontWeight: "500" })}
									>
										Status
									</Fieldset.Legend>
									<Select.Root
										collection={statusOptions}
										value={
											field().state.value ? [field().state.value as string] : []
										}
										onValueChange={(details) => {
											field().handleChange(details.value[0] as any);
										}}
									>
										<Select.Control>
											<Select.Trigger>
												<Select.ValueText placeholder="All statuses" />
												<Select.Indicator />
											</Select.Trigger>
										</Select.Control>
										<Select.Positioner>
											<Select.Content>
												<Select.List>
													<For each={statusOptions.items}>
														{(option) => (
															<Select.Item item={option}>
																<Select.ItemText>
																	{option.label}
																</Select.ItemText>
															</Select.Item>
														)}
													</For>
												</Select.List>
											</Select.Content>
										</Select.Positioner>
									</Select.Root>
								</Fieldset.Root>
							)}
						</form.Field>

						{/* Playlist ID input */}
						<form.Field name="playlistId">
							{(field) => (
								<Fieldset.Root class={css({ flex: 1, minW: "250px" })}>
									<Fieldset.Legend
										class={css({ fontSize: "sm", fontWeight: "500" })}
									>
										Playlist ID
									</Fieldset.Legend>
									<InputGroup>
										<Input
											type="text"
											id={field().name}
											name={field().name}
											placeholder="Optional"
											value={field().state.value}
											onInput={(e) =>
												field().handleChange(e.currentTarget.value)
											}
										/>
									</InputGroup>
								</Fieldset.Root>
							)}
						</form.Field>

						{/* Action button */}
						<div class={hstack({ gap: "2", alignSelf: "flex-end" })}>
							<Button type="submit" variant="solid" class={css({ mt: "auto" })}>
								Apply
							</Button>
						</div>
					</div>
				</form>
			</Card.Body>
		</Card.Root>
	);
}
