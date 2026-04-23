# Phase 1: Schema reset & spotdl removal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-23
**Phase:** 01-schema-reset-spotdl-removal
**Areas discussed:** Gray area selection, Scheduler no-op stub, Coverage of remaining areas

---

## Gray area selection

| Option | Description | Selected |
|--------|-------------|----------|
| Tracks table shape | Extra columns, state enum values, position handling | |
| playlists→sources rename | Rename table, adjust sourceType enum, add slug/cover columns, drop flag columns | |
| DB wipe + reset notice | First-boot detection (file delete vs marker vs fingerprint) + UI notice surface | |
| Scheduler no-op stub | Scheduler disabled vs tick-but-noop; event emission; invocation UI behavior | ✓ |

**User's choice:** Scheduler no-op stub
**Notes:** User also free-texted: "for the db wipe — just do it, there's not a single prod instance". DB-wipe mechanism question resolved out-of-band: unconditional wipe, no detection ceremony. Other areas deferred to Claude's discretion in a later question.

---

## Scheduler no-op stub — behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Disable entirely | Scheduler doesn't register cron jobs; UI shows 'sync engine not yet configured' | |
| Tick but no-op | Cron fires per schedule, sync body returns immediately | ✓ |
| Keep full wiring, log only | Scheduler runs, creates invocation rows marked 'skipped'; verifies scheduler plumbing | |

**User's choice:** Tick but no-op
**Notes:** Keeps the scheduling wiring warm so Phase 3 plugs in a real engine body without rebuilding cron registration.

---

## Scheduler no-op stub — manual button

| Option | Description | Selected |
|--------|-------------|----------|
| Hide the button (Recommended) | Button disappears while engine absent | ✓ |
| Disable with tooltip | Button visible but disabled, tooltip explains | |
| Click shows toast only | Button clickable, shows toast 'not implemented' | |

**User's choice:** Hide the button
**Notes:** No dead affordances during interim.

---

## Scheduler no-op stub — events

| Option | Description | Selected |
|--------|-------------|----------|
| No events | Silence until Phase 3 | |
| Emit lifecycle events for stub | Still emit started/completed so webhook + metrics handlers don't rot | ✓ |

**User's choice:** Emit lifecycle events for stub
**Notes:** Rationale: keep webhook / metrics / logging handlers exercised on every tick.

---

## DB wipe — library reset notice (CLEANUP-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Drop the notice | No banner, no toast, no dismiss state plumbing | ✓ |
| Keep minimal banner | Single-session banner on /library until first source added | |
| Keep via global_settings flag | Proper one-shot with dismiss flag | |

**User's choice:** Drop the notice
**Notes:** Explicit requirement amendment: Phase 1 Success Criterion #4 and CLEANUP-03's "library reset" notice are dropped. No prod instance, no users to inform.

---

## Stub tick — invocation rows

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, rows with 'success' | Zero-count rows with stub summary | |
| Yes, rows with new 'stub' status | Adds 'stub' to invocation status enum | |
| No rows, events only | Events fire, no DB writes | ✓ |

**User's choice:** No rows, events only
**Notes:** Avoids schema churn in `invocations` table that Phase 3 will rework. Sync history stays empty during interim — correct reflection of reality.

---

## Coverage — remaining areas

| Option | Description | Selected |
|--------|-------------|----------|
| Discuss tracks table shape | Extra columns, state enum, position handling | |
| Discuss playlists→sources rename | Table name, sourceType enum, slug/cover columns | |
| Discuss flag column cleanup | Drop flagsOverwrite/Retries/Quality/Format entirely | |
| Leave all to Claude's discretion | Skip remaining, standard approaches fine | ✓ |

**User's choice:** Leave all to Claude's discretion
**Notes:** Requirements (TRACK-01/02) are tight enough to anchor the tracks shape. Naming + flag cleanup are routine cleanup — trust planner.

---

## Claude's Discretion

- Exact DB wipe mechanism (delete `data/db.sqlite` vs schema drop/recreate)
- Tracks table indexes beyond the required unique key
- Whether to rename `playlists` → `sources` now or defer
- Invocation table column trimming
- Scheduler disable-vs-keep-wired at the `croner` level as long as stub body short-circuits

## Deferred Ideas

- Library reset UI notice (CLEANUP-03) — dropped for this milestone
- Keeping `flagsFormat` for future format switching — v2 consideration (FMT2-01/FMT2-02)
- `invocations` table simplification — deferred to Phase 3
- Scheduler concurrency knob / stub-tick visibility in UI — revisit in Phase 3
