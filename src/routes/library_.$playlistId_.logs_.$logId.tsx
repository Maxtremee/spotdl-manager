import { createFileRoute } from "@tanstack/solid-router";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack } from "styled-system/patterns";
import { Badge } from "~/components/ui/badge";
import { Spinner } from "~/components/ui/spinner";
import { Text } from "~/components/ui/text";
import { LogBreadcrumb } from "~/modules/client/invocation/components/log-breadcrumb";
import { LogDisplayCard } from "~/modules/client/invocation/components/log-display-card";
import {
	getInvocationLogServerFn,
	getPlaylistByIdServerFn,
} from "~/modules/server/playlist/functions";

export const Route = createFileRoute("/library_/$playlistId_/logs_/$logId")({
	loader: async ({ params }) => {
		const playlist = await getPlaylistByIdServerFn({
			data: { id: params.playlistId },
		});
		const logResult = await getInvocationLogServerFn({
			data: { invocationId: params.logId },
		});
		return { playlist, logResult };
	},
	component: InvocationLogPage,
});

function InvocationLogPage() {
	const params = Route.useParams();
	const data = Route.useLoaderData();

	const [content, setContent] = createSignal(
		data().logResult.success ? (data().logResult.data?.content ?? "") : "",
	);
	const [status, setStatus] = createSignal(
		data().logResult.success
			? (data().logResult.data?.status ?? "running")
			: "running",
	);
	const [isLoading, setIsLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(
		data().logResult.success ? null : (data().logResult.error ?? null),
	);
	const [autoScroll, setAutoScroll] = createSignal(true);

	let logContainerRef: HTMLPreElement | undefined;
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	const isRunning = () => status() === "running";

	const fetchLog = async () => {
		try {
			const result = await getInvocationLogServerFn({
				data: { invocationId: params().logId },
			});

			if (result.success && result.data) {
				setContent(result.data.content);
				setStatus(result.data.status);
				setError(null);

				if (!result.data.isRunning && pollInterval) {
					clearInterval(pollInterval);
					pollInterval = undefined;
				}
			} else {
				setError(result.error || "Failed to fetch log");
			}
		} catch (err) {
			setError(err instanceof Error ? err.message : "Failed to fetch log");
		} finally {
			setIsLoading(false);
		}
	};

	createEffect(() => {
		content();
		if (autoScroll() && logContainerRef) {
			logContainerRef.scrollTop = logContainerRef.scrollHeight;
		}
	});

	const handleScroll = () => {
		if (!logContainerRef) {
			return;
		}
		const { scrollTop, scrollHeight, clientHeight } = logContainerRef;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
		setAutoScroll(isAtBottom);
	};

	onMount(() => {
		if (isRunning()) {
			pollInterval = setInterval(fetchLog, 2000);
		}
	});

	onCleanup(() => {
		if (pollInterval) {
			clearInterval(pollInterval);
		}
	});

	const playlist = () => data().playlist;

	return (
		<>
			<header class={stack({ gap: "4", mb: "6" })}>
				<LogBreadcrumb
					playlistId={params().playlistId}
					playlistName={playlist().name}
				/>

				<div class={hstack({ justify: "space-between", alignItems: "center" })}>
					<div>
						<Text
							as="h1"
							class={css({
								color: "fg.default",
								fontSize: { base: "2xl", md: "3xl" },
							})}
						>
							Invocation Log
						</Text>
						<Text class={css({ fontSize: "xs", color: "fg.muted", mt: "1" })}>
							{params().logId}
						</Text>
					</div>
					<div class={hstack({ gap: "2" })}>
						<Badge class={css({ textTransform: "capitalize" })}>
							{status()}
						</Badge>
						<Show when={isRunning()}>
							<Spinner size="sm" />
						</Show>
					</div>
				</div>
			</header>

			<LogDisplayCard
				content={content}
				isLoading={isLoading}
				error={error}
				isRunning={isRunning}
				autoScroll={autoScroll}
				setAutoScroll={setAutoScroll}
				onRefresh={fetchLog}
				onScroll={handleScroll}
				logContainerRef={(el) => {
					logContainerRef = el;
				}}
				playlistId={params().playlistId}
			/>
		</>
	);
}
