/**
 * Format duration in milliseconds to human-readable string
 */
export function formatDuration(ms: number): string {
	if (!ms || ms <= 0) {
		return "--";
	}
	const sec = Math.round(ms / 1000);
	if (sec < 60) {
		return `${sec}s`;
	}
	const m = Math.floor(sec / 60);
	const s = sec % 60;
	if (m < 60) {
		return `${m}m ${s}s`;
	}
	const h = Math.floor(m / 60);
	const mm = m % 60;
	return `${h}h ${mm}m`;
}

/**
 * Format duration from start and end dates
 */
export function formatDurationFromDates(
	startedAt: Date,
	finishedAt: Date | null,
): string {
	if (!finishedAt) {
		return "In progress...";
	}
	const durationMs = finishedAt.getTime() - startedAt.getTime();
	return formatDuration(durationMs);
}
