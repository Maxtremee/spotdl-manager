import { eq } from "drizzle-orm";
import type { AppLogger } from "~/logger";
import { Logger } from "~/logger";
import { getDb, schema } from "../db";
import { getEventBus } from "../events";
import type { PlaylistSyncCompletedEvent } from "../events/schema";
import { DownloadRunner } from "./DownloadRunner";

/**
 * Phase 3 D-01: subscribe to playlist.sync.completed (emitted by SyncRunner)
 * and kick DownloadRunner.run for the same source.
 *
 * D-06: EventBus.emit awaits Promise.allSettled(handlers) at EventBus.ts:177,
 * so this handler's promise transitively keeps the runningPlaylists lock held
 * in PlaylistScheduler.executePlaylistSync until DownloadRunner.run returns.
 * No scheduler code change required (verified at EventBus.ts line 177).
 */
export function registerDownloadHandler(
	logger: AppLogger = Logger.get("DownloadHandler"),
	runner: DownloadRunner = new DownloadRunner(),
): () => void {
	const bus = getEventBus();
	const unsubscribe = bus.on(
		"playlist.sync.completed",
		async (event: PlaylistSyncCompletedEvent) => {
			try {
				const [source] = await getDb()
					.select()
					.from(schema.sources)
					.where(eq(schema.sources.id, event.payload.playlistId));
				if (!source) {
					logger.warn(
						{ sourceId: event.payload.playlistId },
						"Source not found for download handler — skipping",
					);
					return;
				}
				await runner.run(source);
			} catch (err) {
				// D-03 per-track failures already isolated inside runner.
				// This catch only fires for runner-level crashes the runner couldn't self-finalize.
				logger.error(
					{ err, sourceId: event.payload.playlistId },
					"DownloadRunner crashed at handler boundary",
				);
			}
		},
	);

	logger.info("Download handler registered");
	return () => {
		unsubscribe();
		logger.info("Download handler unregistered");
	};
}
