import { eq, sql } from "drizzle-orm";
import { getDb, schema } from "../db";
import {
	DEFAULT_WEBHOOK_SETTINGS,
	WEBHOOK_SETTINGS_KEY,
	type WebhookSettings,
	WebhookSettingsSchema,
} from "./schema";

/**
 * Repository for webhook settings stored in global_settings table
 */
export const WebhookRepository = {
	/**
	 * Get the current webhook settings
	 */
	async getSettings(): Promise<WebhookSettings> {
		const db = getDb();
		const [row] = await db
			.select()
			.from(schema.globalSettings)
			.where(eq(schema.globalSettings.key, WEBHOOK_SETTINGS_KEY));

		if (!row) {
			return DEFAULT_WEBHOOK_SETTINGS;
		}

		try {
			const parsed = JSON.parse(row.value);
			return WebhookSettingsSchema.parse(parsed);
		} catch {
			return DEFAULT_WEBHOOK_SETTINGS;
		}
	},

	/**
	 * Save webhook settings (upsert)
	 */
	async saveSettings(settings: WebhookSettings): Promise<WebhookSettings> {
		const db = getDb();
		const validated = WebhookSettingsSchema.parse(settings);
		const value = JSON.stringify(validated);

		await db
			.insert(schema.globalSettings)
			.values({
				key: WEBHOOK_SETTINGS_KEY,
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
