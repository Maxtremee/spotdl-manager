import { Link } from "@tanstack/solid-router";
import type { Accessor, Setter } from "solid-js";
import { Show } from "solid-js";
import { css } from "styled-system/css";
import { hstack, vstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Card from "~/components/ui/card";
import { Spinner } from "~/components/ui/spinner";
import { Text } from "~/components/ui/text";

interface LogDisplayCardProps {
	content: Accessor<string>;
	isLoading: Accessor<boolean>;
	error: Accessor<string | null>;
	isRunning: Accessor<boolean>;
	autoScroll: Accessor<boolean>;
	setAutoScroll: Setter<boolean>;
	onRefresh: () => void;
	onScroll: () => void;
	logContainerRef: (el: HTMLPreElement) => void;
	playlistId: string;
}

export function LogDisplayCard(props: LogDisplayCardProps) {
	return (
		<Card.Root>
			<Card.Header>
				<div class={hstack({ justify: "space-between", w: "full" })}>
					<Card.Title>Output</Card.Title>
					<div class={hstack({ gap: "2" })}>
						<Show when={props.isRunning()}>
							<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
								Auto-scroll: {props.autoScroll() ? "On" : "Off"}
							</Text>
							<Button
								variant="subtle"
								size="xs"
								onClick={() => props.setAutoScroll(!props.autoScroll())}
							>
								{props.autoScroll() ? "Disable" : "Enable"}
							</Button>
						</Show>
						<Button variant="outline" size="sm" onClick={props.onRefresh}>
							Refresh
						</Button>
					</div>
				</div>
			</Card.Header>

			<Card.Body class={css({ p: "0" })}>
				<Show
					when={!props.isLoading()}
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
						when={!props.error()}
						fallback={
							<div
								class={vstack({
									gap: "2",
									py: "8",
									alignItems: "center",
								})}
							>
								<Text class={css({ color: "fg.error" })}>{props.error()}</Text>
								<Button variant="outline" size="sm" onClick={props.onRefresh}>
									Retry
								</Button>
							</div>
						}
					>
						<Show
							when={props.content()}
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
									<Show when={props.isRunning()}>
										<Text class={css({ fontSize: "sm", color: "fg.muted" })}>
											Waiting for output...
										</Text>
									</Show>
								</div>
							}
						>
							<pre
								ref={props.logContainerRef}
								onScroll={props.onScroll}
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
								{props.content()}
							</pre>
						</Show>
					</Show>
				</Show>
			</Card.Body>

			<Card.Footer>
				<div class={hstack({ justify: "space-between", w: "full" })}>
					<Link
						to="/library/$playlistId"
						params={{ playlistId: props.playlistId }}
					>
						<Button variant="outline">Back to Playlist</Button>
					</Link>
				</div>
			</Card.Footer>
		</Card.Root>
	);
}
