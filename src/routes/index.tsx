import { createFileRoute } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";
import { Text } from "~/components/ui/text";

export const Route = createFileRoute("/")({ component: App });

function App() {
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
					Home
				</Text>
				<Text class={css({ color: "fg.subtle" })}>
					A responsive layout with a collapsible navigation for managing your
					download pipeline.
				</Text>
			</header>
			<Card.Root>
				<Card.Header>
					<Card.Title>Overview</Card.Title>
					<Text class={css({ color: "fg.muted" })}>
						Quick status of recent downloads and queue health.
					</Text>
				</Card.Header>
				<Card.Body>
					<Text class={css({ color: "fg.subtle" })}>
						Monitor current tasks, see what finished recently, and spot failures
						fast.
					</Text>
					<div
						class={css({
							mt: "6",
							display: "grid",
							gridTemplateColumns: {
								base: "1fr",
								md: "repeat(2, minmax(0, 1fr))",
							},
							gap: "4",
						})}
					>
						<InfoCard title="Queue" body="3 downloads in progress, 1 queued." />
						<InfoCard title="Storage" body="128 GB free in output folder." />
						<InfoCard title="Health" body="No failed jobs in the last 24h." />
						<InfoCard title="Formats" body="MP3 320kbps, FLAC for favorites." />
					</div>
				</Card.Body>
			</Card.Root>
		</>
	);
}

interface InfoCardProps {
	title: string;
	body: string;
}

function InfoCard(props: InfoCardProps) {
	return (
		<Card.Root
			class={css({
				bg: "gray.surface.bg",
				borderColor: "border",
				borderWidth: "1px",
			})}
		>
			<Card.Header>
				<Card.Title class={css({ color: "fg.default" })}>
					{props.title}
				</Card.Title>
			</Card.Header>
			<Card.Body>
				<Text class={css({ color: "fg.subtle" })}>{props.body}</Text>
			</Card.Body>
		</Card.Root>
	);
}
