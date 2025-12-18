import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";

const RunRecordSchema = z.object({
	runId: z.string(),
	playlistId: z.string().optional(),
	startedAt: z.string(),
	finishedAt: z.string(),
	exitCode: z.number().nullable(),
	status: z.enum(["success", "failed", "canceled"]),
	logPath: z.string().optional(),
	summary: z.string().optional(),
});

export type RunRecord = z.infer<typeof RunRecordSchema>;

const STORAGE_DIR = path.resolve(process.cwd(), "data");
const STORAGE_FILE = path.join(STORAGE_DIR, "runs.json");

async function ensureStorage(): Promise<void> {
	await fs.mkdir(STORAGE_DIR, { recursive: true });
	try {
		await fs.access(STORAGE_FILE);
	} catch {
		await fs.writeFile(STORAGE_FILE, "[]", "utf8");
	}
}

export async function saveRun(record: RunRecord): Promise<void> {
	await ensureStorage();
	const raw = await fs.readFile(STORAGE_FILE, "utf8");
	const arr: unknown = JSON.parse(raw);
	const runs = z.array(RunRecordSchema).catch([]).parse(arr);
	runs.push(record);
	await fs.writeFile(STORAGE_FILE, JSON.stringify(runs, null, 2), "utf8");
}

export async function listRuns(
	limit = 50,
	playlistId?: string,
): Promise<RunRecord[]> {
	await ensureStorage();
	const raw = await fs.readFile(STORAGE_FILE, "utf8");
	const arr: unknown = JSON.parse(raw);
	let runs = z.array(RunRecordSchema).catch([]).parse(arr);
	if (playlistId) {
		runs = runs.filter((r) => r.playlistId === playlistId);
	}
	runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
	return runs.slice(0, limit);
}

export async function getRun(runId: string): Promise<RunRecord | null> {
	await ensureStorage();
	const raw = await fs.readFile(STORAGE_FILE, "utf8");
	const arr: unknown = JSON.parse(raw);
	const runs = z.array(RunRecordSchema).catch([]).parse(arr);
	return runs.find((r) => r.runId === runId) ?? null;
}
