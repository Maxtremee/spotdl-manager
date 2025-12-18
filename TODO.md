# TODO

## Playlist Management

- [ ] Design playlist schema (id, name, source URL, output directory, schedule spec, status fields).
  - [ ] Create `PlaylistSchema` in `src/modules/client/playlist/schema/playlist.ts`
  - [ ] Export `Playlist` type via `z.infer`
  - [ ] Add discriminated union for source type (playlist/album/track)
  - [ ] Add `flags` (overwrite, retries) with safe defaults
  - [ ] Unit-validate sample payloads (dev helper route or test harness)
- [ ] Build playlist list route (table/grid) with createFileRoute and loader for SSR data.
  - [ ] Create `src/routes/playlists.tsx` with `createFileRoute('/playlists')`
  - [ ] Implement loader calling server fn to list playlists
  - [ ] Render table using `src/components/ui` primitives (Table, Button)
  - [ ] Add pagination/filtering client-side helpers
  - [ ] Empty-state and error-state UI
- [ ] Add create/edit form using TanStack Form + Zod validation; reuse UI components; support output directory selection.
  - [ ] Build `PlaylistForm.tsx` with `createForm()` and field validators
  - [ ] Integrate `PlaylistSchema` for parse/validation
  - [ ] Output directory picker (text + optional file chooser later)
  - [ ] Submit to service via server fn; show success/error toast
  - [ ] Pre-fill edit mode with loader data
- [ ] Implement delete flow with confirmation; ensure server function for mutation.
  - [ ] Add `Dialog` confirm in list row actions
  - [ ] Implement `deletePlaylist` server fn with id validation
  - [ ] Optimistically remove from UI; rollback on failure
  - [ ] Log action outcome to status dashboard

## spotdl Invocation & Logging

- [ ] Implement server function to invoke spotdl per playlist with validated args; capture stdout/stderr and exit code.
  - [ ] Create `runSpotdl.ts` server fn using `createServerFn`
  - [ ] Build arg builder from playlist settings (schema-driven)
  - [ ] Stream/capture logs; return path + summary
  - [ ] Map exit codes to statuses (success/failed/canceled)
- [ ] Store run records (playlist id, started/finished, status, logs path/contents).
  - [ ] Implement `runRepository.ts` with save/list/find
  - [ ] Decide storage (JSON file or simple SQLite placeholder)
  - [ ] Add retention policy or cap list size
- [ ] Add UI to trigger manual run and show latest run status/log excerpts.
  - [ ] Add `Run` button in playlist row
  - [ ] Show in-row last status + timestamp
  - [ ] Link to run detail page with log viewer

## Scheduling (Cron/Worker)

- [ ] Define per-playlist schedule model (cron expression/interval) with validation.
  - [ ] Add `ScheduleSchema` with cron string OR interval minutes
  - [ ] Validate ranges and disallow invalid crons
- [ ] Implement worker/cron runner that enqueues spotdl runs per schedule (server-side module).
  - [ ] Implement `cronWorker.ts` tick loop and next-run calc
  - [ ] Graceful error handling and backoff on failure
  - [ ] Locking to prevent concurrent runs per playlist
- [ ] Expose schedule controls in UI (enable/disable, next run preview) and surface upcoming/past runs.
  - [ ] Form controls: enable, cron input, preview next run time
  - [ ] Surface upcoming runs in status dashboard
  - [ ] Manual "Run now" to bypass schedule

## Advanced Output & Params

- [ ] Support per-playlist output directory selection and persistence.
  - [ ] Persist outputDir in playlist record
  - [ ] Validate path format; sanitize for CLI
- [ ] Allow advanced spotdl flags (quality, format, etc.) with validation and safe defaults.
  - [ ] Add flags to schema with union/enums
  - [ ] Map flags consistently to CLI args builder
  - [ ] Document supported options in README

## Status & Reporting Views

- [ ] Create status dashboard route summarizing recent runs, failures, and durations.
  - [ ] Add `src/routes/status.tsx` with loader aggregating runRepository
  - [ ] Filters: by playlist, time window, status
  - [ ] Summary cards: success rate, avg duration
- [ ] Add run detail view with log display and retry action.
  - [ ] Add `src/routes/runs/$runId.tsx` with server loader
  - [ ] Log viewer (truncate/expand)
  - [ ] Retry button calling runner with same params

## Docker & Deployment

- [ ] Build Docker image bundling SSR app and worker; ensure spotdl available in image or via base image.
  - [ ] Add Dockerfile (multi-stage) with `pnpm build` and runtime stage
  - [ ] Install or base FROM image with `spotdl`
  - [ ] Entrypoint runs SSR server + worker (supervisor or separate services)
- [ ] Provide docker-compose example with volumes for downloads/cache and env configuration.
  - [ ] Create `docker-compose.yml` with volumes and environment
  - [ ] Healthchecks and restart policy
- [ ] Document docker run usage in README (ports, volumes, envs).
  - [ ] Add commands and notes on volumes, permissions

## Notifications/Webhooks

- [ ] Implement webhook/notification hooks for completion/error events (configurable per playlist or global).
  - [ ] Build `webhookService.ts` (POST with retries/jitter)
  - [ ] Hook into run lifecycle (success/error/canceled)
  - [ ] Configurable global vs per-playlist settings
- [ ] Add UI to configure webhook endpoint/secret and enable/disable per event type.
  - [ ] Settings form and validation
  - [ ] Test webhook send with sample payload
