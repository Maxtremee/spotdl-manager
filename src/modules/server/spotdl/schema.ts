import { z } from "zod";

/**
 * Schema for spotdl settings stored in global_settings table
 */
export const SpotdlSettingsSchema = z.object({
	cookiesFile: z.string().optional(),
});

export type SpotdlSettings = z.infer<typeof SpotdlSettingsSchema>;

/**
 * Default spotdl settings
 */
export const DEFAULT_SPOTDL_SETTINGS: SpotdlSettings = {
	cookiesFile: undefined,
};

/**
 * Global settings key for spotdl configuration
 */
export const SPOTDL_SETTINGS_KEY = "spotdl" as const;
