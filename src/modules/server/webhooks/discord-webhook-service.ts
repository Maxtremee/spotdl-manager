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

/**
 * Service class for Discord webhook integration.
 * Combines message formatting, sending with retry logic, and event bus integration.
 */
export class DiscordWebhookService {
	private readonly maxRetries = 2;
	private readonly retryDelayMs = 1000;
	private readonly logger: AppLogger;

	constructor(logger?: AppLogger) {
		this.logger = logger ?? Logger.get("DiscordWebhook");
	}

	/**
	 * Format a sync started event to a Discord message
	 */
	formatStarted(event: PlaylistSyncStartedEvent): string {
		return `🔄 Started syncing **${event.payload.playlistName}**`;
	}

	/**
	 * Format a sync completed event to a Discord message
	 */
	formatCompleted(event: PlaylistSyncCompletedEvent): string {
		const duration = this.formatDuration(event.payload.duration);
		const summary = event.payload.summary ? `\n> ${event.payload.summary}` : "";
		return `✅ Completed syncing **${event.payload.playlistName}** in ${duration}${summary}`;
	}

	/**
	 * Format a sync failed event to a Discord message
	 */
	formatFailed(event: PlaylistSyncFailedEvent): string {
		const exitCode =
			event.payload.exitCode !== undefined
				? ` (exit code: ${event.payload.exitCode})`
				: "";
		return `❌ Failed syncing **${event.payload.playlistName}**${exitCode}\n> ${event.payload.error}`;
	}

	/**
	 * Send a Discord webhook message with retries
	 */
	async send(webhookUrl: string, content: string): Promise<boolean> {
		for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
			try {
				const response = await fetch(webhookUrl, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
					},
					body: JSON.stringify({ content }),
				});

				if (response.ok) {
					this.logger.debug(
						{ status: response.status },
						"Webhook sent successfully",
					);
					return true;
				}

				// Rate limited - wait and retry
				if (response.status === 429) {
					const retryAfter = response.headers.get("Retry-After");
					const waitMs = retryAfter
						? Number.parseInt(retryAfter, 10) * 1000
						: this.retryDelayMs;
					this.logger.warn(
						{ waitMs, attempt },
						"Rate limited, waiting before retry",
					);
					await this.sleep(waitMs);
					continue;
				}

				// Client error (4xx) - don't retry
				if (response.status >= 400 && response.status < 500) {
					this.logger.error(
						{ status: response.status, statusText: response.statusText },
						"Webhook request failed with client error",
					);
					return false;
				}

				// Server error (5xx) - retry
				if (attempt < this.maxRetries) {
					this.logger.warn(
						{ status: response.status, attempt },
						"Webhook request failed, retrying",
					);
					await this.sleep(this.retryDelayMs * (attempt + 1));
					continue;
				}

				this.logger.error(
					{ status: response.status },
					"Webhook request failed after all retries",
				);
				return false;
			} catch (error) {
				if (attempt < this.maxRetries) {
					this.logger.warn(
						{ err: error, attempt },
						"Webhook request error, retrying",
					);
					await this.sleep(this.retryDelayMs * (attempt + 1));
					continue;
				}

				this.logger.error(
					{ err: error },
					"Webhook request failed after all retries",
				);
				return false;
			}
		}

		return false;
	}

	/**
	 * Register event handlers for sync events.
	 * Reads settings from DB on each event to support runtime configuration changes.
	 *
	 * @returns Unsubscribe function to remove all handlers
	 */
	registerHandlers(): () => void {
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
				await this.send(settings.url, message);
			} catch (error) {
				this.logger.error(
					{ err: error, eventType },
					"Failed to process webhook event",
				);
			}
		};

		const unsubscribeStarted = bus.on(
			"playlist.sync.started",
			async (event: PlaylistSyncStartedEvent) => {
				await handleEvent("playlist.sync.started", () =>
					this.formatStarted(event),
				);
			},
		);

		const unsubscribeCompleted = bus.on(
			"playlist.sync.completed",
			async (event: PlaylistSyncCompletedEvent) => {
				await handleEvent("playlist.sync.completed", () =>
					this.formatCompleted(event),
				);
			},
		);

		const unsubscribeFailed = bus.on(
			"playlist.sync.failed",
			async (event: PlaylistSyncFailedEvent) => {
				await handleEvent("playlist.sync.failed", () =>
					this.formatFailed(event),
				);
			},
		);

		this.logger.info("Discord webhook handler registered");

		return () => {
			unsubscribeStarted();
			unsubscribeCompleted();
			unsubscribeFailed();
			this.logger.info("Discord webhook handler unregistered");
		};
	}

	private formatDuration(ms: number): string {
		const seconds = Math.floor(ms / 1000);
		if (seconds < 60) {
			return `${seconds}s`;
		}
		const minutes = Math.floor(seconds / 60);
		const remainingSeconds = seconds % 60;
		if (minutes < 60) {
			return remainingSeconds > 0
				? `${minutes}m ${remainingSeconds}s`
				: `${minutes}m`;
		}
		const hours = Math.floor(minutes / 60);
		const remainingMinutes = minutes % 60;
		return remainingMinutes > 0
			? `${hours}h ${remainingMinutes}m`
			: `${hours}h`;
	}

	private sleep(ms: number): Promise<void> {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// Singleton instance for convenience
let instance: DiscordWebhookService | null = null;

export function getDiscordWebhookService(): DiscordWebhookService {
	if (!instance) {
		instance = new DiscordWebhookService();
	}
	return instance;
}
