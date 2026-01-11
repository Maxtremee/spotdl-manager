import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import { getEventBus } from "../events";
import type {
	PlaylistSyncCompletedEvent,
	PlaylistSyncFailedEvent,
	PlaylistSyncStartedEvent,
} from "../events/schema";
import { WebhookRepository } from "./repository";
import type { WebhookEventType } from "./schema";
import { sendDiscordWebhook, WebhookMessageFormatter } from "./service";

/**
 * Register Discord webhook handler for sync events.
 * Reads settings from DB on each event to support runtime configuration changes.
 *
 * @returns Unsubscribe function to remove all handlers
 */
export function registerDiscordWebhookHandler(
	logger: AppLogger = Logger.get("DiscordWebhook"),
): () => void {
	const bus = getEventBus();

	const handleEvent = async (
		eventType: WebhookEventType,
		formatMessage: () => string,
	) => {
		try {
			const settings = await WebhookRepository.getSettings();

			if (!settings.url) {
				return;
			}

			if (!settings.enabledEvents.includes(eventType)) {
				return;
			}

			const message = formatMessage();
			await sendDiscordWebhook(settings.url, message, logger);
		} catch (error) {
			logger.error(
				{ err: error, eventType },
				"Failed to process webhook event",
			);
		}
	};

	const unsubscribeStarted = bus.on(
		"playlist.sync.started",
		async (event: PlaylistSyncStartedEvent) => {
			await handleEvent("playlist.sync.started", () =>
				WebhookMessageFormatter.formatStarted(event),
			);
		},
	);

	const unsubscribeCompleted = bus.on(
		"playlist.sync.completed",
		async (event: PlaylistSyncCompletedEvent) => {
			await handleEvent("playlist.sync.completed", () =>
				WebhookMessageFormatter.formatCompleted(event),
			);
		},
	);

	const unsubscribeFailed = bus.on(
		"playlist.sync.failed",
		async (event: PlaylistSyncFailedEvent) => {
			await handleEvent("playlist.sync.failed", () =>
				WebhookMessageFormatter.formatFailed(event),
			);
		},
	);

	logger.info("Discord webhook handler registered");

	return () => {
		unsubscribeStarted();
		unsubscribeCompleted();
		unsubscribeFailed();
		logger.info("Discord webhook handler unregistered");
	};
}
