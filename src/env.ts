import { createEnv } from "@t3-oss/env-core";
import { z } from "zod";

export const env = createEnv({
	server: {
		SERVER_URL: z.url().optional(),
		/**
		 * Phase 2: override the Python interpreter path for the spotifyscraper bridge.
		 * Default is 'scraper/.venv/bin/python' (resolved from the app's cwd).
		 * Docker-only dev (D-04) makes this mostly unnecessary, but keeping it as an
		 * escape hatch for rare host-side invocations (e.g. running the integration
		 * test with SCRAPER_INTEGRATION=1 on a workstation with a local venv).
		 */
		PYTHON_BIN: z.string().min(1).optional(),
		/**
		 * Phase 3 D-10: override the yt-dlp binary path. Default is "yt-dlp" (resolved via PATH).
		 * Docker images set this to /app/scraper/.venv/bin/yt-dlp because yt-dlp installs into
		 * the existing spotifyscraper venv (see scraper/requirements.txt).
		 */
		YT_DLP_BIN: z.string().min(1).optional(),
	},

	/**
	 * The prefix that client-side variables must have. This is enforced both at
	 * a type-level and at runtime.
	 */
	clientPrefix: "VITE_",

	client: {
		VITE_APP_TITLE: z.string().min(1).optional(),
	},

	/**
	 * What object holds the environment variables at runtime. This is usually
	 * `process.env` or `import.meta.env`.
	 */
	runtimeEnv: import.meta.env,

	/**
	 * By default, this library will feed the environment variables directly to
	 * the Zod validator.
	 *
	 * This means that if you have an empty string for a value that is supposed
	 * to be a number (e.g. `PORT=` in a ".env" file), Zod will incorrectly flag
	 * it as a type mismatch violation. Additionally, if you have an empty string
	 * for a value that is supposed to be a string with a default value (e.g.
	 * `DOMAIN=` in an ".env" file), the default value will never be applied.
	 *
	 * In order to solve these issues, we recommend that all new projects
	 * explicitly specify this option as true.
	 */
	emptyStringAsUndefined: true,
});
