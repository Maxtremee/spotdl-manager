import { css } from "styled-system/css";
import { hstack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";
import { formatDuration } from "~/modules/client/invocation/service/duration";

interface SummaryStatsCardsProps {
	successRate: number;
	avgDurationMs: number;
	successCount: number;
	failedCount: number;
}

export function SummaryStatsCards(props: SummaryStatsCardsProps) {
	const successRatePct = () => Math.round(props.successRate * 100);

	return (
		<div class={hstack({ gap: "4", flexWrap: "wrap" })}>
			<Card.Root class={css({ p: "4", minW: "56" })}>
				<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
					Success rate
				</Text>
				<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
					{successRatePct()}%
				</Text>
			</Card.Root>
			<Card.Root class={css({ p: "4", minW: "56" })}>
				<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
					Avg duration
				</Text>
				<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
					{formatDuration(props.avgDurationMs)}
				</Text>
			</Card.Root>
			<Card.Root class={css({ p: "4", minW: "56" })}>
				<Text class={css({ fontSize: "sm", color: "fg.muted" })}>Success</Text>
				<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
					{props.successCount}
				</Text>
			</Card.Root>
			<Card.Root class={css({ p: "4", minW: "56" })}>
				<Text class={css({ fontSize: "sm", color: "fg.muted" })}>Failed</Text>
				<Text class={css({ fontSize: "2xl", fontWeight: "bold" })}>
					{props.failedCount}
				</Text>
			</Card.Root>
		</div>
	);
}
