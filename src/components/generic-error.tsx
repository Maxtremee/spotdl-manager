import type { ErrorComponentProps } from "@tanstack/solid-router";
import { Show } from "solid-js";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";

import { Button } from "~/components/ui/button";

export function GenericError(props: ErrorComponentProps) {
	const message = () => {
		if (!props.error) {
			return "Something went wrong.";
		}
		return props.error instanceof Error
			? props.error.message || "Something went wrong."
			: String(props.error);
	};

	const handleRetry = () => {
		if (props.reset) {
			props.reset();
			return;
		}
		window?.location.reload();
	};

	const handleHome = () => {
		window?.location.assign("/");
	};

	return (
		<div
			class={css({
				minH: "100vh",
				display: "grid",
				placeItems: "center",
				px: "6",
				py: "12",
			})}
		>
			<div
				class={stack({
					gap: "4",
					alignItems: "center",
					textAlign: "center",
					maxW: "lg",
					w: "full",
					borderWidth: "1px",
					borderRadius: "xl",
					p: "6",
				})}
			>
				<div class={stack({ gap: "2" })}>
					<p class={css({ fontWeight: "semibold", fontSize: "xl" })}>
						Something went wrong
					</p>
					<p class={css({ color: "#475569" })}>{message()}</p>
				</div>
				<Show when={props.error instanceof Error && props.error.stack}>
					<pre
						class={css({
							width: "full",
							overflowX: "auto",
							textAlign: "left",
							fontSize: "sm",
							color: "#475569",
							bg: "#f8fafc",
							p: "3",
							borderRadius: "lg",
							borderWidth: "1px",
							borderColor: "#e2e8f0",
						})}
					>
						{props.error instanceof Error ? props.error.stack : null}
					</pre>
				</Show>
				<div
					class={css({
						display: "flex",
						gap: "3",
						flexWrap: "wrap",
						justifyContent: "center",
					})}
				>
					<Button onClick={handleRetry}>Try again</Button>
					<Button variant="surface" onClick={handleHome}>
						Go home
					</Button>
				</div>
			</div>
		</div>
	);
}
