import { createFileRoute } from "@tanstack/solid-router";
import { Button, ButtonGroup } from "~/components/ui/button";
import * as Checkbox from "~/components/ui/checkbox";

export const Route = createFileRoute("/")({ component: App });

function App() {
	return (
		<>
			<ButtonGroup>
				<Button variant="surface">Button 1</Button>
				{/* <Button loading loadingText="Loading...">
					Button 2
				</Button> */}
				<Button>Button 3</Button>
			</ButtonGroup>
			<Checkbox.Root>
				<Checkbox.HiddenInput />
				<Checkbox.Control>
					<Checkbox.Indicator />
				</Checkbox.Control>
				<Checkbox.Label />
			</Checkbox.Root>
		</>
	);
}
