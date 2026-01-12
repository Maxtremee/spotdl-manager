import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getDb } from "./index";
import {
	invocations,
	type NewInvocationRow,
	type NewPlaylistRow,
	playlists,
} from "./schema";

async function main() {
	const db = getDb();

	const now = new Date();

	const seedPlaylists: NewPlaylistRow[] = [
		{
			id: "seed-playlist-daily",
			name: "Daily Mix Downloader",
			sourceType: "playlist",
			sourceUrl: "https://open.spotify.com/playlist/1lJDx1lqWkjnh8D7VITEhC",
			outputDir: path.join(process.cwd(), "downloads", "daily-mix"),
			flagsOverwrite: false,
			flagsRetries: 3,
			flagsQuality: "high",
			flagsFormat: "mp3",
			scheduleEnabled: true,
			scheduleType: "cron",
			scheduleCron: "0 6 * * *",
			scheduleMinutes: null,
			status: "active",
			createdAt: now,
			updatedAt: now,
		},
		{
			id: "seed-album-weekly",
			name: "Album Sync Weekly",
			sourceType: "album",
			sourceUrl:
				"https://open.spotify.com/album/0m7RPdwNo1gte0nUSwh2yv?si=FikYvA9tR_uwPUB-qUc8vw",
			outputDir: path.join(process.cwd(), "downloads", "albums"),
			flagsOverwrite: true,
			flagsRetries: 5,
			flagsQuality: "very_high",
			flagsFormat: "flac",
			scheduleEnabled: true,
			scheduleType: "interval",
			scheduleCron: null,
			scheduleMinutes: 10080, // weekly
			status: "active",
			createdAt: now,
			updatedAt: now,
		},
		{
			id: randomUUID(),
			name: "Single Track Check",
			sourceType: "track",
			sourceUrl:
				"https://open.spotify.com/track/3xhHrJujvMsuArqRj9QLWy?si=3911e5125095495f",
			outputDir: path.join(process.cwd(), "downloads", "tracks"),
			flagsOverwrite: false,
			flagsRetries: 2,
			flagsQuality: "medium",
			flagsFormat: "mp3",
			scheduleEnabled: false,
			scheduleType: "interval",
			scheduleCron: null,
			scheduleMinutes: 720,
			status: "paused",
			createdAt: now,
			updatedAt: now,
		},
	];

	db.insert(playlists)
		.values(seedPlaylists)
		.onConflictDoNothing({ target: playlists.id })
		.run();

	const total = db.select().from(playlists).all().length;
	console.log(
		`Seed complete. Attempted ${seedPlaylists.length} inserts. Total playlists in DB: ${total}.`,
	);

	// Create sample invocations with log files
	const logsDir = path.join(process.cwd(), "logs");
	await fs.mkdir(logsDir, { recursive: true });

	const invocationId = "seed-invocation-1";
	const logPath = path.join(logsDir, "seed-playlist-daily-sample.txt");

	// Create a sample log file
	const sampleLogContent = `# spotdl run seed-run-001
startedAt: ${new Date(now.getTime() - 120000).toISOString()}
finishedAt: ${now.toISOString()}
exitCode: 0

## output
Processing playlist: Daily Mix Downloader
Found 25 tracks

Downloading: Artist - Track 1
[============================] 100%
Downloaded successfully

Downloading: Artist - Track 2
[============================] 100%
Downloaded successfully

Downloading: Artist - Track 3
[============================] 100%
Downloaded successfully

...

## summary
finishedAt: ${now.toISOString()}
exitCode: 0
status: success
`;

	await fs.writeFile(logPath, sampleLogContent, "utf8");

	const seedInvocations: NewInvocationRow[] = [
		{
			id: invocationId,
			playlistId: "seed-playlist-daily",
			startedAt: new Date(now.getTime() - 120000), // 2 minutes ago
			finishedAt: now,
			exitCode: 0,
			status: "success",
			logPath,
			summary: "Downloaded 25 tracks successfully",
		},
		{
			id: "seed-invocation-2",
			playlistId: "seed-playlist-daily",
			startedAt: new Date(now.getTime() - 86400000), // 1 day ago
			finishedAt: new Date(now.getTime() - 86400000 + 180000),
			exitCode: 1,
			status: "failed",
			logPath: null,
			summary: "Network error: Connection timeout",
		},
	];

	db.insert(invocations)
		.values(seedInvocations)
		.onConflictDoNothing({ target: invocations.id })
		.run();

	const totalInvocations = db.select().from(invocations).all().length;
	console.log(
		`Invocations seeded. Attempted ${seedInvocations.length} inserts. Total invocations in DB: ${totalInvocations}.`,
	);
}

main().catch((error) => {
	console.error("Seed failed", error);
	process.exit(1);
});
