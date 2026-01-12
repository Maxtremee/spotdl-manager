import { createFileRoute, Link } from "@tanstack/solid-router";
import { createEffect, createSignal, onCleanup, onMount, Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, stack, vstack } from "styled-system/patterns";
import { Badge } from "~/components/ui/badge";
import * as Breadcrumb from "~/components/ui/breadcrumb";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import { Spinner } from "~/components/ui/spinner";
import { Text } from "~/components/ui/text";
import {
	getInvocationLogServerFn,
	getPlaylistByIdServerFn,
} from "~/modules/server/playlist/functions";

export const Route = createFileRoute("/library_/$playlistId_/logs_/$logId")({
	loader: async ({ params }) => {
		const playlist = await getPlaylistByIdServerFn({
			data: { id: params.playlistId },
		})
		const logResult = await getInvocationLogServerFn({
			data: { invocationId: params.logId },
		})
		return { playlist, logResult };
	},
	component: InvocationLogPage,
});

function InvocationLogPage() {
	const params = Route.useParams();
	const data = Route.useLoaderData();

	const [content, setContent] = createSignal(
		data().logResult.success ? (data().logResult.data?.content ?? "") : "",
	)
	const [status, setStatus] = createSignal(
		data().logResult.success
			? (data().logResult.data?.status ?? "running")
			: "running",
	)
	const [isLoading, setIsLoading] = createSignal(false);
	const [error, setError] = createSignal<string | null>(
		data().logResult.success ? null : (data().logResult.error ?? null),
	)
	const [autoScroll, setAutoScroll] = createSignal(true);

	let logContainerRef: HTMLPreElement | undefined;
	let pollInterval: ReturnType<typeof setInterval> | undefined;

	const isRunning = () => status() === "running";

	const fetchLog = async () => {
		try {
			const result = await getInvocationLogServerFn({
				data: { invocationId: params().logId },
			})

			if (result.success && result.data) {
				setContent(result.data.content);
				setStatus(result.data.status);
				setError(null);

				// Stop polling if invocation is no longer running
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
	}

	// Auto-scroll to bottom when content updates
	createEffect(() => {
		// get content so this effect runs when it changes
		content();
		if (autoScroll() && logContainerRef) {
			logContainerRef.scrollTop = logContainerRef.scrollHeight;
		}
	})

	// Handle scroll to detect if user scrolled up
	const handleScroll = () => {
		if (!logContainerRef) {
			return
		}
		const { scrollTop, scrollHeight, clientHeight } = logContainerRef;
		const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
		setAutoScroll(isAtBottom);
	}

	onMount(() => {
		// Start polling if invocation is running
		if (isRunning()) {
			pollInterval = setInterval(fetchLog, 2000);
		}
	})

	onCleanup(() => {
		if (pollInterval) {
			clearInterval(pollInterval);
		}
	})

	const playlist = () => data().playlist;

	return (
		<>
			{/* Header with breadcrumb navigation */}
			<header class={stack({ gap: "4", mb: "6" })}>
				<Breadcrumb.Root>
					<Breadcrumb.List>
						<Breadcrumb.Item>
							<Link
								to="/"
								class={css({
									color: "fg.muted",
									fontSize: "sm",
									"&:hover": { color: "fg.default" },
									textDecoration: "none",
								})}
							>
								Home
							</Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							<Link
								to="/library"
								class={css({
									color: "fg.muted",
									fontSize: "sm",
									"&:hover": { color: "fg.default" },
									textDecoration: "none",
								})}
							>
								Library
							</Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							<Link
								to="/library/$playlistId"
								params={{ playlistId: params().playlistId }}
								class={css({
									color: "fg.muted",
									fontSize: "sm",
									"&:hover": { color: "fg.default" },
									textDecoration: "none",
								})}
							>
								{playlist().name}
							</Link>
						</Breadcrumb.Item>
						<Breadcrumb.Separator />
						<Breadcrumb.Item>
							<span
								class={css({
									color: "fg.default",
									fontSize: "sm",
									fontWeight: "medium",
								})}
							>
								Log
							</span>
						</Breadcrumb.Item>
					</Breadcrumb.List>
				</Breadcrumb.Root>

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
						<Badge
							class={css({
								textTransform: "capitalize",
							})}
						>
							{status()}
						</Badge>
						<Show when={isRunning()}>
							<Spinner size="sm" />
						</Show>
					</div>
				</div>
			</header>

			{/* Log Content Card */}
			<Card.Root>
				<Card.Header>
					<div class={hstack({ justify: "space-between", w: "full" })}>
						<Card.Title>Output</Card.Title>
						<div class={hstack({ gap: "2" })}>
							<Show when={isRunning()}>
								<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
									Auto-scroll: {autoScroll() ? "On" : "Off"}
								</Text>
								<Button
									variant="subtle"
									size="xs"
									onClick={() => setAutoScroll(!autoScroll())}
								>
									{autoScroll() ? "Disable" : "Enable"}
								</Button>
							</Show>
							<Button variant="outline" size="sm" onClick={fetchLog}>
								Refresh
							</Button>
						</div>
					</div>
				</Card.Header>

				<Card.Body class={css({ p: "0" })}>
					<Show
						when={!isLoading()}
						fallback={
							<div
								class={vstack({
									gap: "2",
									py: "8",
									alignItems: "center",
									justifyContent: "center",
								})}
							>
								<Spinner size="lg" />
								<Text class={css({ color: "fg.muted" })}>Loading log...</Text>
							</div>
						}
					>
						<Show
							when={!error()}
							fallback={
								<div
									class={vstack({
										gap: "2",
										py: "8",
										alignItems: "center",
									})}
								>
									<Text class={css({ color: "fg.error" })}>{error()}</Text>
									<Button variant="outline" size="sm" onClick={fetchLog}>
										Retry
									</Button>
								</div>
							}
						>
							<Show
								when={content()}
								fallback={
									<div
										class={vstack({
											gap: "2",
											py: "8",
											alignItems: "center",
										})}
									>
										<Text class={css({ color: "fg.muted" })}>
											No log content available yet.
										</Text>
										<Show when={isRunning()}>
											<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
												Waiting for output...
											</Text>
										</Show>
									</div>
								}
							>
								<pre
									ref={logContainerRef}
									onScroll={handleScroll}
									class={css({
										fontFamily: "mono",
										fontSize: "xs",
										lineHeight: "1.5",
										bg: "gray.900",
										color: "gray.100",
										p: "4",
										overflow: "auto",
										maxH: "70vh",
										whiteSpace: "pre-wrap",
										wordBreak: "break-all",
										m: "4",
										borderRadius: "md",
									})}
								>
									{content()}
								</pre>
							</Show>
						</Show>
					</Show>
				</Card.Body>

				<Card.Footer>
					<div class={hstack({ justify: "space-between", w: "full" })}>
						<Link
							to="/library/$playlistId"
							params={{ playlistId: params().playlistId }}
						>
							<Button variant="outline">Back to Playlist</Button>
						</Link>
					</div>
				</Card.Footer>
			</Card.Root>
		</>
	)
}
