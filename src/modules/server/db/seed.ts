import { randomUUID } from "node:crypto";
import path from "node:path";
import { getDb } from "./index";
import { type NewPlaylistRow, playlists } from "./schema";

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
}

main().catch((error) => {
	console.error("Seed failed", error);
	process.exit(1);
});
