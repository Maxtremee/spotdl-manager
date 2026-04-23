# Testing Patterns

**Analysis Date:** 2026-04-23

## Test Framework

**Runner:** Vitest 4.0.16
- Invoked via `pnpm test` → `vitest run` (one-shot, no watch)
- No dedicated config file — Vitest picks up settings from `vite.config.ts` (which also declares `vite-tsconfig-paths`, `solidPlugin`, `tanstackStart`, and `nitro`). `~/` path alias resolves in tests thanks to this.

**Assertion Library:**
- Vitest built-in `expect` (Chai-compatible API).

**Mocking:**
- Vitest built-in `vi.mock`, `vi.fn`, `vi.hoisted`, `vi.mocked`, `vi.spyOn`.

**Run Commands:**
```bash
pnpm test              # Run full suite once (vitest run)
pnpm typecheck         # Type-check tests + source (tsc --noEmit)
pnpm check             # Biome lint + format (applies to tests too)
```

No watch mode, coverage, or UI script is currently wired. To run in watch locally: `npx vitest`. To get coverage: `npx vitest run --coverage` (no `@vitest/coverage-*` dependency installed yet).

## Test File Locations

Tests are **co-located** with their subject (not in a separate `__tests__` or `tests/` directory). All four existing tests:

- `src/modules/server/scheduler/PlaylistScheduler.test.ts`
- `src/modules/server/spotdl/SpotdlInvocator.test.ts`
- `src/modules/server/events/EventBus.test.ts`
- `src/modules/client/playlist/schema/playlist.test.ts`

**Naming:** `<subject>.test.ts` directly next to `<subject>.ts`. No `.spec.ts` variants are used.

## Test Structure

Each file opens with a single top-level `describe` matching the class/module name, then nested `describe` blocks per method or behavior group, and `it` blocks using `"should ..."` phrasing.

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("PlaylistScheduler", () => {
  let scheduler: PlaylistScheduler;

  beforeEach(() => {
    vi.clearAllMocks();
    mockCronInstances.clear();
    mockDbSelect.mockResolvedValue([]);
    scheduler = new PlaylistScheduler();
  });

  afterEach(() => {
    if (scheduler) scheduler.shutdown();
    vi.clearAllMocks();
  });

  describe("intervalToCron", () => {
    it("should convert minutes less than 60 to every N minutes cron", () => {
      const playlist = createMockPlaylist({ scheduleType: "interval", scheduleMinutes: 30 });
      scheduler.schedulePlaylist(playlist);
      expect(Cron).toHaveBeenCalledWith("*/30 * * * *", expect.any(Function));
    });
  });
});
```

**Conventions:**
- Import the full set of Vitest helpers explicitly (`describe, it, expect, vi, beforeEach, afterEach`). No globals enabled.
- Test names start with `"should "` and describe observable behavior, not implementation.
- Group tests by method (`describe("schedulePlaylist")`, `describe("unschedulePlaylist")`) or by behavior slice (`describe("sync file handling")`, `describe("edge cases")`).
- One assertion focus per `it`, though multiple `expect` calls are fine when they check one logical outcome.

## Setup & Teardown

**Fresh subject per test:** `beforeEach` constructs a new instance.

```typescript
beforeEach(() => {
  EventBus.resetInstance();
  eventBus = EventBus.getInstance();
});

afterEach(() => {
  eventBus.clear();
});
```

**Singleton reset pattern:** When a class exposes a singleton (`EventBus`, scheduler), either call a dedicated `resetInstance()` / `clear()` / `shutdown()` helper in `beforeEach`/`afterEach`, or construct a throwaway instance directly to bypass the singleton.

**Mock reset:** `vi.clearAllMocks()` in both `beforeEach` and `afterEach`.

## Mocking

### Module mocks with `vi.mock`

Module mocks are declared at the top of the file, **before** any import of the code under test. Static imports are hoisted by Vitest so a dynamic `import` is not needed.

```typescript
// Mock node built-ins
vi.mock("node:child_process", () => ({ spawn: vi.fn() }));
vi.mock("node:fs", () => ({
  promises: { mkdir: vi.fn(), writeFile: vi.fn(), access: vi.fn() },
}));
vi.mock("node:crypto", () => ({ randomUUID: vi.fn(() => "mock-uuid-123") }));
```

### Hoisted shared state with `vi.hoisted`

When the mock factory needs to reference variables that would otherwise not be hoisted, declare them in `vi.hoisted`. This is the project's pattern for class mocks that need inspectable spies:

```typescript
const {
  mockCronInstances,
  mockDbSelect,
  mockInvocationCreate,
  mockSpotdlRun,
} = vi.hoisted(() => ({
  mockCronInstances: new Map<string, MockCronInstance>(),
  mockDbSelect: vi.fn(),
  mockInvocationCreate: vi.fn(() => Promise.resolve({ id: "inv-1" })),
  mockSpotdlRun: vi.fn(() => Promise.resolve({ status: "success", exitCode: 0, ... })),
}));

vi.mock("croner", () => {
  const CronMock = vi.fn(function (this: MockCronInstance, pattern: string, callback?: any) {
    this.stop = vi.fn();
    this.callback = callback;
    mockCronInstances.set(pattern, this);
  });
  return { Cron: CronMock };
});
```

### Mocking internal modules

Internal repositories and collaborators are mocked with a constructor function that assigns mock methods onto `this`:

```typescript
vi.mock("../invocation/repository", () => ({
  InvocationRepository: vi.fn(function (this) {
    this.create = mockInvocationCreate;
    this.update = mockInvocationUpdate;
  }),
}));
```

This preserves `new InvocationRepository()` call sites in production code while letting the test control behavior.

### Typed mock access

After a module is mocked, use `vi.mocked(fn)` to get a typed reference for setting return values or inspecting calls:

```typescript
import { spawn } from "node:child_process";
vi.mocked(spawn).mockReturnValue(mockProcess as any);
vi.mocked(fs.mkdir).mockResolvedValue(undefined);
vi.mocked(fs.access).mockRejectedValue(new Error("Not found"));

// Inspecting calls
const spawnArgs = vi.mocked(spawn).mock.calls[0];
expect(spawnArgs[1]).toContain("--format");
```

### Console spying

```typescript
const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
// ... trigger code that logs
expect(consoleErrorSpy).toHaveBeenCalled();
consoleErrorSpy.mockRestore();
```

### What to mock
- External processes (`node:child_process.spawn`)
- Filesystem (`node:fs`, `node:fs/promises`)
- Database access layer (`../db`, repositories like `InvocationRepository`, `SpotdlRepository`)
- Time/ID sources (`node:crypto.randomUUID`)
- Third-party schedulers (`croner`)
- Event primitives when timing matters (`node:events.once`)

### What NOT to mock
- Pure Zod schemas — test them directly with real input.
- Pure formatters/service functions — run them with real data.
- The class under test — always exercise the real constructor and methods.

## Fixtures & Factories

**Factory functions** build valid domain objects with override support:

```typescript
function createMockPlaylist(overrides: Partial<PlaylistRow> = {}): PlaylistRow {
  return {
    id: "playlist-1",
    name: "Test Playlist",
    sourceType: "playlist",
    sourceUrl: "https://open.spotify.com/playlist/123",
    outputDir: "/music/downloads",
    flagsOverwrite: false,
    flagsRetries: 3,
    flagsQuality: "high",
    flagsFormat: "mp3",
    scheduleEnabled: true,
    scheduleType: "cron",
    scheduleCron: "0 6 * * *",
    scheduleMinutes: 1440,
    status: "active",
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}
```

**Fixture constants** co-located inside the subject module (not in a separate fixtures file) and re-exported for tests. Example: `SAMPLE_PLAYLISTS` in `src/modules/client/playlist/schema/playlist.ts` is consumed by `playlist.test.ts`:

```typescript
import { SAMPLE_PLAYLISTS, parsePlaylist, tryParsePlaylist } from "./playlist";

it("should parse valid spotify playlist", () => {
  const result = parsePlaylist(SAMPLE_PLAYLISTS.spotifyPlaylist);
  expect(result.name).toBe("My Favorite Songs");
});
```

Test-only stubs stay at the top of the test file (e.g., `STUB_PLAYLISTS` in `SpotdlInvocator.test.ts`).

## Common Patterns

### Async Testing

```typescript
it("should successfully run spotdl with a valid URL", async () => {
  vi.mocked(spawn).mockReturnValue(mockProcess as any);
  const result = await invocator.run(request);
  expect(result.status).toBe("success");
});
```

- `async` test functions with top-level `await`.
- Reject via `mockRejectedValueOnce(new Error("..."))` to simulate failures.
- For fine-grained concurrency assertions (e.g., preventing concurrent runs), capture a resolver:

```typescript
let resolveRun: (value: any) => void;
mockSpotdlRun.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve; }));

const promise1 = cronInstance?.callback();
cronInstance?.callback(); // second call should be a no-op
resolveRun?.({ status: "success", ... });
await promise1;

expect(mockSpotdlRun).toHaveBeenCalledTimes(1);
```

### Error Testing

**Sync throws:**
```typescript
expect(() =>
  parsePlaylist({ source: { type: "podcast", url: "https://example.com" } }),
).toThrow();
```

**Safe-parse failure branch:**
```typescript
const result = tryParsePlaylist({ source: { type: "invalid" } });
expect(result.success).toBe(false);
if (!result.success) {
  expect(result.error.issues.length).toBeGreaterThan(0);
}
```

**Async rejection handled by subject:**
```typescript
mockSpotdlRun.mockRejectedValueOnce(new Error("spotdl crashed"));
await cronInstance?.callback();
expect(mockInvocationUpdate).toHaveBeenCalledWith(
  "mock-uuid-123",
  expect.objectContaining({ status: "failed", exitCode: -1, summary: "spotdl crashed" }),
);
```

### Matcher Patterns

- `expect.objectContaining({ ... })` for partial matches on call arguments.
- `expect.any(Function)` / `expect.any(String)` for shape-only assertions.
- `expect(fn).toHaveBeenCalledTimes(n)` to verify invocation counts (especially after unsubscribe).
- `expect(fn).toHaveBeenCalledWith(...)` for argument checks.
- `toBe` (reference equality, primitives), `toEqual` (deep), `toContain` (array/string), `toBeDefined`, `toBeTypeOf`.

### Iterating over enum values

For Zod enums, iterate to confirm all variants round-trip:

```typescript
const formats = ["mp3", "flac", "ogg", "m4a", "opus", "vorbis", "wav"];
formats.forEach((format) => {
  const result = parsePlaylist({ ..., flags: { format: format as ... } });
  expect(result.flags?.format).toBe(format);
});
```

### Event-driven assertions

For pub/sub tests (`EventBus.test.ts`), assert handler invocation counts before and after `unsubscribe()`, and use a second emit to confirm deregistration:

```typescript
const handler = vi.fn();
const unsubscribe = eventBus.on("playlist.sync.started", handler);
await eventBus.emit({ type: "playlist.sync.started", payload: { ... } });
expect(handler).toHaveBeenCalledTimes(1);
unsubscribe();
await eventBus.emit({ type: "playlist.sync.started", payload: { ... } });
expect(handler).toHaveBeenCalledTimes(1); // not called again
```

## Test Types Present

- **Unit / module tests:** all current tests. Subjects in isolation with collaborators mocked.
- **Integration tests:** none yet. There is no DB-backed integration test — the DB module is always mocked out.
- **E2E / UI tests:** none. No Playwright / Cypress / component-level Solid test harness is wired up.
- **Component tests:** none. `src/components/ui/*` and `src/modules/client/*/components/*` have no tests yet.

## Coverage

**No coverage tool configured.** `package.json` does not depend on `@vitest/coverage-v8` or `@vitest/coverage-istanbul`, and no `test:coverage` script exists.

To add coverage ad hoc: `pnpm add -D @vitest/coverage-v8` then `npx vitest run --coverage`.

## Code Style in Tests

Biome rules apply to test files identically (tabs, double quotes, trailing commas, block statements). `any` casts are tolerated on mocks (e.g., `mockProcess as any`) — tests are the only place this pattern appears regularly.

---

*Testing analysis: 2026-04-23*
