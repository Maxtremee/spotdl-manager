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

- Node.js 18+ and PNPM
- `spotdl` installed in the environment where downloads run (host or Docker image – see Docker section)
- A self-hosted environment (local machine, home server, or VPS). Cloud hosting is possible but not required.

## Quick Start (dev)

```bash
pnpm install
pnpm dev
```

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

```
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

## Docker & Cron (plan)

The project will provide a Docker image including:

- the SSR server,
- a cron/worker process to run per‑playlist scheduled downloads,
- `spotdl` preinstalled or mountable via volume/base image.

Planned container config:

- volumes for the output downloads directory and cache if needed,
- any tokens/APIs required by `spotdl` (if applicable).

This image is intended for self-hosting scenarios (e.g., home servers, NAS, or VPS providers).

Example `docker run` (sketch; finalize once the image is published):

```bash
docker run -d \
 -e VITE_APP_TITLE="spotdl-manager" \
 -v /path/on/host:/data \
 -p 3000:3000 \
 ghcr.io/<owner>/spotdl-manager:latest
```

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
