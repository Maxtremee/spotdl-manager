import { Link } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";

import { Button } from "~/components/ui/button";

export function NotFound() {
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
					<p
						class={css({
							fontWeight: "bold",
							fontSize: "6xl",
							color: "#94a3b8",
						})}
					>
						404
					</p>
					<p class={css({ fontWeight: "semibold", fontSize: "xl" })}>
						Page not found
					</p>
					<p class={css({ color: "#475569" })}>
						The page you're looking for doesn't exist.
					</p>
				</div>
				<Button
					asChild={(props) => (
						<Link to="/" {...props()}>
							Go home
						</Link>
					)}
				/>
			</div>
		</div>
	);
}
