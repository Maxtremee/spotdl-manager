import path from "node:path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle> | null = null;

/**
 * Initialize and return database instance
 * Uses SQLite with better-sqlite3 driver
 */
export function getDb() {
	if (!db) {
		const dbPath = path.join(process.cwd(), "data", "spotdl.db");
		const sqlite = new Database(dbPath);
		db = drizzle(sqlite, { schema });
	}
	return db;
}

export { schema };
