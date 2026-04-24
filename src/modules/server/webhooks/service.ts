import type { AppLogger } from "../../../logger";
import { Logger } from "../../../logger";
import type {
	PlaylistSyncCompletedEvent,
	PlaylistSyncFailedEvent,
	PlaylistSyncStartedEvent,
} from "../events/schema";

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

/**
 * Format duration in milliseconds to human-readable string
 */
function formatDuration(ms: number): string {
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
	return remainingMinutes > 0 ? `${hours}h ${remainingMinutes}m` : `${hours}h`;
}

/**
 * Format event payloads to plain-text Discord messages
 */
export const WebhookMessageFormatter = {
	formatStarted(event: PlaylistSyncStartedEvent): string {
		return `🔄 Started syncing **${event.payload.playlistName}**`;
	},

	formatCompleted(event: PlaylistSyncCompletedEvent): string {
		const duration = formatDuration(event.payload.duration);
		const trackLine =
			event.payload.trackCount !== undefined
				? `\n> ${event.payload.trackCount} tracks`
				: "";
		const truncationLine = event.payload.truncationSuspected
			? "\n> ⚠️ possibly truncated (Spotify 100-track cap — only first 100 tracks scraped)"
			: "";
		const summary = event.payload.summary ? `\n> ${event.payload.summary}` : "";
		return `✅ Completed syncing **${event.payload.playlistName}** in ${duration}${trackLine}${truncationLine}${summary}`;
	},

	formatFailed(event: PlaylistSyncFailedEvent): string {
		const exitCode =
			event.payload.exitCode !== undefined
				? ` (exit code: ${event.payload.exitCode})`
				: "";
		const reasonLine = event.payload.failureReason
			? `\n> reason: \`${event.payload.failureReason}\``
			: "";
		// T-2-05: one-line, bounded length — never leak full traceback to webhook.
		const safeError = event.payload.error.replace(/\s+/g, " ").slice(0, 200);
		return `❌ Failed syncing **${event.payload.playlistName}**${exitCode}${reasonLine}\n> ${safeError}`;
	},
};

/**
 * Send a Discord webhook message with retries
 */
export async function sendDiscordWebhook(
	webhookUrl: string,
	content: string,
	logger: AppLogger = Logger.get("DiscordWebhook"),
): Promise<boolean> {
	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		try {
			const response = await fetch(webhookUrl, {
				method: "POST",
				headers: {
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ content }),
			});

			if (response.ok) {
				logger.debug({ status: response.status }, "Webhook sent successfully");
				return true;
			}

			// Rate limited - wait and retry
			if (response.status === 429) {
				const retryAfter = response.headers.get("Retry-After");
				const waitMs = retryAfter
					? Number.parseInt(retryAfter, 10) * 1000
					: RETRY_DELAY_MS;
				logger.warn({ waitMs, attempt }, "Rate limited, waiting before retry");
				await sleep(waitMs);
				continue;
			}

			// Client error (4xx) - don't retry
			if (response.status >= 400 && response.status < 500) {
				logger.error(
					{ status: response.status, statusText: response.statusText },
					"Webhook request failed with client error",
				);
				return false;
			}

			// Server error (5xx) - retry
			if (attempt < MAX_RETRIES) {
				logger.warn(
					{ status: response.status, attempt },
					"Webhook request failed, retrying",
				);
				await sleep(RETRY_DELAY_MS * (attempt + 1));
				continue;
			}

			logger.error(
				{ status: response.status },
				"Webhook request failed after all retries",
			);
			return false;
		} catch (error) {
			if (attempt < MAX_RETRIES) {
				logger.warn({ err: error, attempt }, "Webhook request error, retrying");
				await sleep(RETRY_DELAY_MS * (attempt + 1));
				continue;
			}

			logger.error({ err: error }, "Webhook request failed after all retries");
			return false;
		}
	}

	return false;
}

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}
