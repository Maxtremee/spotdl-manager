import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import * as Card from "~/components/ui/card";

export function LibraryInfoPanel() {
	return (
		<Card.Root class={css({ mt: "6", bgColor: "bg.muted" })}>
			<Card.Header>
				<Card.Title>Information</Card.Title>
			</Card.Header>
			<Card.Body>
				<ul class={stack({ gap: "2", color: "fg.muted", fontSize: "sm" })}>
					<li>
						• Each playlist will automatically sync according to the set
						schedule
					</li>
					<li>• You can edit quality and format settings for each playlist</li>
					<li>• Track download progress in the playlist details view</li>
					<li>• Archive old playlists to keep things clean</li>
				</ul>
			</Card.Body>
		</Card.Root>
	);
}
