---
phase: 02-spotify-metadata-spotifyscraper
reviewed: 2026-04-24T00:00:00Z
depth: standard
files_reviewed: 27
files_reviewed_list:
  - .dockerignore
  - .gitignore
  - Dockerfile
  - Dockerfile.dev
  - scraper/.gitignore
  - scraper/requirements.txt
  - scraper/scraper.py
  - server/plugins/events.ts
  - server/plugins/scheduler.ts
  - src/env.ts
  - src/modules/client/playlist/components/playlist-config-card.tsx
  - src/modules/client/playlist/schema/create-playlist-form.test.ts
  - src/modules/server/events/schema.test.ts
  - src/modules/server/events/schema.ts
  - src/modules/server/scheduler/PlaylistScheduler.test.ts
  - src/modules/server/scheduler/PlaylistScheduler.ts
  - src/modules/server/scraper/index.ts
  - src/modules/server/scraper/integration.test.ts
  - src/modules/server/scraper/repository.test.ts
  - src/modules/server/scraper/repository.ts
  - src/modules/server/scraper/schema.ts
  - src/modules/server/scraper/SpotifyScraperBridge.test.ts
  - src/modules/server/scraper/SpotifyScraperBridge.ts
  - src/modules/server/scraper/SyncRunner.test.ts
  - src/modules/server/scraper/SyncRunner.ts
  - src/modules/server/webhooks/service.test.ts
  - src/modules/server/webhooks/service.ts
  - src/routes/library_.$playlistId.tsx
findings:
  critical: 2
  warning: 3
  info: 2
  total: 7
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-04-24T00:00:00Z
**Depth:** standard
**Files Reviewed:** 27
**Status:** issues_found

## Summary

This phase introduces the spotifyscraper Python bridge, SyncRunner lifecycle orchestration, Drizzle upsert for track metadata, event schema extensions, and Discord webhook formatting. The overall architecture is sound: subprocess isolation is correctly implemented (`shell: false`, URL passed via stdin only, stderr capped), the Zod schemas are well-structured, the Drizzle upsert correctly preserves Phase-3-owned columns, and the SSRF mitigation is applied in depth (client schema + server-side `isValidPlaylistUrl`). Two critical issues were found: the production Dockerfile will fail to build at all due to a missing stage alias, and the `sql.raw` pattern used for the upsert `set` clause references column names that do not include the `excluded.` table qualifier correctly for the Drizzle/SQLite combination used here. Three warnings cover unbounded sleep, a webhook SSRF gap, and a singleton pattern that silently ignores deps on repeated calls.

---

## Critical Issues

### CR-01: Dockerfile Stage 1 Missing `AS builder` — Production Image Cannot Be Built

**File:** `Dockerfile:5`
**Issue:** Stage 1 is declared as `FROM node:22-slim` without an `AS builder` alias. Stage 2 references `--from=builder` on lines 50–52. Docker will reject the build with `failed to solve: pull access denied for builder` (or equivalent) because the named stage does not exist. The production image literally cannot be built as written.

**Fix:**
```dockerfile
# Line 5 — add AS builder
FROM node:22-slim AS builder
```

---

### CR-02: `sql.raw` Used Without `excluded` Table Alias — Drizzle Upsert `set` Clause Is Syntactically Incorrect

**File:** `src/modules/server/scraper/repository.ts:87-91`
**Issue:** The `onConflictDoUpdate` `set` clause uses `sql.raw(`excluded.${schema.tracks.title.name}`)` which produces the raw SQL fragment `excluded.title`. This is the correct SQLite `ON CONFLICT DO UPDATE SET col = excluded.col` syntax at the SQL level, but `sql.raw(...)` in Drizzle produces an unparameterized SQL expression that is placed as the *value* in the SET clause. Whether this produces valid SQL depends on the Drizzle SQLite adapter version; in drizzle-orm 0.45.x, the recommended pattern for referencing the excluded row is `sql`excluded.${column}``, not `sql.raw(...)`. Using `sql.raw` bypasses Drizzle's query builder entirely and can produce malformed SQL (missing parentheses, incorrect placement) that silently writes incorrect values or throws a runtime error that the synchronous `better-sqlite3` surface will surface as an exception inside the transaction.

The correct approach in this version of Drizzle is to use the tagged template form:

**Fix:**
```typescript
// Use tagged sql template, not sql.raw
import { eq, sql } from "drizzle-orm";

// In the set clause:
set: {
  title: sql`excluded.${schema.tracks.title}`,
  artist: sql`excluded.${schema.tracks.artist}`,
  durationMs: sql`excluded.${schema.tracks.durationMs}`,
  position: sql`excluded.${schema.tracks.position}`,
  updatedAt: sql`excluded.${schema.tracks.updatedAt}`,
},
```

Note: the tagged template `sql\`excluded.${col}\`` causes Drizzle to quote the column identifier correctly, whereas `sql.raw(string)` inserts the string verbatim with no quoting. Both forms avoid user-controlled input so there is no injection risk here; the bug is correctness, not security.

---

## Warnings

### WR-01: Unbounded `sleep` on `Retry-After` Header — Potential Denial-of-Service via Server-Controlled Delay

**File:** `src/modules/server/webhooks/service.ts:93-97`
**Issue:** The `Retry-After` header value from a Discord (or any) response is parsed and used directly as a sleep duration without an upper bound:
```typescript
const waitMs = retryAfter
  ? Number.parseInt(retryAfter, 10) * 1000
  : RETRY_DELAY_MS;
await sleep(waitMs);
```
A malicious or misconfigured server could return `Retry-After: 86400` (one day), causing the event handler to block its async context for 24 hours. The webhook handler runs inside the Nitro event loop; a long-lived promise here does not block other requests, but it does mean the handler never releases its listener for the duration and an event could pile up. Additionally `Number.parseInt` on a non-numeric string (e.g. an HTTP-date `Retry-After` value) returns `NaN`, and `NaN * 1000` is `NaN`, so `sleep(NaN)` behaves as `sleep(0)` — the wait is silently skipped, causing an immediate retry against a rate-limited endpoint.

**Fix:**
```typescript
const MAX_RETRY_AFTER_MS = 30_000; // cap at 30 s
const parsed = retryAfter ? Number.parseInt(retryAfter, 10) : Number.NaN;
const waitMs = Number.isFinite(parsed) && parsed > 0
  ? Math.min(parsed * 1000, MAX_RETRY_AFTER_MS)
  : RETRY_DELAY_MS;
await sleep(waitMs);
```

---

### WR-02: Webhook `sendDiscordWebhook` Accepts Any URL — Missing Host Restriction (SSRF)

**File:** `src/modules/server/webhooks/service.ts:70-77` and `src/modules/server/webhooks/schema.ts:18`
**Issue:** `WebhookSettingsSchema` validates the URL with `z.string().url()` (any valid URL). `sendDiscordWebhook` then calls `fetch(webhookUrl, ...)` without checking the URL scheme or host. This allows a user with access to the webhook settings UI to store `http://169.254.169.254/latest/meta-data/` (cloud IMDS) or an internal service URL, causing the server to make an outbound request to that address. The webhook URL is stored in the DB and re-read on every event; a stored SSRF payload would fire on every sync.

**Fix:**
Add a refinement to `WebhookSettingsSchema` restricting the host:
```typescript
url: z.string().url().refine(
  (val) => {
    if (!val) return true;
    try {
      const u = new URL(val);
      return (
        u.protocol === "https:" &&
        (u.hostname === "discord.com" || u.hostname === "discordapp.com" ||
         u.hostname.endsWith(".discord.com") || u.hostname.endsWith(".discordapp.com"))
      );
    } catch {
      return false;
    }
  },
  { message: "Webhook URL must be a Discord HTTPS URL" }
).optional(),
```

---

### WR-03: `getScheduler` Singleton Silently Ignores `deps` on All Calls After the First

**File:** `src/modules/server/scheduler/PlaylistScheduler.ts:283-291`
**Issue:** The `getScheduler` factory ignores `deps` whenever `schedulerInstance` is already set:
```typescript
export function getScheduler(deps?: { ... }): PlaylistScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new PlaylistScheduler(deps);
  }
  return schedulerInstance; // deps silently discarded on repeat calls
}
```
In `server/plugins/events.ts` (line 44) and `server/plugins/scheduler.ts` (line 14), both plugins call `getScheduler({ logger: ... })`. Whichever plugin loads second will get the instance created by the first with a potentially different logger scope. More importantly, in tests the `getScheduler singleton` describe block (PlaylistScheduler.test.ts:472) exercises the singleton but test isolation does not reset `schedulerInstance` between test files — the module-level variable persists across test runs in the same Vitest worker, making the singleton non-deterministic for any test that calls `getScheduler()` directly.

**Fix:** Accept that the singleton pattern is intentional for production, but document that `deps` are only respected on first call:
```typescript
export function getScheduler(deps?: { logger?: AppLogger; syncRunner?: SyncRunner }): PlaylistScheduler {
  if (!schedulerInstance) {
    schedulerInstance = new PlaylistScheduler(deps);
  }
  // NOTE: deps are ignored after first initialization. To inject deps in tests,
  // construct PlaylistScheduler directly instead of using getScheduler().
  return schedulerInstance;
}
```
For test isolation, export a `resetSchedulerSingleton` function (test-only) or have the test file use `new PlaylistScheduler(...)` exclusively (which the tests already do for most cases).

---

## Info

### IN-01: `scraper.py` Error Message Reflects Raw Exception Repr — Consider Stripping for `bad request` Case

**File:** `scraper/scraper.py:139`
**Issue:** When stdin JSON cannot be parsed, the error message includes `f"bad request: {e!r}"`. The `!r` repr format of a Python `json.JSONDecodeError` includes the raw input string up to the parse failure position (e.g. `JSONDecodeError('Expecting value', '...raw input...', 0)`). If the stdin payload is very large (e.g. a malformed request from a bug), this repr could produce a very long error string that propagates into the invocation `summary` column via `finalizeFailure`. The `STDERR_SLICE_LIMIT = 500` in the bridge applies to stderr, not to `envelope.error.message` from stdout — there is no cap on the message length from a handled Python error.

**Fix:** Cap the message at a reasonable length on the Python side:
```python
_emit({
    "tracks": None,
    "cover_art_url": None,
    "error": {"type": "invalid_url", "message": f"bad request: {str(e)[:200]}"},
})
```

---

### IN-02: `Dockerfile` — Python venv `chown` Runs After `pip install`, Requiring Root for Install Phase

**File:** `Dockerfile:71-73`
**Issue:** The production Dockerfile runs `pip install` as root (the default user in `node:22-slim` before `USER node` on line 76), then `chown`s the venv. This is the correct sequence for immutable layer security (T-2-07 TOCTOU mitigation noted in comments). The comment on line 67-69 correctly documents this. However, `pip install --no-cache-dir` followed by `chown -R` on a potentially large venv directory duplicates metadata work and increases the layer size. This is informational only — the security intent is correct.

A minor improvement would be to use `--no-cache-dir` (already present) and consider pinning the `pip` version for reproducibility, but this is low priority.

**No code change required** — the current approach is intentional per the inline comment.

---

_Reviewed: 2026-04-24T00:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
