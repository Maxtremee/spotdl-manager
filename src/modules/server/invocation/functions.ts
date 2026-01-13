import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { InvocationRepository } from "./repository";

const summaryInputSchema = z.object({
	page: z.number().int().positive().default(1),
	limit: z.number().int().positive().max(100).default(20),
	status: z.enum(["running", "success", "failed", "canceled"]).optional(),
	playlistId: z.string().optional(),
	window: z.enum(["24h", "7d", "30d", "all"]).default("24h"),
});

function sinceFromWindow(
	window: "24h" | "7d" | "30d" | "all",
): Date | undefined {
	const now = Date.now();
	switch (window) {
		case "24h":
			return new Date(now - 24 * 60 * 60 * 1000);
		case "7d":
			return new Date(now - 7 * 24 * 60 * 60 * 1000);
		case "30d":
			return new Date(now - 30 * 24 * 60 * 60 * 1000);
		default:
			return undefined;
	}
}

export const getStatusSummaryServerFn = createServerFn({ method: "GET" })
	.inputValidator(summaryInputSchema)
	.handler(async ({ data }) => {
		const since = sinceFromWindow(data.window);

		// Windowed summary
		const windowSummary = await InvocationRepository.getSummary({
			since,
			playlistId: data.playlistId,
		});

		// All-time summary (for baseline)
		const allSummary = await InvocationRepository.getSummary({
			playlistId: data.playlistId,
		});

		// Recent invocations list
		const recent = await InvocationRepository.listRecent({
			page: data.page,
			limit: data.limit,
			playlistId: data.playlistId,
			status: data.status,
			since,
		});

		// Fetch playlist names for recent items
		const playlistIds = Array.from(
			new Set(recent.items.map((r) => r.playlistId)),
		);
		const playlists = await InvocationRepository.getPlaylistNames(playlistIds);

		// Compute success rate helper
		const totalCount = windowSummary.counts.reduce(
			(acc, c) => acc + c.count,
			0,
		);
		const successCount =
			windowSummary.counts.find((c) => c.status === "success")?.count ?? 0;
		const successRate = totalCount > 0 ? successCount / totalCount : 0;

		return {
			window: data.window,
			filters: {
				status: data.status ?? null,
				playlistId: data.playlistId ?? null,
			},
			summary: {
				windowCounts: windowSummary.counts,
				windowAvgDurationMs: windowSummary.avgDurationMs,
				successRate,
				allCounts: allSummary.counts,
				allAvgDurationMs: allSummary.avgDurationMs,
			},
			recent: recent,
			playlists,
		} as const;
	});
