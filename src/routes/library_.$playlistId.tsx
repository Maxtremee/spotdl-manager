import { createFileRoute, useRouter } from "@tanstack/solid-router";
import { fallback, zodValidator } from "@tanstack/zod-adapter";
import { createSignal } from "solid-js";
import { z } from "zod";
import { Button } from "~/components/ui/button";
import { DeletePlaylistDialog } from "~/modules/client/playlist/components/delete-playlist-dialog";
import { PlaylistConfigCard } from "~/modules/client/playlist/components/playlist-config-card";
import { PlaylistHeader } from "~/modules/client/playlist/components/playlist-header";
import { SyncHistoryCard } from "~/modules/client/playlist/components/sync-history-card";
import {
	deletePlaylist,
	triggerSync,
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
	const [deleteDialogOpen, setDeleteDialogOpen] = createSignal(false);
	const [isSyncing, setIsSyncing] = createSignal(false);

	const playlist = () => data().playlist;
	const invocations = () => data().invocations;

	const handleDeletePlaylist = async () => {
		setDeleteDialogOpen(false);
		await deletePlaylist(playlist().id!, {
			onSuccess: () => navigate({ to: "/library" }),
		});
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

	const handleSyncNow = async () => {
		setIsSyncing(true);
		await triggerSync(playlist().id!, {
			onSuccess: () => router.invalidate(),
		});
		setIsSyncing(false);
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
				schedule={playlist().schedule ?? null}
				status={playlist().status}
				isUpdating={isUpdating}
				onStatusChange={handleStatusChange}
				syncAction={
					<Button
						variant="solid"
						disabled={isSyncing() || playlist().status !== "active"}
						onClick={handleSyncNow}
					>
						{isSyncing() ? "Syncing…" : "Sync now"}
					</Button>
				}
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
