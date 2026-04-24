/**
 * SpotifyScraperBridge — Node side of the Python subprocess bridge.
 *
 * Spawns `scraper/.venv/bin/python scraper/scraper.py` (or an override via
 * env.PYTHON_BIN), writes a JSON request to stdin, accumulates stdout until
 * the child's `close` event fires, then parses and validates the envelope via
 * `PythonEnvelopeSchema`.
 *
 * Security properties:
 *  - URL never appears in argv — flows only through `child.stdin.end(JSON.stringify(...))`.
 *  - `spawn` is called with explicit argv form: `(binary, [scriptPath], opts)`.
 *  - `opts.shell` is never set to `true` — Node's default is `false`.
 *  - `opts.stdio` is always `["pipe", "pipe", "pipe"]` so all streams are controlled.
 *
 * Buffering:
 *  Buffered stdout is bounded by library's single-request design (spike-observed
 *  <100 KB/envelope). Not streaming — no backpressure concern. (T-2-06: accepted.)
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import { env } from "~/env";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import {
	PYTHON_CRASH_PREFIX,
	type PythonEnvelope,
	PythonEnvelopeSchema,
	type ScrapeRequest,
} from "./schema";

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_PYTHON_BIN = "scraper/.venv/bin/python";
const DEFAULT_SCRIPT_PATH = "scraper/scraper.py";
const STDERR_SLICE_LIMIT = 500;

export class SpotifyScraperBridge {
	private readonly pythonBin: string;
	private readonly scriptPath: string;
	private readonly timeoutMs: number;
	private readonly logger: AppLogger;

	constructor(
		pythonBin?: string,
		scriptPath?: string,
		timeoutMs?: number,
		logger?: AppLogger,
	) {
		this.pythonBin = pythonBin ?? env.PYTHON_BIN ?? DEFAULT_PYTHON_BIN;
		this.scriptPath = scriptPath ?? DEFAULT_SCRIPT_PATH;
		this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
		this.logger = logger ?? Logger.get("SpotifyScraperBridge");
	}

	/**
	 * Fetch Spotify playlist metadata via the Python scraper subprocess.
	 *
	 * Writes `{ url, source_type: "playlist" }` as JSON to the child's stdin
	 * (closes stdin immediately so Python's `sys.stdin.read()` unblocks), then
	 * awaits the child `close` event before attempting to parse the accumulated
	 * stdout buffer.
	 *
	 * Returns a `PythonEnvelope` — either the validated Python output or a
	 * synthesized `python_crash` envelope if Python exited without delivering
	 * a parseable envelope.
	 */
	async fetchPlaylist(url: string): Promise<PythonEnvelope> {
		const child = spawn(this.pythonBin, [this.scriptPath], {
			stdio: ["pipe", "pipe", "pipe"],
			timeout: this.timeoutMs,
		});

		const stdoutChunks: Buffer[] = [];
		const stderrChunks: Buffer[] = [];

		child.stdout.on("data", (chunk: Buffer) => {
			stdoutChunks.push(chunk);
		});

		child.stderr.on("data", (chunk: Buffer) => {
			stderrChunks.push(chunk);
		});

		// Write request JSON to Python stdin; close so Python's sys.stdin.read() returns.
		const req: ScrapeRequest = { url, source_type: "playlist" };
		child.stdin.end(`${JSON.stringify(req)}\n`);

		// Wait for the process to finish — parse ONLY after close fires (Pitfall 2 prevention).
		const [code, signal] = (await once(child, "close")) as [
			number | null,
			NodeJS.Signals | null,
		];

		const stdout = Buffer.concat(stdoutChunks).toString("utf8").trim();
		const stderrFull = Buffer.concat(stderrChunks).toString("utf8").trim();

		// Attempt to parse the envelope if stdout is non-empty.
		if (stdout.length > 0) {
			try {
				const raw: unknown = JSON.parse(stdout);
				const parsed = PythonEnvelopeSchema.safeParse(raw);
				if (parsed.success) {
					return parsed.data;
				}
				this.logger.error(
					{ validationErrors: parsed.error.message, code, signal },
					"SpotifyScraperBridge: stdout present but Zod validation failed — synthesizing crash envelope",
				);
			} catch (jsonErr) {
				this.logger.error(
					{ jsonErr, code, signal, stdoutPreview: stdout.slice(0, 200) },
					"SpotifyScraperBridge: stdout present but JSON.parse threw — synthesizing crash envelope",
				);
			}
		}

		// Synthesize a python_crash envelope.
		//
		// W-1: `PYTHON_CRASH_PREFIX` is imported from "./schema" — NOT a string literal.
		// SyncRunner (Plan 04) detects this prefix via `.startsWith(PYTHON_CRASH_PREFIX)`
		// and overrides `error.type` to `"python_crash"` in the FailureReason enum.
		//
		// PythonErrorSchema only allows the 4 Python-side types; we use "network_error"
		// as the placeholder so the shape validates — SyncRunner reclassifies on detection.
		const stderr = stderrFull.slice(0, STDERR_SLICE_LIMIT);

		return {
			tracks: null,
			cover_art_url: null,
			error: {
				type: "network_error",
				message: `${PYTHON_CRASH_PREFIX} exit=${code} signal=${signal} stderr=${stderr}`,
			},
		};
	}
}
