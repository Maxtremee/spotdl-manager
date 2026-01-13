import { createListCollection } from "@ark-ui/solid/select";
import { Show } from "solid-js";
import { stack, vstack } from "styled-system/patterns";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import * as Select from "~/components/ui/select";
import * as Switch from "~/components/ui/switch";

interface ScheduleSectionProps {
	// biome-ignore lint/suspicious/noExplicitAny: TanStack Form types
	form: any;
}

const scheduleTypeOptions = [
	{ label: "Time Interval", value: "interval" },
	{ label: "Cron Expression", value: "cron" },
];

export function ScheduleSection(props: ScheduleSectionProps) {
	return (
		<props.form.Field name="enableSchedule">
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
							<Switch.Label>Automatic Schedules</Switch.Label>
						</Switch.Root>
					</div>
					<Show when={field().state.value}>
						<div class={stack({ gap: "4", p: "4" })}>
							<props.form.Field name="scheduleType">
								{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
								{(typeField: any) => (
									<>
										<Field.Root>
											<Field.Label>Schedule Type</Field.Label>
											<Select.Root
												collection={createListCollection({
													items: scheduleTypeOptions,
												})}
												value={[typeField().state.value]}
												onValueChange={(details: { value: string[] }) =>
													typeField().handleChange(details.value[0])
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
														<Select.Item item={scheduleTypeOptions[0]}>
															<Select.ItemText>Time Interval</Select.ItemText>
														</Select.Item>
														<Select.Item item={scheduleTypeOptions[1]}>
															<Select.ItemText>Cron Expression</Select.ItemText>
														</Select.Item>
													</Select.Content>
												</Select.Positioner>
											</Select.Root>
										</Field.Root>
										<Show when={typeField().state.value === "interval"}>
											<props.form.Field name="scheduleMinutes">
												{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
												{(minutesField: any) => (
													<Field.Root>
														<Field.Label>Interval (in minutes)</Field.Label>
														<Input
															type="number"
															min={1}
															max={43200}
															value={minutesField().state.value}
															onInput={(e: InputEvent) =>
																minutesField().handleChange(
																	Number(
																		(e.currentTarget as HTMLInputElement).value,
																	),
																)
															}
														/>
														<Field.HelperText>
															1440 minutes = 24 hours (daily)
														</Field.HelperText>
													</Field.Root>
												)}
											</props.form.Field>
										</Show>

										<Show when={typeField().state.value === "cron"}>
											<props.form.Field name="scheduleCron">
												{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
												{(cronField: any) => (
													<Field.Root
														invalid={!!cronField().state.meta.errors.length}
													>
														<Field.Label>Cron Expression</Field.Label>
														<Input
															value={cronField().state.value}
															onInput={(e: InputEvent) =>
																cronField().handleChange(
																	(e.currentTarget as HTMLInputElement).value,
																)
															}
															placeholder="0 0 * * *"
														/>
														<Field.HelperText>
															Example: "0 0 * * *" = every day at midnight
														</Field.HelperText>
														<Show
															when={cronField().state.meta.errors.length > 0}
														>
															<Field.ErrorText>
																{cronField().state.meta.errors[0]}
															</Field.ErrorText>
														</Show>
													</Field.Root>
												)}
											</props.form.Field>
										</Show>
									</>
								)}
							</props.form.Field>
						</div>
					</Show>
				</>
			)}
		</props.form.Field>
	);
}
