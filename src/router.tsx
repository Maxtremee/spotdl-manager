import { createRouter } from "@tanstack/solid-router";
import { GenericError } from "./components/generic-error";
import { NotFound } from "./components/not-found";
// Import the generated route tree
import { routeTree } from "./routeTree.gen";

// Create a new router instance
export const getRouter = () => {
	const router = createRouter({
		routeTree,
		scrollRestoration: true,
		defaultErrorComponent: GenericError,
		defaultNotFoundComponent: NotFound,
		defaultViewTransition: true,
	});
	return router;
};
