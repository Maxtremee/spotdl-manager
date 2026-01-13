import type { Accessor } from "solid-js";
import { hstack } from "styled-system/patterns";
import { Button } from "~/components/ui/button";
import * as Dialog from "~/components/ui/dialog";

interface DeletePlaylistDialogProps {
	open: Accessor<boolean>;
	onOpenChange: (open: boolean) => void;
	playlistName: string;
	onConfirm: () => void;
}

export function DeletePlaylistDialog(props: DeletePlaylistDialogProps) {
	return (
		<Dialog.Root
			open={props.open()}
			onOpenChange={(details) => props.onOpenChange(details.open)}
		>
			<Dialog.Trigger
				asChild={(triggerProps) => (
					<Button {...triggerProps()} variant="outline" size="sm">
						Delete
					</Button>
				)}
			/>
			<Dialog.Backdrop />
			<Dialog.Positioner>
				<Dialog.Content>
					<Dialog.Header>
						<Dialog.Title>Delete Playlist</Dialog.Title>
					</Dialog.Header>
					<Dialog.Body>
						<Dialog.Description>
							Are you sure you want to delete "{props.playlistName}"? This will
							remove the playlist and all its sync logs. This action cannot be
							undone.
						</Dialog.Description>
					</Dialog.Body>
					<Dialog.Footer class={hstack({ gap: "3", justify: "flex-end" })}>
						<Dialog.ActionTrigger
							asChild={(actionProps) => (
								<Button {...actionProps()} variant="outline">
									Cancel
								</Button>
							)}
						/>
						<Button variant="solid" onClick={props.onConfirm}>
							Delete
						</Button>
					</Dialog.Footer>
				</Dialog.Content>
			</Dialog.Positioner>
		</Dialog.Root>
	);
}
