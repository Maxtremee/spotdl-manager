export const statusOptions = [
	{ label: "Active", value: "active" },
	{ label: "Paused", value: "paused" },
	{ label: "Archived", value: "archived" },
] as const;

export const formatOptions = [
	{ label: "MP3", value: "mp3" },
	{ label: "FLAC", value: "flac" },
	{ label: "OGG", value: "ogg" },
	{ label: "M4A", value: "m4a" },
	{ label: "Opus", value: "opus" },
	{ label: "Vorbis", value: "vorbis" },
	{ label: "WAV", value: "wav" },
] as const;

export const qualityOptions = [
	{ label: "Worst", value: "worst" },
	{ label: "Low", value: "low" },
	{ label: "Medium", value: "medium" },
	{ label: "High", value: "high" },
	{ label: "Very High", value: "very_high" },
	{ label: "Lossless", value: "lossless" },
] as const;

export type StatusOption = (typeof statusOptions)[number]["value"];
export type FormatOption = (typeof formatOptions)[number]["value"];
export type QualityOption = (typeof qualityOptions)[number]["value"];
