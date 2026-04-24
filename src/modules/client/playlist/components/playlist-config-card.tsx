import { createListCollection } from "@ark-ui/solid/select";
import type { Accessor, JSX } from "solid-js";
import { For, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, vstack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";
import * as Field from "~/components/ui/field";
import { Link as UILink } from "~/components/ui/link";
import * as Select from "~/components/ui/select";
import { Text } from "~/components/ui/text";
import { statusOptions } from "~/modules/client/playlist/service/options";

interface PlaylistSchedule {
	enabled: boolean;
	schedule:
		| { type: "cron"; cron: string }
		| { type: "interval"; minutes: number };
}

interface PlaylistConfigCardProps {
	sourceUrl: string;
	outputDir: string;
	schedule: PlaylistSchedule | null;
	status: string;
	isUpdating: Accessor<boolean>;
	onStatusChange: (status: string) => void;
	deleteDialog: JSX.Element;
}

export function PlaylistConfigCard(props: PlaylistConfigCardProps) {
	return (
		<Card.Root class={css({ mb: "6" })}>
			<Card.Header>
				<div class={hstack({ justify: "space-between", w: "full" })}>
					<Card.Title>Playlist Configuration</Card.Title>
					<div class={hstack({ gap: "2" })}>{props.deleteDialog}</div>
				</div>
			</Card.Header>
			<Card.Body>
				<div
					class={css({
						display: "grid",
						gridTemplateColumns: { base: "1fr", md: "repeat(2, 1fr)" },
						gap: "6",
					})}
				>
					{/* Left column - Info */}
					<div class={vstack({ gap: "4", alignItems: "stretch" })}>
						<Field.Root>
							<Field.Label>Source URL</Field.Label>
							<UILink
								class={css({
									fontSize: "sm",
									color: "fg.muted",
									wordBreak: "break-all",
								})}
								href={props.sourceUrl}
								target="_blank"
								rel="noopener noreferrer"
							>
								{props.sourceUrl}
							</UILink>
						</Field.Root>

						<Field.Root>
							<Field.Label>Output Directory</Field.Label>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								{props.outputDir}
							</Text>
						</Field.Root>

						<Field.Root>
							<Field.Label>Schedule</Field.Label>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								<Show when={props.schedule?.enabled} fallback="Disabled">
									{props.schedule?.schedule.type === "cron"
										? `Cron: ${(props.schedule?.schedule as { type: "cron"; cron: string }).cron}`
										: `Every ${(props.schedule?.schedule as { type: "interval"; minutes: number }).minutes} minutes`}
								</Show>
							</Text>
						</Field.Root>
					</div>

					{/* Right column - Controls */}
					<div class={vstack({ gap: "4", alignItems: "stretch" })}>
						<Field.Root>
							<Field.Label>Status</Field.Label>
							<Select.Root
								collection={createListCollection({ items: [...statusOptions] })}
								value={[props.status]}
								onValueChange={(details) => {
									if (details.value[0] !== props.status) {
										props.onStatusChange(details.value[0]);
									}
								}}
								disabled={props.isUpdating()}
								positioning={{ sameWidth: true }}
							>
								<Select.Control>
									<Select.Trigger>
										<Select.ValueText placeholder="Select status" />
									</Select.Trigger>
								</Select.Control>
								<Select.Positioner>
									<Select.Content>
										<For each={[...statusOptions]}>
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
					</div>
				</div>
			</Card.Body>
		</Card.Root>
	);
}
