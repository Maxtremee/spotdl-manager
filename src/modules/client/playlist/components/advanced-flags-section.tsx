import { createListCollection } from "@ark-ui/solid/select";
import { For, Show } from "solid-js";
import { stack, vstack } from "styled-system/patterns";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import * as Switch from "~/components/ui/switch";
import {
	formatOptions,
	qualityOptions,
} from "~/modules/client/playlist/service/options";

interface AdvancedFlagsSectionProps {
	// biome-ignore lint/suspicious/noExplicitAny: TanStack Form types
	form: any;
}

export function AdvancedFlagsSection(props: AdvancedFlagsSectionProps) {
	return (
		<props.form.Field name="enableAdvancedFlags">
			{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
			{(field: any) => (
				<>
					<div class={vstack({ gap: "4", alignItems: "stretch" })}>
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
							<Switch.Label>Advanced Download Options</Switch.Label>
						</Switch.Root>
					</div>

					<Show when={field().state.value}>
						<div class={stack({ gap: "4", p: "4" })}>
							<props.form.Field name="quality">
								{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
								{(qualityField: any) => (
									<Field.Root>
										<Field.Label>Audio Quality</Field.Label>
										<Select.Root
											collection={createListCollection({
												items: [...qualityOptions],
											})}
											value={[qualityField().state.value]}
											onValueChange={(details: { value: string[] }) =>
												qualityField().handleChange(details.value[0])
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
													<For each={[...qualityOptions]}>
														{(item) => (
															<Select.Item item={item}>
																<Select.ItemText>{item.label}</Select.ItemText>
															</Select.Item>
														)}
													</For>
												</Select.Content>
											</Select.Positioner>
										</Select.Root>
									</Field.Root>
								)}
							</props.form.Field>

							<props.form.Field name="format">
								{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
								{(formatField: any) => (
									<Field.Root>
										<Field.Label>File Format</Field.Label>
										<Select.Root
											collection={createListCollection({
												items: [...formatOptions],
											})}
											value={[formatField().state.value]}
											onValueChange={(details: { value: string[] }) =>
												formatField().handleChange(details.value[0])
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
													<For each={[...formatOptions]}>
														{(item) => (
															<Select.Item item={item}>
																<Select.ItemText>{item.label}</Select.ItemText>
															</Select.Item>
														)}
													</For>
												</Select.Content>
											</Select.Positioner>
										</Select.Root>
									</Field.Root>
								)}
							</props.form.Field>

							<props.form.Field name="retries">
								{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
								{(retriesField: any) => (
									<Field.Root>
										<Field.Label>Number of Retries</Field.Label>
										<Input
											type="number"
											min={0}
											max={10}
											value={retriesField().state.value}
											onInput={(e: InputEvent) =>
												retriesField().handleChange(
													Number((e.currentTarget as HTMLInputElement).value),
												)
											}
										/>
									</Field.Root>
								)}
							</props.form.Field>

							<props.form.Field name="overwrite">
								{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
								{(overwriteField: any) => (
									<Switch.Root
										checked={overwriteField().state.value}
										onCheckedChange={(details: { checked: boolean }) =>
											overwriteField().handleChange(details.checked)
										}
									>
										<Switch.HiddenInput />
										<Switch.Control>
											<Switch.Thumb />
										</Switch.Control>
										<Switch.Label>Overwrite Existing Files</Switch.Label>
									</Switch.Root>
								)}
							</props.form.Field>
						</div>
					</Show>
				</>
			)}
		</props.form.Field>
	);
}
