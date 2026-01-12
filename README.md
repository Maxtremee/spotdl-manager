# spotdl-manager

Manager for playlists downloaded via [spotdl](https://github.com/spotDL/spotify-downloader). It lets you add/edit/remove playlists and, most importantly, schedule periodic refreshes to fetch new tracks automatically.

## What Is It?

- **Goal:** a convenient UI to manage playlists and run scheduled downloads of new tracks with `spotdl`.
- **Who it’s for:** people who use `spotdl` and want a web UI for playlist management and download scheduling.
- **Hosting model:** designed to be self-hosted (run locally or on your own server/container).

## Key Features

- **Playlist management:** add, edit, delete, set output directory.
- **On-demand download:** trigger a manual run when needed.
- **Scheduling (cron):** per-playlist schedules to refresh and fetch new tracks automatically.
- **Status & logs:** view recent runs, errors, and progress (planned).
- **`spotdl` integration:** the app invokes `spotdl`; it doesn’t replace it.

## Tech Stack

- **SSR/Router:** TanStack Start (Solid.js adapter) + Vite + Nitro ([vite.config.ts](vite.config.ts))
- **UI:** components in [src/components/ui](src/components/ui) (wrappers around Ark UI / Park UI-styled); Park UI adoption is planned
- **Styling:** PandaCSS (tokens/config in [panda.config.ts](panda.config.ts), theme in [src/theme](src/theme), generated utilities in `styled-system`)
- **Env validation:** `@t3-oss/env-core` ([src/env.ts](src/env.ts))
- **Code quality:** Biome (format/lint) – see scripts in [package.json](package.json)
- **Language:** TypeScript

## Requirements

### Local Development

- Node.js 18+ (20 recommended)
- pnpm package manager
- `spotdl` installed globally (`pip install spotdl`)
- FFmpeg installed on your system

### Docker Development (Recommended)

- Docker and Docker Compose
- All dependencies (spotdl, FFmpeg, Node.js) are pre-installed in the container

## Quick Start

### Option 1: Docker (Recommended for Testing)

The easiest way to run the app locally without installing spotdl:

```bash
# Build and start the development container
pnpm docker:dev

# Or use docker compose directly
docker compose up --build
```

The app will be available at `http://localhost:3000`.

**What's included in the Docker container:**

- Node.js 20 (Alpine)
- spotdl pre-installed
- FFmpeg for audio conversion
- All project dependencies
- Live code reloading via volume mounts

**Useful Docker commands:**

```bash
pnpm docker:down      # Stop the container
pnpm docker:logs      # View container logs
pnpm docker:build     # Rebuild the image
```

**Data persistence:**

- Project files are mounted as volumes for live editing
- `./data` directory persists logs, sync files, and downloads
- `./local.db` SQLite database persists across restarts
- `node_modules` and `styled-system` use Docker volumes for performance

### Option 2: Local Development

If you have spotdl installed locally:

```bash
pnpm install
pnpm dev
```

## Logging

 Centralized logger is provided via Pino in `src/logger.ts`.
 Access the logger via `Logger.get()` in server code or via the router context in routes: `const { logger } = Route.useContext()`.
 In development, logs are prettified using `pino-pretty`.
 Server plugins and schedulers now use the injected logger instead of `console`.
The dev server runs on port 3000 by default.

## Build & Start (SSR)

```bash
pnpm build
pnpm start
```

`pnpm start` launches the Nitro server from `.output`.

Optional static preview (not a substitute for SSR):

```bash
pnpm preview
```

## Environment Variables

Validation lives in [src/env.ts](src/env.ts). Client-side variables must be prefixed with `VITE_`.

Example `.env` (local with Vite):

```bash
# Server URL (optional)
SERVER_URL=

# App title (optional, client)
VITE_APP_TITLE=spotdl-manager
```

## Project Structure (short)

- [src/routes](src/routes) – file-based routes using TanStack Router (`createFileRoute()`); app shell in [src/routes/__root.tsx](src/routes/__root.tsx)
- [src/components/ui](src/components/ui) – ready-to-use UI components
- [src/theme](src/theme) – PandaCSS tokens, global styles, recipes
- [styled-system](styled-system) – generated PandaCSS utilities (do not edit manually)
- [src/env.ts](src/env.ts) – environment variable validation
- [src/modules](src/modules) – feature space (e.g., `client/`); server/client boundaries to expand next

## `spotdl` Integration

- The app doesn’t bundle `spotdl`; it runs it as an external process (host or container).
- Output directory and `spotdl` parameters will be configurable per playlist (planned).

## Docker Setup

### Development Container

The project includes a development Docker setup with spotdl pre-installed. See [Quick Start](#quick-start) above.

**Container architecture:**

- Base image: Node.js 20 Debian Buster Slim
- Pre-installed: Python 3, spotdl, FFmpeg, SQLite
- Scheduler runs in-process (no separate worker container needed)
- Volume mounts:
  - Project root → `/app` (live code reloading)
  - `./data` → `/app/data` (logs, sync files, downloads)
  - `./local.db` → `/app/local.db` (SQLite database)
  - Named volumes for `node_modules` and `styled-system`

**Customizing output directories:**

- By default, playlists download to `data/` subdirectories
- You can configure custom output paths per playlist in the UI
- For downloads outside the project, add additional volume mounts in `docker-compose.yml`

### Production

Production-ready Docker setup is available for self-hosting scenarios (home servers, NAS, VPS).

**Build and run production container:**

```bash
# Using docker compose (recommended)
pnpm docker:prod

# Or build and run separately
pnpm docker:prod:build
docker compose -f docker-compose.prod.yml up -d
```

**Production container features:**

- Multi-stage build for optimized image size
- Runs as non-root `node` user for security
- Health checks included
- Production-only dependencies
- Resource limits configured
- Auto-restart on failure

**Manual docker run:**

```bash
docker build -t spotdl-manager .
docker run -d \
  --name spotdl-manager \
  -e DATABASE_URL=file:./local.db \
  -e NODE_ENV=production \
  -v $(pwd)/data:/app/data \
  -v $(pwd)/local.db:/app/local.db \
  -p 3000:3000 \
  --restart unless-stopped \
  spotdl-manager
```

**Security notes:**

- Container runs as non-root `node` user (UID 1000)
- Only essential runtime dependencies included
- Health checks monitor application status
- Resource limits prevent runaway processes

This image is intended for self-hosting scenarios (e.g., home servers, NAS, or VPS providers).

## Roadmap

- [ ] Playlist screens: list, add, edit, delete
- [ ] `spotdl` invocation and run logs
- [ ] Scheduling (cron) + worker for periodic downloads
- [ ] Docker image + example `docker-compose.yml`
- [ ] Advanced output directory and `spotdl` parameter configuration
- [ ] Status/reporting views
- [ ] Logging
- [ ] Webhooks/notifications (e.g., on download completion/errors)

## License

See [LICENSE](LICENSE).
