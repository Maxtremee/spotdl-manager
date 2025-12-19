import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type RunRequest, SpotdlInvocator } from "./SpotdlInvocator";

// Stub playlist data for testing
const STUB_PLAYLISTS = [
	{
		id: "playlist-1",
		name: "Test Playlist 1",
		url: "https://open.spotify.com/playlist/1lJDx1lqWkjnh8D7VITEhC",
	},
	{
		id: "playlist-2",
		name: "Test Playlist 2",
		url: "https://open.spotify.com/playlist/1lJDx1lqWkjnh8D7VITEhC",
	},
	{
		id: "playlist-3",
		name: "Test Playlist 3",
		url: "https://open.spotify.com/playlist/1lJDx1lqWkjnh8D7VITEhC",
	},
];

// Mock child_process module
vi.mock("node:child_process", () => {
	return {
		spawn: vi.fn(),
	};
});

// Mock fs/promises module
vi.mock("node:fs", () => {
	return {
		promises: {
			mkdir: vi.fn(),
			writeFile: vi.fn(),
			access: vi.fn(),
		},
	};
});

// Mock node:crypto
vi.mock("node:crypto", () => {
	let uuidCounter = 0;
	return {
		randomUUID: vi.fn(() => {
			uuidCounter++;
			return `mock-uuid-${uuidCounter}`;
		}),
	};
});

// Mock node:events
vi.mock("node:events", () => {
	return {
		once: vi.fn(),
	};
});

import { spawn } from "node:child_process";
import { once } from "node:events";
import { promises as fs } from "node:fs";

describe("SpotdlInvocator", () => {
	let invocator: SpotdlInvocator;
	const tempDir = "/tmp/test-spotdl";
	const logsDir = path.join(tempDir, "logs");
	const syncDir = path.join(tempDir, "sync");

	beforeEach(() => {
		vi.clearAllMocks();

		// Setup invocator with test directories
		invocator = new SpotdlInvocator({
			binaryPath: "spotdl",
			logsDir,
			syncDir,
		});
	});

	afterEach(() => {
		vi.clearAllMocks();
	});

	describe("run method", () => {
		it("should successfully run spotdl with a valid URL", async () => {
			// Setup mock child process
			const mockProcess = {
				stdout: {
					on: vi.fn((event, cb) => {
						if (event === "data") {
							cb("Downloaded: song1.mp3\n");
						}
					}),
				},
				stderr: {
					on: vi.fn(),
				},
				on: vi.fn((event, cb) => {
					if (event === "error") {
						// No error in success case
					} else if (event === "close") {
						cb(); // Trigger close event
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				flags: {
					format: "mp3",
					overwrite: false,
				},
			};

			const result = await invocator.run(request);

			expect(result.status).toBe("success");
			expect(result.exitCode).toBe(0);
			expect(result.runId).toBeDefined();
			expect(result.startedAt).toBeDefined();
			expect(result.finishedAt).toBeDefined();
			expect(result.logPath).toContain("logs");
		});

		it("should handle spawning errors gracefully", async () => {
			const mockError = new Error("spotdl not found");

			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "error") {
						cb(mockError);
					} else if (event === "close") {
						cb();
					}
				}),
				exitCode: null,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
			};

			const result = await invocator.run(request);

			expect(result.status).toBe("failed");
			expect(result.exitCode).toBe(127); // Standard "command not found" exit code
			expect(spawn).toHaveBeenCalled();
		});

		it("should handle non-zero exit codes as failed status", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: {
					on: vi.fn((event, cb) => {
						if (event === "data") {
							cb("Error: Invalid URL\n");
						}
					}),
				},
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 1,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
			};

			const result = await invocator.run(request);

			expect(result.status).toBe("failed");
			expect(result.exitCode).toBe(1);
		});

		it("should include stdout and stderr in logs", async () => {
			const mockStdout = "Downloaded 5 songs\n";
			const mockStderr = "Warning: Some songs skipped\n";

			const mockProcess = {
				stdout: {
					on: vi.fn((event, cb) => {
						if (event === "data") {
							cb(mockStdout);
						}
					}),
				},
				stderr: {
					on: vi.fn((event, cb) => {
						if (event === "data") {
							cb(mockStderr);
						}
					}),
				},
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
			};

			const _result = await invocator.run(request);

			expect(fs.writeFile).toHaveBeenCalled();
			const logContent = vi.mocked(fs.writeFile).mock.calls[0][1] as string;
			expect(logContent).toContain("## stdout");
			expect(logContent).toContain(mockStdout);
			expect(logContent).toContain("## stderr");
			expect(logContent).toContain(mockStderr);
		});
	});

	describe("sync file handling", () => {
		it("should pass playlistId to the result", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);
			vi.mocked(fs.access).mockRejectedValue(new Error("Not found"));

			const playlistId = STUB_PLAYLISTS[0].id;
			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				playlistId,
			};

			const result = await invocator.run(request);

			expect(result.playlistId).toBe(playlistId);
		});

		it("should create sync file on first run when playlistId is provided", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);
			vi.mocked(fs.access).mockRejectedValue(new Error("Not found"));

			const playlistId = STUB_PLAYLISTS[1].id;
			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[1].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				playlistId,
			};

			await invocator.run(request);

			// Verify spawn was called twice (once for sync creation, once for actual download)
			expect(spawn).toHaveBeenCalledTimes(2);
			const firstCallArgs = vi.mocked(spawn).mock.calls[0];
			expect(firstCallArgs[1]).toContain("--save-file");
		});

		it("should use existing sync file on subsequent runs", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);
			vi.mocked(fs.access).mockResolvedValue(undefined); // Sync file exists

			const playlistId = STUB_PLAYLISTS[2].id;
			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[2].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				playlistId,
			};

			await invocator.run(request);

			// Verify spawn was called only once (sync file already exists)
			expect(spawn).toHaveBeenCalledTimes(1);
			const callArgs = vi.mocked(spawn).mock.calls[0];
			expect(callArgs[1]).toContain("sync");
			// Should use sync file path (full path with .spotdl extension)
			const expectedSyncPath = path.join(syncDir, `${playlistId}.spotdl`);
			expect(callArgs[1]).toContain(expectedSyncPath);
		});
	});

	describe("format and quality flags", () => {
		it("should include format flag in spawn arguments", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				flags: {
					format: "flac",
				},
			};

			await invocator.run(request);

			const spawnArgs = vi.mocked(spawn).mock.calls[0];
			expect(spawnArgs[1]).toContain("--format");
			expect(spawnArgs[1]).toContain("flac");
		});

		it("should include overwrite flag when specified", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				flags: {
					overwrite: true,
				},
			};

			await invocator.run(request);

			const spawnArgs = vi.mocked(spawn).mock.calls[0];
			expect(spawnArgs[1]).toContain("--overwrite");
		});

		it("should include extra args when provided", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
				flags: {
					extraArgs: ["--no-config", "--cache-dir", "/tmp/cache"],
				},
			};

			await invocator.run(request);

			const spawnArgs = vi.mocked(spawn).mock.calls[0];
			expect(spawnArgs[1]).toContain("--no-config");
			expect(spawnArgs[1]).toContain("--cache-dir");
			expect(spawnArgs[1]).toContain("/tmp/cache");
		});
	});

	describe("directory creation", () => {
		it("should create logs directory if it doesn't exist", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);

			const request: RunRequest = {
				sourceUrl: new URL(STUB_PLAYLISTS[0].url).toString(),
				outputDir: path.join(tempDir, "downloads"),
			};

			await invocator.run(request);

			expect(fs.mkdir).toHaveBeenCalledWith(logsDir, { recursive: true });
		});
	});

	describe("multiple playlists", () => {
		it("should process multiple playlists sequentially", async () => {
			const mockProcess = {
				stdout: { on: vi.fn() },
				stderr: { on: vi.fn() },
				on: vi.fn((event, cb) => {
					if (event === "close") {
						cb();
					}
				}),
				exitCode: 0,
			};

			vi.mocked(spawn).mockReturnValue(mockProcess as any);
			vi.mocked(once).mockResolvedValue(mockProcess as any);
			vi.mocked(fs.mkdir).mockResolvedValue(undefined);
			vi.mocked(fs.writeFile).mockResolvedValue(undefined);
			vi.mocked(fs.access).mockRejectedValue(new Error("Not found"));

			const results = [];
			for (const playlist of STUB_PLAYLISTS) {
				const request: RunRequest = {
					sourceUrl: new URL(playlist.url).toString(),
					outputDir: path.join(tempDir, "downloads"),
					playlistId: playlist.id,
				};
				const result = await invocator.run(request);
				results.push(result);
			}

			expect(results).toHaveLength(3);
			expect(results.every((r) => r.status === "success")).toBe(true);
			expect(new Set(results.map((r) => r.runId)).size).toBe(3); // All have unique runIds
			expect(results[0].playlistId).toBe(STUB_PLAYLISTS[0].id);
			expect(results[1].playlistId).toBe(STUB_PLAYLISTS[1].id);
			expect(results[2].playlistId).toBe(STUB_PLAYLISTS[2].id);
		});
	});
});
