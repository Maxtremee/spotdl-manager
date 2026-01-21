import { z } from "zod";

/**
 * Schema for spotdl settings stored in global_settings table
 */
export const SpotdlSettingsSchema = z.object({
	useCookies: z.boolean().default(false),
});

export type SpotdlSettings = z.infer<typeof SpotdlSettingsSchema>;

/**
 * Default spotdl settings
 */
export const DEFAULT_SPOTDL_SETTINGS: SpotdlSettings = {
	useCookies: false,
};

/**
 * Global settings key for spotdl configuration
 */
export const SPOTDL_SETTINGS_KEY = "spotdl" as const;
