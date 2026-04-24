export const statusOptions = [
	{ label: "Active", value: "active" },
	{ label: "Paused", value: "paused" },
	{ label: "Archived", value: "archived" },
] as const;

export type StatusOption = (typeof statusOptions)[number]["value"];
