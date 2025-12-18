# TODO

## Playlist Management

- [ ] Design playlist schema (id, name, source URL, output directory, schedule spec, status fields).
- [ ] Build playlist list route (table/grid) with createFileRoute and loader for SSR data.
- [ ] Add create/edit form using TanStack Form + Zod validation; reuse UI components; support output directory selection.
- [ ] Implement delete flow with confirmation; ensure server function for mutation.

## spotdl Invocation & Logging

- [ ] Implement server function to invoke spotdl per playlist with validated args; capture stdout/stderr and exit code.
- [ ] Store run records (playlist id, started/finished, status, logs path/contents).
- [ ] Add UI to trigger manual run and show latest run status/log excerpts.

## Scheduling (Cron/Worker)

- [ ] Define per-playlist schedule model (cron expression/interval) with validation.
- [ ] Implement worker/cron runner that enqueues spotdl runs per schedule (server-side module).
- [ ] Expose schedule controls in UI (enable/disable, next run preview) and surface upcoming/past runs.

## Advanced Output & Params

- [ ] Support per-playlist output directory selection and persistence.
- [ ] Allow advanced spotdl flags (quality, format, etc.) with validation and safe defaults.

## Status & Reporting Views

- [ ] Create status dashboard route summarizing recent runs, failures, and durations.
- [ ] Add run detail view with log display and retry action.

## Docker & Deployment

- [ ] Build Docker image bundling SSR app and worker; ensure spotdl available in image or via base image.
- [ ] Provide docker-compose example with volumes for downloads/cache and env configuration.
- [ ] Document docker run usage in README (ports, volumes, envs).

## Notifications/Webhooks

- [ ] Implement webhook/notification hooks for completion/error events (configurable per playlist or global).
- [ ] Add UI to configure webhook endpoint/secret and enable/disable per event type.
