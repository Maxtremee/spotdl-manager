import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
	DEFAULT_SPOTDL_SETTINGS,
	SPOTDL_SETTINGS_KEY,
	type SpotdlSettings,
	SpotdlSettingsSchema,
} from "./schema";

/**
 * Repository for spotdl settings stored in global_settings table
 */
export const SpotdlRepository = {
	/**
	 * Get the current spotdl settings
	 */
	async getSettings(): Promise<SpotdlSettings> {
		const db = getDb();
		const [row] = await db
			.select()
			.from(schema.globalSettings)
			.where(eq(schema.globalSettings.key, SPOTDL_SETTINGS_KEY));

		if (!row) {
			return DEFAULT_SPOTDL_SETTINGS;
		}

		try {
			const parsed = JSON.parse(row.value);
			return SpotdlSettingsSchema.parse(parsed);
		} catch {
			return DEFAULT_SPOTDL_SETTINGS;
		}
	},

	/**
	 * Save spotdl settings (upsert)
	 */
	async saveSettings(settings: SpotdlSettings): Promise<SpotdlSettings> {
		const db = getDb();
		const validated = SpotdlSettingsSchema.parse(settings);
		const value = JSON.stringify(validated);

		await db
			.insert(schema.globalSettings)
			.values({
				key: SPOTDL_SETTINGS_KEY,
				value,
				updatedAt: new Date(),
			})
			.onConflictDoUpdate({
				target: schema.globalSettings.key,
				set: {
					value,
					updatedAt: sql`(unixepoch())`,
				},
			});

		return validated;
	},
};
