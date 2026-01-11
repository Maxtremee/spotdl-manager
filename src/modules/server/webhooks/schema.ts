import { z } from "zod";

/**
 * Webhook event types that can trigger Discord notifications
 */
export const WebhookEventTypes = [
	"playlist.sync.started",
	"playlist.sync.completed",
	"playlist.sync.failed",
] as const;

export type WebhookEventType = (typeof WebhookEventTypes)[number];

/**
 * Schema for webhook settings stored in global_settings table
 */
export const WebhookSettingsSchema = z.object({
	url: z.string().url().optional(),
	enabledEvents: z.array(z.enum(WebhookEventTypes)).default([]),
});

export type WebhookSettings = z.infer<typeof WebhookSettingsSchema>;

/**
 * Default webhook settings
 */
export const DEFAULT_WEBHOOK_SETTINGS: WebhookSettings = {
	url: undefined,
	enabledEvents: [],
};

/**
 * Global settings keys for webhooks
 */
export const WEBHOOK_SETTINGS_KEY = "discord_webhook" as const;
