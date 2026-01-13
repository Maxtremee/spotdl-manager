import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { createSignal } from "solid-js";
import { z } from "zod";
import { DeletePlaylistDialog } from "~/modules/client/playlist/components/delete-playlist-dialog";
import { PlaylistConfigCard } from "~/modules/client/playlist/components/playlist-config-card";
import { PlaylistHeader } from "~/modules/client/playlist/components/playlist-header";
import { SyncHistoryCard } from "~/modules/client/playlist/components/sync-history-card";
import {
	deletePlaylist,
	triggerSync,
	updateFormat,
	updateQuality,
	updateStatus,
} from "~/modules/client/playlist/service/playlist-actions";
import { getPlaylistDetailsServerFn } from "~/modules/server/playlist/functions";

const searchSchema = z.object({
	invocationsPage: fallback(z.int().positive(), 1).default(1),
});

export const Route = createFileRoute("/library_/$playlistId")({
	validateSearch: zodValidator(searchSchema),
	loaderDeps: ({ search }) => search,
	loader: ({ params, deps: search }) =>
		getPlaylistDetailsServerFn({
			data: {
				id: params.playlistId,
				invocationsPage: search.invocationsPage,
				invocationsLimit: 10,
			},
		}),
	component: PlaylistDetails,
});

function PlaylistDetails() {
	const navigate = Route.useNavigate();
	const search = Route.useSearch();
	const data = Route.useLoaderData();
	const router = useRouter();
	const [isUpdating, setIsUpdating] = createSignal(false);
	const [isSyncing, setIsSyncing] = createSignal(false);
	const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);

	const playlist = () => data().playlist;
	const invocations = () => data().invocations;

	const handleDeletePlaylist = async () => {
		setDeleteDialogOpen(false);
		await deletePlaylist(playlist().id!, {
			onSuccess: () => navigate({ to: "/library" }),
		});
	};

	const handleRunSync = async () => {
		setIsSyncing(true);
		await triggerSync(playlist().id!, {
			onSuccess: () => router.invalidate(),
		});
		setIsSyncing(false);
	};

	const handleStatusChange = async (newStatus: string) => {
		setIsUpdating(true);
		await updateStatus(
			playlist().id!,
			newStatus as "active" | "paused" | "archived",
			{
				onSuccess: () => router.invalidate(),
			},
		);
		setIsUpdating(false);
	};

	const handleFormatChange = async (newFormat: string) => {
		setIsUpdating(true);
		await updateFormat(
			playlist().id!,
			newFormat as "mp3" | "flac" | "ogg" | "m4a" | "opus" | "vorbis" | "wav",
			{
				onSuccess: () => router.invalidate(),
			},
		);
		setIsUpdating(false);
	};

	const handleQualityChange = async (newQuality: string) => {
		setIsUpdating(true);
		await updateQuality(
			playlist().id!,
			newQuality as
				| "worst"
				| "low"
				| "medium"
				| "high"
				| "very_high"
				| "lossless",
			{
				onSuccess: () => router.invalidate(),
			},
		);
		setIsUpdating(false);
	};

	const handlePageChange = (page: number) => {
		navigate({
			search: (prev) => ({ ...prev, invocationsPage: page }),
		});
		window.scrollTo({ top: 0, behavior: "smooth" });
	};

	return (
		<>
			<PlaylistHeader
				name={playlist().name}
				sourceType={playlist().source.type}
				status={playlist().status}
			/>

			<PlaylistConfigCard
				sourceUrl={playlist().source.url}
				outputDir={playlist().outputDir}
				schedule={playlist().schedule}
				status={playlist().status}
				format={playlist().flags?.format || "mp3"}
				quality={playlist().flags?.quality || "high"}
				isUpdating={isUpdating}
				isSyncing={isSyncing}
				canSync={playlist().status === "active"}
				onStatusChange={handleStatusChange}
				onFormatChange={handleFormatChange}
				onQualityChange={handleQualityChange}
				onRunSync={handleRunSync}
				deleteDialog={
					<DeletePlaylistDialog
						open={deleteDialogOpen}
						onOpenChange={setDeleteDialogOpen}
						playlistName={playlist().name}
						onConfirm={handleDeletePlaylist}
					/>
				}
			/>

			<SyncHistoryCard
				playlistId={playlist().id!}
				invocations={invocations().items}
				pagination={invocations().pagination}
				currentPage={search().invocationsPage}
				onPageChange={handlePageChange}
			/>
		</>
	);
}
