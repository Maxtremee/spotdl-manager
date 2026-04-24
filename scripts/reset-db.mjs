#!/usr/bin/env node
/**
 * Phase 1 one-shot DB reset: delete data/db.sqlite (if present) then
 * reapply schema via drizzle-kit push. Safe to run multiple times
 * (absent file is a no-op for the delete step).
 *
 * Rejects the Nitro startup plugin alternative (RESEARCH §Open Question
 * #1): `pnpm dev` runs `db:push` BEFORE `vite dev`, so a plugin that
 * deletes the DB at boot would create an ordering race where push runs
 * against the old DB and the app then boots against a fresh empty file.
 * A single Node script runs both steps in the correct order.
 */
import { existsSync, unlinkSync } from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const repoRoot = process.cwd();
const dbPath = path.resolve(repoRoot, "data", "db.sqlite");

if (existsSync(dbPath)) {
	unlinkSync(dbPath);
	console.log(`[reset:db] Deleted ${dbPath}`);
} else {
	console.log(`[reset:db] No DB at ${dbPath} — clean slate`);
}

// --force: drizzle.config.ts has strict: true, which prompts on every
// CREATE TABLE even against an empty DB. --force accepts non-destructive
// CREATE statements non-interactively; subsequent runs against a matching
// schema print "No changes detected" and are also non-interactive.
const result = spawnSync("pnpm", ["exec", "drizzle-kit", "push", "--force"], {
	stdio: "inherit",
	cwd: repoRoot,
	shell: process.platform === "win32",
});

if (result.status !== 0) {
	console.error(`[reset:db] drizzle-kit push failed with code ${result.status}`);
	process.exit(result.status ?? 1);
}

console.log("[reset:db] Schema applied — DB ready");
