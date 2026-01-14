import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle> | null = null;

/**
 * Initialize and return database instance
 * Uses SQLite with better-sqlite3 driver
 */
export function getDb() {
	if (!db) {
		db = drizzle("data/db.sqlite", { schema });
	}
	return db;
}
export type TDatabase = ReturnType<typeof getDb>;

export { schema };
