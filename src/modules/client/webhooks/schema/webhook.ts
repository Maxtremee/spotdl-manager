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
 * Schema for webhook settings
 */
export const WebhookSettingsSchema = z.object({
	url: z.string().url().optional(),
	enabledEvents: z.array(z.enum(WebhookEventTypes)).default([]),
});

export type WebhookSettings = z.infer<typeof WebhookSettingsSchema>;

/**
 * Human-readable labels for webhook event types
 */
export const WebhookEventLabels: Record<WebhookEventType, string> = {
	"playlist.sync.started": "Sync Started",
	"playlist.sync.completed": "Sync Completed",
	"playlist.sync.failed": "Sync Failed",
};

/**
 * Descriptions for webhook event types
 */
export const WebhookEventDescriptions: Record<WebhookEventType, string> = {
	"playlist.sync.started": "When a playlist sync begins",
	"playlist.sync.completed": "When a playlist sync finishes successfully",
	"playlist.sync.failed": "When a playlist sync fails",
};
