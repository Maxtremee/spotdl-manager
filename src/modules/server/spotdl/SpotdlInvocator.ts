import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

export const AllowedFormatEnum = z.enum(["mp3", "m4a", "flac", "wav"]);

export const RunRequestSchema = z.object({
	sourceUrl: z.url(),
	outputDir: z.string().min(1),
	flags: z
		.object({
			format: AllowedFormatEnum.optional(),
			quality: z.enum(["low", "medium", "high"]).optional(),
			overwrite: z.boolean().optional(),
			syncWithoutDeleting: z.boolean().optional(),
			extraArgs: z.array(z.string()).default([]).optional(),
		})
		.default({})
		.optional(),
	playlistId: z.string().optional(),
});

export type RunRequest = z.infer<typeof RunRequestSchema>;

export const RunResultSchema = z.object({
	runId: z.string(),
	playlistId: z.string().optional(),
	startedAt: z.string(),
	finishedAt: z.string(),
	exitCode: z.number().nullable(),
	status: z.enum(["success", "failed", "canceled"]),
	logPath: z.string().optional(),
	syncFilePath: z.string().optional(),
	summary: z.string().optional(),
});

export type RunResult = z.infer<typeof RunResultSchema>;

export type SpotdlInvocatorOptions = {
	binaryPath?: string;
	logsDir?: string;
	syncDir?: string;
	env?: NodeJS.ProcessEnv;
};

export class SpotdlInvocator {
	private readonly binaryPath: string;
	private readonly logsDir: string;
	private readonly syncDir: string;
	private readonly env: NodeJS.ProcessEnv;

	constructor(options?: SpotdlInvocatorOptions) {
		this.binaryPath = options?.binaryPath ?? "spotdl";
		this.logsDir =
			options?.logsDir ?? path.resolve(process.cwd(), "data", "logs");
		this.syncDir =
			options?.syncDir ?? path.resolve(process.cwd(), "data", "sync");
		this.env = options?.env ?? process.env;
	}

	private buildArgs(req: RunRequest, syncFilePath?: string): string[] {
		const args: string[] = [];

		if (syncFilePath) {
			// sync mode: use existing sync file
			args.push("sync", syncFilePath);
		} else {
			// initial download: create sync file
			args.push("sync", req.sourceUrl);
		}

		args.push("--output", req.outputDir);

		const { flags } = req;
		if (flags?.format) {
			args.push("--output-format", flags.format);
		}
		if (flags?.overwrite) {
			args.push("--overwrite");
		}
		if (flags?.syncWithoutDeleting) {
			args.push("--sync-without-deleting");
		}
		if (flags?.extraArgs?.length) {
			args.push(...flags.extraArgs);
		}
		return args;
	}

	private async ensureDir(dir: string): Promise<void> {
		await fs.mkdir(dir, { recursive: true });
	}

	private formatTimestamp(date: Date): string {
		return date
			.toISOString()
			.replace(/[:.]/g, "-")
			.replace("T", "_")
			.replace("Z", "");
	}

	/**
	 * Generate log file path for an invocation (used for streaming logs)
	 */
	getLogPath(playlistId: string | undefined, startedAt: Date): string {
		const timestamp = this.formatTimestamp(startedAt);
		const filename = playlistId
			? `${playlistId}-${timestamp}.txt`
			: `${timestamp}.txt`;
		return path.join(this.logsDir, filename);
	}

	private getSyncFilePath(playlistId: string): string {
		return path.join(this.syncDir, `${playlistId}.spotdl`);
	}

	private async syncFileExists(playlistId: string): Promise<boolean> {
		const syncPath = this.getSyncFilePath(playlistId);
		try {
			await fs.access(syncPath);
			return true;
		} catch {
			return false;
		}
	}

	private async createSyncFile(
		playlistId: string,
		req: RunRequest,
	): Promise<string> {
		await this.ensureDir(this.syncDir);
		const syncFilePath = this.getSyncFilePath(playlistId);

		// spotdl sync command with --save-file creates the sync file
		const args = ["sync", req.sourceUrl, "--save-file", syncFilePath];
		args.push("--output", req.outputDir);

		const { flags } = req;
		if (flags?.format) {
			args.push("--format", flags.format);
		}
		if (flags?.extraArgs?.length) {
			args.push(...flags.extraArgs);
		}

		const child = spawn(this.binaryPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: this.env,
		});

		await once(child, "close");
		return syncFilePath;
	}

	async run(input: RunRequest): Promise<RunResult> {
		const startedAtDate = new Date();
		const startedAt = startedAtDate.toISOString();
		const runId = randomUUID();

		// Handle sync file
		let syncFilePath: string | undefined;
		if (input.playlistId) {
			const exists = await this.syncFileExists(input.playlistId);
			if (exists) {
				syncFilePath = this.getSyncFilePath(input.playlistId);
			} else {
				syncFilePath = await this.createSyncFile(input.playlistId, input);
			}
		}

		const args = this.buildArgs(input, syncFilePath);

		// Prepare log file for incremental writing
		await this.ensureDir(this.logsDir);
		const logPath = this.getLogPath(input.playlistId, startedAtDate);
		const logStream = createWriteStream(logPath, {
			flags: "w",
			encoding: "utf8",
		});

		// Write header immediately
		logStream.write(`# spotdl run ${runId}\n`);
		logStream.write(`command: ${this.binaryPath} ${args.join(" ")}\n`);
		logStream.write(`startedAt: ${startedAt}\n`);
		logStream.write(`finishedAt: (in progress)\n`);
		logStream.write(`exitCode: (pending)\n\n`);
		logStream.write("## output\n");

		const child = spawn(this.binaryPath, args, {
			stdio: ["ignore", "pipe", "pipe"],
			env: this.env,
		});

		let stdoutBuf = "";
		let spawnError: Error | null = null;

		// Write stdout chunks immediately to file
		child.stdout?.on("data", (chunk) => {
			const text = chunk.toString();
			stdoutBuf += text;
			logStream.write(text);
		});

		// Write stderr chunks immediately to file (prefixed for clarity)
		child.stderr?.on("data", (chunk) => {
			const text = chunk.toString();
			logStream.write(`[stderr] ${text}`);
		});

		child.on("error", (err) => {
			spawnError = err as Error;
			const errorMsg = `\n[spawn error] ${err.message}\n`;
			logStream.write(errorMsg);
		});

		await once(child, "close");

		const finishedAt = new Date().toISOString();
		const exitCode = child.exitCode ?? (spawnError ? 127 : null);

		// Write footer with final status
		logStream.write("\n\n## summary\n");
		logStream.write(`finishedAt: ${finishedAt}\n`);
		logStream.write(`exitCode: ${exitCode}\n`);
		logStream.write(`status: ${exitCode === 0 ? "success" : "failed"}\n`);
		logStream.end();

		// Wait for stream to finish writing
		await new Promise<void>((resolve, reject) => {
			logStream.on("finish", resolve);
			logStream.on("error", reject);
		});

		const status: "success" | "failed" | "canceled" =
			exitCode === 0 ? "success" : "failed";
		const summary = stdoutBuf.split("\n").slice(-10).join("\n");

		return {
			playlistId: input.playlistId,
			runId,
			startedAt,
			finishedAt,
			exitCode,
			status,
			logPath,
			syncFilePath,
			summary,
		};
	}
}
