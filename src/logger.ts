import pino from "pino";
import pinoPretty from "pino-pretty";

export type AppLogger = pino.Logger;

export class Logger {
	private static singleton: Logger | null = null;
	private readonly logger: AppLogger;

	private constructor() {
		const isDev = import.meta.env.DEV === true;

		const prettyStream = pinoPretty({
			colorize: true,
			translateTime: "SYS:yyyy-mm-dd HH:MM:ss.l",
			ignore: "pid,hostname",
		});

		this.logger = pino(
			{
				level: process.env.LOG_LEVEL || (isDev ? "debug" : "info"),
			},
			isDev ? prettyStream : undefined,
		);
	}

	static get(moduleName?: string): AppLogger {
		if (!Logger.singleton) {
			Logger.singleton = new Logger();
		}
		if (moduleName) {
			return Logger.singleton.logger.child({ module: moduleName });
		}
		return Logger.singleton.logger;
	}

	static getInstance(): Logger {
		if (!Logger.singleton) {
			Logger.singleton = new Logger();
		}
		return Logger.singleton;
	}

	child(bindings: Record<string, unknown>): AppLogger {
		return this.logger.child(bindings);
	}
}
