# Technology Stack

**Analysis Date:** 2026-04-23

## Languages

**Primary:**
- TypeScript 5.9.3 - All application code in `src/`, `server/`, config files
- TSX/JSX (Solid.js flavor) - UI components via `jsxImportSource: "solid-js"` (see `tsconfig.json`)

**Secondary:**
- Python 3 - Not in source, but required at runtime to execute the `spotdl` CLI (installed via `pip3`/`pipx` in Docker images)
- SQL - Drizzle migrations in `drizzle/0000_lonely_justin_hammer.sql`, `drizzle/0001_charming_the_hood.sql`, `drizzle/0002_fine_zombie.sql`
- CSS - `src/styles.css` plus PandaCSS-generated utilities in `styled-system/`

## Runtime

**Environment:**
- Node.js 22 (slim) - pinned in `Dockerfile` and `Dockerfile.dev` (`FROM node:22-slim`)
- Target: ES2022 (`tsconfig.json` `compilerOptions.target`)
- Module system: ESNext, `"type": "module"` in `package.json`
- Module resolution: `bundler` (`tsconfig.json`)
- Server runtime: Nitro (via TanStack Start / Nitro plugin)

**Package Manager:**
- pnpm (managed through `corepack`, set to `pnpm@latest` in Docker)
- Lockfile: `pnpm-lock.yaml` present (frozen-lockfile used in Docker build)
- Workspace config: `pnpm-workspace.yaml` - pins built-only deps (`better-sqlite3`, `esbuild`) and applies patch to `solid-js@1.9.10` via `patches/solid-js@1.9.10.patch`

## Frameworks

**Core:**
- Solid.js 1.9.10 - UI framework (patched via `patches/solid-js@1.9.10.patch`)
- TanStack Solid Start 1.149.0 - SSR meta-framework with file-based routing (`@tanstack/solid-start`)
- TanStack Solid Router 1.147.3 - Client/server routing (`@tanstack/solid-router`, `@tanstack/solid-router-devtools`, `@tanstack/router-plugin`)
- TanStack Solid Form 1.27.7 - Form state handling (`@tanstack/solid-form`)
- TanStack Zod Adapter 1.147.3 - Zod validator bridge for router (`@tanstack/zod-adapter`)
- Nitro (`latest`) - Universal server bundler used by TanStack Start; plugins registered in `vite.config.ts` (`server/plugins/events.ts`, `server/plugins/scheduler.ts`)
- Ark UI for Solid 5.30.0 - Headless component primitives (`@ark-ui/solid`), wrapped by 61 components in `src/components/ui/`

**Testing:**
- Vitest 4.0.16 - Test runner (`pnpm test` → `vitest run`)
- Test files co-located, e.g. `src/modules/server/events/EventBus.test.ts`, `src/modules/server/scheduler/PlaylistScheduler.test.ts`, `src/modules/server/spotdl/SpotdlInvocator.test.ts`

**Build/Dev:**
- Vite 7.3.1 - Dev server and bundler (`vite.config.ts`)
- `vite-plugin-solid` 2.11.10 - Solid JSX transform with `ssr: true`
- `vite-tsconfig-paths` 6.0.4 - Resolves `~/` alias from `tsconfig.json`
- `@tanstack/devtools-vite` 0.4.1 - TanStack devtools integration
- PandaCSS 1.8.0 (`@pandacss/dev`, `@pandacss/studio`) - CSS-in-JS / token system; config in `panda.config.ts`; codegen to `styled-system/` via `pnpm prepare`
- PostCSS (`postcss.config.cjs`) - Hosts the `@pandacss/dev/postcss` plugin
- tsx 4.21.0 - TypeScript executor for seed script (`src/modules/server/db/seed.ts`)
- Biome 2.2.4 (`@biomejs/biome`) - Formatter + linter (`biome.jsonc`)

## Key Dependencies

**Critical:**
- `better-sqlite3` 12.6.0 - Synchronous SQLite driver used by Drizzle (`src/modules/server/db/index.ts` → `drizzle("data/db.sqlite", { schema })`)
- `drizzle-orm` 0.45.1 - ORM for schema and queries (`src/modules/server/db/schema.ts`)
- `drizzle-kit` 0.31.8 - Migrations tooling (`drizzle.config.ts`, scripts `db:push`, `db:generate`, `db:migrate`)
- `drizzle-seed` 0.3.1 - Seeding helpers (`src/modules/server/db/seed.ts` via `pnpm seed`)
- `zod` 4.3.5 - Runtime validation for env, server fn inputs, event schemas, and settings (`src/env.ts`, `src/modules/server/events/schema.ts`, `src/modules/server/spotdl/schema.ts`, `src/modules/server/webhooks/schema.ts`)
- `@t3-oss/env-core` 0.13.10 - Type-safe env parsing (`src/env.ts`)
- `croner` 9.1.0 - Cron scheduling engine used by `PlaylistScheduler` (`src/modules/server/scheduler/PlaylistScheduler.ts`)
- `pino` 10.1.1 + `pino-pretty` 13.1.3 - Structured logging singleton (`src/logger.ts`)

**UI / UX:**
- `@ark-ui/solid` 5.30.0 - Primitive components (wrapped by `src/components/ui/*` — 61 components)
- `lucide-solid` 0.562.0 - Icon set used in components
- `nprogress` 0.2.0 + `@types/nprogress` 0.2.3 - Top-of-page progress indicator

**Infrastructure:**
- `nitro` (latest) - Server runtime; plugins in `server/plugins/events.ts` and `server/plugins/scheduler.ts`
- External CLI dependency: `spotdl` Python package - spawned via `child_process` in `src/modules/server/spotdl/SpotdlInvocator.ts` (`this.binaryPath = options?.binaryPath ?? "spotdl"`)
- `ffmpeg` - System binary required by `spotdl` at runtime (installed via `apt` in both Dockerfiles)

## Configuration

**TypeScript (`tsconfig.json`):**
- `strict: true`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedSideEffectImports`
- `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `noEmit: true`
- Path alias: `~/* → ./src/*`
- Includes `styled-system` (PandaCSS generated)

**Linting / Formatting (`biome.jsonc`):**
- Tab indentation; double quotes; trailing commas (all); `useBlockStatements` rule = error
- Files scoped to `./src/**/*` (excluding `src/routeTree.gen.ts`) plus root configs
- Commands: `pnpm format`, `pnpm lint`, `pnpm check`

**Vite (`vite.config.ts`):**
- Plugins (in order): `devtools()`, `nitro({ plugins: [...] })`, `viteTsConfigPaths`, `tanstackStart()`, `solidPlugin({ ssr: true })`
- Nitro server plugins explicitly loaded: `server/plugins/events.ts`, `server/plugins/scheduler.ts`

**PandaCSS (`panda.config.ts`):**
- `preflight: true`, `jsxFramework: "solid"`, `outdir: "styled-system"`
- Scans `./src/**/*.{js,jsx,ts,tsx}`
- Custom tokens in `src/theme/tokens/` (`colors`, `durations`, `shadows`, `z-index`)
- Removes `@pandacss/preset-panda` colors via custom plugin; uses Radix-like color scales (`grass`, `green`, `red`, `slate` from `src/theme/colors/*`)
- Regenerate with `pnpm prepare` after theme changes

**Drizzle (`drizzle.config.ts`):**
- `dialect: "sqlite"`, schema path `./src/modules/server/db/schema.ts`
- Migrations output: `./drizzle/`
- Connection URL: `data/db.sqlite` (strict, verbose mode on)

**Environment (`src/env.ts`):**
- Server: `SERVER_URL` (optional URL), `SPOTDL_COOKIES_FILE` (optional path)
- Client prefix: `VITE_`; `VITE_APP_TITLE` (optional)
- Also consumed in code: `NODE_ENV`, `LOG_LEVEL`, `NITRO_PORT`
- `.env` file exists (not read); example at `.env.example`; empty `.env.sample`

**Components (`components.json`):**
- Park UI schema; `framework: "solid"`; aliases for `components`, `hooks`, `lib`, `recipes`, `theme`, `ui`

## Platform Requirements

**Development:**
- Node.js 22, pnpm (via corepack)
- Python 3 + `spotdl` CLI on PATH (or run via Docker)
- `ffmpeg` binary on PATH (required by spotdl)
- SQLite (native via `better-sqlite3` — needs `make`/`g++` for build)
- Port 3000 available (`pnpm dev` runs `drizzle-kit push` then Vite on port 3000)

**Production:**
- Docker image built from `Dockerfile` (multi-stage, node:22-slim)
- Runtime deps installed in image: `python3`, `python3-pip`, `ffmpeg`, `sqlite3`, `spotdl` (via `pip3 install`)
- Non-root `node` user; `EXPOSE 3000`; health check on `http://localhost:3000`
- `ENV NODE_ENV=production`; `NITRO_PORT=3000` in `docker-compose.prod.yml`
- Persistent volumes: `./data` (logs, sync files, downloads, cookies, SQLite DB at `/app/data/db.sqlite`)

**Scripts (`package.json`):**
```
pnpm dev                  # db:push + vite dev (port 3000)
pnpm build                # vite build → .output/
pnpm start                # node .output/server/index.mjs (SSR server)
pnpm preview              # vite preview (NOT used for SSR testing)
pnpm test                 # vitest run
pnpm format|lint|check    # biome
pnpm prepare              # panda codegen
pnpm seed                 # db:push + tsx seed script with --env-file=.env
pnpm typecheck            # tsc --noEmit
pnpm db:push|generate|migrate
pnpm docker:dev|build|down|logs|prod|prod:build|prod:down
```

---

*Stack analysis: 2026-04-23*
