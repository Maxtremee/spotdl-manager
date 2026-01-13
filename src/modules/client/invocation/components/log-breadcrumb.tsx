import { Link } from "@tanstack/solid-router";
import { css } from "styled-system/css";
import * as Breadcrumb from "~/components/ui/breadcrumb";

interface LogBreadcrumbProps {
	playlistId: string;
	playlistName: string;
}

const linkClass = css({
	color: "fg.muted",
	fontSize: "sm",
	"&:hover": { color: "fg.default" },
	textDecoration: "none",
});

export function LogBreadcrumb(props: LogBreadcrumbProps) {
	return (
		<Breadcrumb.Root>
			<Breadcrumb.List>
				<Breadcrumb.Item>
					<Link to="/" class={linkClass}>
						Home
					</Link>
				</Breadcrumb.Item>
				<Breadcrumb.Separator />
				<Breadcrumb.Item>
					<Link to="/library" class={linkClass}>
						Library
					</Link>
				</Breadcrumb.Item>
				<Breadcrumb.Separator />
				<Breadcrumb.Item>
					<Link
						to="/library/$playlistId"
						params={{ playlistId: props.playlistId }}
						class={linkClass}
					>
						{props.playlistName}
					</Link>
				</Breadcrumb.Item>
				<Breadcrumb.Separator />
				<Breadcrumb.Item>
					<span
						class={css({
							color: "fg.default",
							fontSize: "sm",
							fontWeight: "medium",
						})}
					>
						Log
					</span>
				</Breadcrumb.Item>
			</Breadcrumb.List>
		</Breadcrumb.Root>
	);
}
