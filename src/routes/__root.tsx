import {
	createRootRouteWithContext,
	HeadContent,
	Outlet,
	Scripts,
} from "@tanstack/solid-router";
import { TanStackRouterDevtools } from "@tanstack/solid-router-devtools";
import { Suspense } from "solid-js";

import { HydrationScript } from "solid-js/web";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";

import { Nav } from "~/components/nav";

import styleCss from "../styles.css?url";

export const Route = createRootRouteWithContext()({
	head: () => ({
		meta: [
			{ title: "spotDL Manager" },
			{ charset: "utf-8" },
			{ name: "viewport", content: "width=device-width, initial-scale=1" },
			{
				name: "description",
				content: "Manage your spotDL downloads from the browser",
			},
			{ name: "theme-color", content: "#16a34a" },
			{ property: "og:title", content: "spotDL Manager" },
			{
				property: "og:description",
				content:
					"Manage your spotDL downloads from the browser with a clean Solid.js UI.",
			},
			{ property: "og:type", content: "website" },
		],
		links: [
			{ rel: "stylesheet", href: styleCss },
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossorigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Roboto+Mono:ital,wght@0,100..700;1,100..700&display=swap",
			},
		],
	}),
	shellComponent: RootComponent,
});

function RootComponent() {
	return (
		<html lang="en">
			<head>
				<HydrationScript />
			</head>
			<body class={css({ colorPalette: "grass" })}>
				<HeadContent />
				<div
					class={css({
						display: { base: "block", md: "grid" },
						gridTemplateColumns: "280px 1fr",
						bg: "gray.surface.bg",
						color: "fg.default",
						height: "100vh",
					})}
				>
					<Nav />
					<main
						class={css({
							bg: "gray.surface.bg",
							px: { base: "5", md: "10" },
							py: { base: "6", md: "10" },
							overflowY: "auto",
						})}
					>
						<div class={stack({ gap: "6" })}>
							<Suspense>
								<Outlet />
								<TanStackRouterDevtools />
							</Suspense>
						</div>
					</main>
				</div>
				<Scripts />
			</body>
		</html>
	);
}
