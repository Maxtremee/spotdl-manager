import { Link as RouterLink } from "@tanstack/solid-router";
import { MenuIcon } from "lucide-solid";
import { For } from "solid-js";
import { css } from "styled-system/css";
import { stack } from "styled-system/patterns";
import { Button } from "./ui/button";
import { Link } from "./ui/link";
import * as Menu from "./ui/menu";

const navItems = [
	{ value: "home", label: "Home", to: "/" },
	{ value: "library", label: "Library", to: "/library" },
	{ value: "settings", label: "Settings", to: "/settings" },
];

export function Nav() {
	return (
		<>
			{/* Mobile */}
			<div
				class={css({
					display: { base: "flex", md: "none" },
					gap: "3",
					alignItems: "center",
					justifyContent: "space-between",
					px: "5",
					py: "3",
					borderBottomWidth: "1px",
					borderBottomStyle: "solid",
					borderBottomColor: "border",
					bg: "gray.surface.bg",
					position: "sticky",
					top: 0,
					zIndex: 10,
				})}
			>
				<Link
					class={css({
						color: "grass.plain.fg",
						fontSize: "lg",
					})}
					variant="plain"
					asChild={(props) => (
						<RouterLink {...props()} to="/">
							spotDL Manager
						</RouterLink>
					)}
				/>
				<Menu.Root>
					<Menu.Trigger
						asChild={(triggerProps) => (
							<Button variant="outline" {...triggerProps()}>
								<MenuIcon />
								<span class={css({ srOnly: true })}>Open menu</span>
							</Button>
						)}
					/>
					<Menu.Positioner>
						<Menu.Content>
							<For each={navItems}>
								{(section) => (
									<Menu.Item
										value={section.value}
										asChild={(itemProps) => (
											<RouterLink {...itemProps()} to={section.to}>
												{section.label}
											</RouterLink>
										)}
									/>
								)}
							</For>
						</Menu.Content>
					</Menu.Positioner>
				</Menu.Root>
			</div>
			{/* Desktop */}
			<aside
				class={css({
					display: { base: "none", md: "block" },
					borderRightWidth: "1px",
					borderRightStyle: "solid",
					borderRightColor: "border",
					bg: "gray.surface.bg",
					px: "6",
					py: "8",
				})}
			>
				<Link
					class={css({
						color: "grass.plain.fg",
						fontSize: "xl",
						marginBottom: "8",
					})}
					variant="plain"
					asChild={(props) => (
						<RouterLink {...props()} to="/">
							spotDL Manager
						</RouterLink>
					)}
				/>
				<nav class={stack({ gap: "3", w: "full" })}>
					<For each={navItems}>
						{(section) => (
							<Link
								asChild={(props) => (
									<RouterLink {...props()} to={section.to}>
										{section.label}
									</RouterLink>
								)}
							/>
						)}
					</For>
				</nav>
			</aside>
		</>
	);
}
