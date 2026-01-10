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
import type { Playlist } from "~/modules/client/playlist/schema/playlist";

const statusOptions = createListCollection<{
	label: string;
	value: Playlist["status"];
}>({
	items: [
		{ label: "Active", value: "active" },
		{ label: "Paused", value: "paused" },
		{ label: "Archived", value: "archived" },
		{ label: "Error", value: "error" },
	],
});

export interface LibraryFiltersValue {
	search: string;
	status: Playlist["status"] | undefined;
}

export interface LibraryFiltersProps {
	defaultSearch: string;
	defaultStatus: Playlist["status"] | undefined;
	onSubmit: (value: LibraryFiltersValue) => void;
}

export function LibraryFilters(props: LibraryFiltersProps) {
	const form = createForm(() => ({
		defaultValues: {
			search: props.defaultSearch,
			status: props.defaultStatus,
		},
		onSubmit: ({ value }) => {
			props.onSubmit(value);
		},
	}));

	return (
		<Card.Root class={css({ mb: "6" })}>
			<Card.Header>
				<Card.Title>Filters and search</Card.Title>
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
						{/* Search input */}
						<form.Field name="search">
							{(field) => (
								<Fieldset.Root class={css({ flex: 1, minW: "250px" })}>
									<Fieldset.Legend
										class={css({ fontSize: "sm", fontWeight: "500" })}
									>
										Search
									</Fieldset.Legend>
									<InputGroup>
										<Input
											type="text"
											id={field().name}
											name={field().name}
											placeholder="Search playlist..."
											value={field().state.value}
											onInput={(e) =>
												field().handleChange(e.currentTarget.value)
											}
										/>
									</InputGroup>
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
											field().handleChange(
												details.value[0] as Playlist["status"] | undefined,
											);
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

						{/* Action button */}
						<div class={hstack({ gap: "2", alignSelf: "flex-end" })}>
							<Button type="submit" variant="solid" class={css({ mt: "auto" })}>
								Search
							</Button>
						</div>
					</div>
				</form>
			</Card.Body>
		</Card.Root>
	);
}
