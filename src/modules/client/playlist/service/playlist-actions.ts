import { toaster } from "~/components/ui/toast";
import {
	deletePlaylistServerFn,
	triggerPlaylistSyncServerFn,
	updatePlaylistServerFn,
} from "~/modules/server/playlist/functions";
import type { FormatOption, QualityOption, StatusOption } from "./options";

export interface PlaylistActionCallbacks {
	onSuccess?: () => void;
	onError?: (error: string) => void;
}

export async function deletePlaylist(
	playlistId: string,
	callbacks?: PlaylistActionCallbacks,
): Promise<boolean> {
	try {
		const result = await deletePlaylistServerFn({
			data: { id: playlistId },
		});
		if (result.success) {
			toaster.success({
				title: "Playlist deleted",
				description: "The playlist and all its sync logs have been removed",
			});
			callbacks?.onSuccess?.();
			return true;
		}
		const errorMsg = result.error || "Failed to delete playlist";
		toaster.error({ title: "Delete failed", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : "Failed to delete playlist";
		toaster.error({ title: "Error", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	}
}

export async function triggerSync(
	playlistId: string,
	callbacks?: PlaylistActionCallbacks,
): Promise<boolean> {
	try {
		const result = await triggerPlaylistSyncServerFn({
			data: { playlistId },
		});
		if (result.success) {
			toaster.success({
				title: "Sync started",
				description: "Playlist sync is running in the background",
			});
			callbacks?.onSuccess?.();
			return true;
		}
		const errorMsg = result.error || "Failed to start sync";
		toaster.error({ title: "Sync failed", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : "Failed to start sync";
		toaster.error({ title: "Error", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	}
}

export async function updateStatus(
	playlistId: string,
	newStatus: StatusOption,
	callbacks?: PlaylistActionCallbacks,
): Promise<boolean> {
	try {
		const result = await updatePlaylistServerFn({
			data: {
				id: playlistId,
				status: newStatus as "active" | "paused" | "archived" | "error",
			},
		});
		if (result.success) {
			toaster.success({
				title: "Status updated",
				description: `Playlist status changed to ${newStatus}`,
			});
			callbacks?.onSuccess?.();
			return true;
		}
		const errorMsg = result.error || "Failed to update status";
		toaster.error({ title: "Update failed", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : "Failed to update status";
		toaster.error({ title: "Error", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	}
}

export async function updateFormat(
	playlistId: string,
	newFormat: FormatOption,
	callbacks?: PlaylistActionCallbacks,
): Promise<boolean> {
	try {
		const result = await updatePlaylistServerFn({
			data: {
				id: playlistId,
				flags: {
					format: newFormat as
						| "mp3"
						| "flac"
						| "ogg"
						| "m4a"
						| "opus"
						| "vorbis"
						| "wav",
				},
			},
		});
		if (result.success) {
			toaster.success({
				title: "Format updated",
				description: `Download format changed to ${newFormat.toUpperCase()}`,
			});
			callbacks?.onSuccess?.();
			return true;
		}
		const errorMsg = result.error || "Failed to update format";
		toaster.error({ title: "Update failed", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : "Failed to update format";
		toaster.error({ title: "Error", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	}
}

export async function updateQuality(
	playlistId: string,
	newQuality: QualityOption,
	callbacks?: PlaylistActionCallbacks,
): Promise<boolean> {
	try {
		const result = await updatePlaylistServerFn({
			data: {
				id: playlistId,
				flags: {
					quality: newQuality as
						| "worst"
						| "low"
						| "medium"
						| "high"
						| "very_high"
						| "lossless",
				},
			},
		});
		if (result.success) {
			toaster.success({
				title: "Quality updated",
				description: `Download quality changed to ${newQuality}`,
			});
			callbacks?.onSuccess?.();
			return true;
		}
		const errorMsg = result.error || "Failed to update quality";
		toaster.error({ title: "Update failed", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	} catch (error) {
		const errorMsg =
			error instanceof Error ? error.message : "Failed to update quality";
		toaster.error({ title: "Error", description: errorMsg });
		callbacks?.onError?.(errorMsg);
		return false;
	}
}
