import { createServerFn } from "@tanstack/solid-start";
import { saveRun } from "./repository/runRepository";
import type { RunRequest, RunResult } from "./repository/SpotdlInvocator";
import {
	RunRequestSchema,
	SpotdlInvocator,
} from "./repository/SpotdlInvocator";

export const runSpotdl = createServerFn()
	.inputValidator((data) => RunRequestSchema.parse(data))
	.handler(async ({ data }): Promise<RunResult> => {
		const invocator = new SpotdlInvocator();
		const result = await invocator.run(data as RunRequest);
		await saveRun(result);
		return result;
	});

export default runSpotdl;
