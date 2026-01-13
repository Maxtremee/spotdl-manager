import { Show } from "solid-js";
import * as Field from "~/components/ui/field";
import { Input } from "~/components/ui/input";

interface BasicFieldsSectionProps {
	// biome-ignore lint/suspicious/noExplicitAny: TanStack Form types
	form: any;
}

export function BasicFieldsSection(props: BasicFieldsSectionProps) {
	return (
		<>
			<props.form.Field name="name">
				{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
				{(field: any) => (
					<Field.Root invalid={!!field().state.meta.errors.length}>
						<Field.Label>Playlist Name</Field.Label>
						<Input
							value={field().state.value}
							onInput={(e: InputEvent) =>
								field().handleChange(
									(e.currentTarget as HTMLInputElement).value,
								)
							}
							onBlur={field().handleBlur}
							placeholder="My Playlist"
						/>
						<Show when={field().state.meta.errors.length > 0}>
							<Field.ErrorText>{field().state.meta.errors[0]}</Field.ErrorText>
						</Show>
					</Field.Root>
				)}
			</props.form.Field>

			<props.form.Field name="sourceUrl">
				{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
				{(field: any) => (
					<Field.Root invalid={!!field().state.meta.errors.length}>
						<Field.Label>Spotify URL</Field.Label>
						<Input
							value={field().state.value}
							onInput={(e: InputEvent) =>
								field().handleChange(
									(e.currentTarget as HTMLInputElement).value,
								)
							}
							onBlur={field().handleBlur}
							placeholder="https://open.spotify.com/playlist/..."
						/>
						<Field.HelperText>
							Paste a link to a playlist, album, or track from Spotify
						</Field.HelperText>
						<Show when={field().state.meta.errors.length > 0}>
							<Field.ErrorText>{field().state.meta.errors[0]}</Field.ErrorText>
						</Show>
					</Field.Root>
				)}
			</props.form.Field>

			<props.form.Field name="outputDir">
				{/* biome-ignore lint/suspicious/noExplicitAny: TanStack Form types */}
				{(field: any) => (
					<Field.Root invalid={!!field().state.meta.errors.length}>
						<Field.Label>Output Directory</Field.Label>
						<Input
							value={field().state.value}
							onInput={(e: InputEvent) =>
								field().handleChange(
									(e.currentTarget as HTMLInputElement).value,
								)
							}
							onBlur={field().handleBlur}
							placeholder="/downloads/spotify"
						/>
						<Field.HelperText>
							Path to the folder where downloaded files will be saved
						</Field.HelperText>
						<Show when={field().state.meta.errors.length > 0}>
							<Field.ErrorText>{field().state.meta.errors[0]}</Field.ErrorText>
						</Show>
					</Field.Root>
				)}
			</props.form.Field>
		</>
	);
}
