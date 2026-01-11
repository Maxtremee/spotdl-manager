import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { WebhookRepository } from "./repository";
import { WebhookEventTypes } from "./schema";

/**
 * Server function to get webhook settings
 */
export const getWebhookSettingsServerFn = createServerFn({
	method: "GET",
}).handler(async () => {
	return WebhookRepository.getSettings();
});

/**
 * Input schema for updating webhook settings
 */
const updateWebhookSettingsInputSchema = z.object({
	url: z.string().url().optional().or(z.literal("")),
	enabledEvents: z.array(z.enum(WebhookEventTypes)),
});

/**
 * Server function to update webhook settings
 */
export const updateWebhookSettingsServerFn = createServerFn({ method: "POST" })
	.inputValidator(updateWebhookSettingsInputSchema)
	.handler(async ({ data }) => {
		try {
			// Convert empty string to undefined for URL
			const url = data.url === "" ? undefined : data.url;

			const result = await WebhookRepository.saveSettings({
				url,
				enabledEvents: data.enabledEvents,
			});
			return { success: true, data: result };
		} catch (error) {
			console.error("Failed to update webhook settings:", error);
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to update webhook settings",
			};
		}
	});

/**
 * Server function to test webhook by sending a test message
 */
export const testWebhookServerFn = createServerFn({ method: "POST" })
	.inputValidator(z.object({ url: z.string().url() }))
	.handler(async ({ data }) => {
		try {
			const response = await fetch(data.url, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					content: "🧪 Test message from spotdl-manager",
				}),
			});

			if (!response.ok) {
				return {
					success: false,
					error: `Discord returned ${response.status}: ${response.statusText}`,
				};
			}

			return { success: true };
		} catch (error) {
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to send test message",
			};
		}
	});
