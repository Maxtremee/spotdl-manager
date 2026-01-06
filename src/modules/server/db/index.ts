import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "./schema";

let db: ReturnType<typeof drizzle> | null = null;

/**
 * Initialize and return database instance
 * Uses SQLite with better-sqlite3 driver
 */
export function getDb() {
	if (!db) {
		// biome-ignore lint/style/noNonNullAssertion: env
		db = drizzle(process.env.DB_FILE_NAME!, { schema });
	}
	return db;
}

export { schema };
