// src/client.tsx

import { hydrateStart, StartClient } from "@tanstack/solid-start/client";
import nprogress from "nprogress";
import { hydrate } from "solid-js/web";

hydrateStart().then((router) => {
	router.subscribe("onBeforeLoad", ({ hrefChanged }) => {
		hrefChanged && nprogress.start();
	});

	router.subscribe("onLoad", () => {
		nprogress.done();
	});

	hydrate(() => <StartClient router={router} />, document);
});
