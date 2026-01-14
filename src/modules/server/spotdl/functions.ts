import { promises as fs } from "node:fs";
import path from "node:path";
import { createServerFn } from "@tanstack/solid-start";
import { z } from "zod";
import { Logger } from "~/logger";
import { SpotdlRepository } from "./repository";

const logger = Logger.get("SpotdlSettings");

/**
 * Server function to get spotdl settings
 */
export const getSpotdlSettingsServerFn = createServerFn({
	method: "GET",
}).handler(async () => {
	const spotdlRepository = new SpotdlRepository();
	return spotdlRepository.getSettings();
});

/**
 * Input schema for updating spotdl settings
 */
const updateSpotdlSettingsInputSchema = z.object({
	cookiesFile: z.string().optional().or(z.literal("")),
});

/**
 * Server function to update spotdl settings
 */
export const updateSpotdlSettingsServerFn = createServerFn({ method: "POST" })
	.inputValidator(updateSpotdlSettingsInputSchema)
	.handler(async ({ data }) => {
		try {
			// Convert empty string to undefined for cookiesFile
			const cookiesFile =
				data.cookiesFile === "" ? undefined : data.cookiesFile;

			// Validate that the cookies file exists if provided
			if (cookiesFile) {
				try {
					await fs.access(cookiesFile);
				} catch {
					logger.warn({ cookiesFile }, "Cookies file does not exist");
					return {
						success: false,
						error: "Cookies file does not exist at the specified path",
					};
				}
			}

			const spotdlRepository = new SpotdlRepository();
			const result = await spotdlRepository.saveSettings({
				cookiesFile,
			});

			logger.info({ cookiesFile }, "Spotdl settings updated");
			return { success: true, data: result };
		} catch (error) {
			logger.error({ error }, "Failed to update spotdl settings");
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to update spotdl settings",
			};
		}
	});

/**
 * Input schema for uploading cookies file
 */
const uploadCookiesFileInputSchema = z.object({
	content: z.string().min(1),
});

/**
 * Server function to upload and save cookies file
 */
export const uploadCookiesFileServerFn = createServerFn({ method: "POST" })
	.inputValidator(uploadCookiesFileInputSchema)
	.handler(async ({ data }) => {
		try {
			const cookiesDir = path.resolve(process.cwd(), "data", "cookies");
			await fs.mkdir(cookiesDir, { recursive: true });

			const cookiesPath = path.join(cookiesDir, "cookies.txt");
			await fs.writeFile(cookiesPath, data.content, "utf8");

			// Update settings with the new cookies file path
			const spotdlRepository = new SpotdlRepository();
			await spotdlRepository.saveSettings({
				cookiesFile: cookiesPath,
			});

			logger.info({ cookiesPath }, "Cookies file uploaded");
			return { success: true, data: { path: cookiesPath } };
		} catch (error) {
			logger.error({ error }, "Failed to upload cookies file");
			return {
				success: false,
				error:
					error instanceof Error
						? error.message
						: "Failed to upload cookies file",
			};
		}
	});

/**
 * Server function to delete cookies file
 */
export const deleteCookiesFileServerFn = createServerFn({
	method: "POST",
}).handler(async () => {
	try {
		const spotdlRepository = new SpotdlRepository();
		const settings = await spotdlRepository.getSettings();
		if (settings.cookiesFile) {
			try {
				await fs.unlink(settings.cookiesFile);
				logger.info(
					{ cookiesFile: settings.cookiesFile },
					"Cookies file deleted",
				);
			} catch (error) {
				logger.warn(
					{ error, cookiesFile: settings.cookiesFile },
					"Failed to delete cookies file from filesystem",
				);
			}
		}

		// Clear the cookies file path from settings
		await spotdlRepository.saveSettings({
			cookiesFile: undefined,
		});

		return { success: true };
	} catch (error) {
		logger.error({ error }, "Failed to delete cookies file");
		return {
			success: false,
			error:
				error instanceof Error
					? error.message
					: "Failed to delete cookies file",
		};
	}
});
