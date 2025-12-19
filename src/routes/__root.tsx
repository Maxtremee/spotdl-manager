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

import styleCss from "../styles.css?url";

export const Route = createRootRouteWithContext()({
	head: () => ({
		title: "spotDL Manager",
		meta: [
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
		links: [{ rel: "stylesheet", href: styleCss }],
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
				<Suspense>
					<Outlet />
					<TanStackRouterDevtools />
				</Suspense>
				<Scripts />
			</body>
		</html>
	);
}
