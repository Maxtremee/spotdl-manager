# Event Bus Architecture Diagram

## System Overview

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Nitro Server                               │
│                                                                     │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │                    server/plugins/events.ts                   │ │
│  │  Initialize EventBus & Register Handlers on Startup           │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                 │                                   │
│                                 ▼                                   │
│  ┌───────────────────────────────────────────────────────────────┐ │
│  │            EventBus (Singleton)                               │ │
│  │  ┌─────────────────────────────────────────────────────────┐ │ │
│  │  │  Event Handlers Map                                      │ │ │
│  │  │  - playlist.sync.started    → [handler1, handler2]      │ │ │
│  │  │  - playlist.sync.completed  → [handler3]                │ │ │
│  │  │  - playlist.sync.failed     → [handler4, handler5]      │ │ │
│  │  │  - ...                                                   │ │ │
│  │  │                                                          │ │ │
│  │  │  Global Handlers: [loggingHandler, metricsHandler]      │ │ │
│  │  └─────────────────────────────────────────────────────────┘ │ │
│  └───────────────────────────────────────────────────────────────┘ │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

           ▲                                 ▲
           │ emit()                          │ emit()
           │                                 │
           │                                 │

┌──────────────────────────┐       ┌──────────────────────────┐
│   PlaylistScheduler      │       │  Future: Playlist        │
│                          │       │  CRUD Operations         │
│  - executePlaylistSync() │       │                          │
│  - schedulePlaylist()    │       │  - createPlaylist()      │
│  - unschedulePlaylist()  │       │  - updatePlaylist()      │
│  - reload()              │       │  - deletePlaylist()      │
└──────────────────────────┘       └──────────────────────────┘

           │                                 │
           │ Events Emitted:                 │ Events Emitted:
           │                                 │
           ├─ playlist.sync.started          ├─ playlist.created
           ├─ playlist.sync.completed        ├─ playlist.updated
           ├─ playlist.sync.failed           └─ playlist.deleted
           └─ playlist.sync.canceled
```

## Event Flow Example: Scheduled Sync

```
  1. Cron Timer Triggers
         │
         ▼
  2. PlaylistScheduler.executePlaylistSync()
         │
         ├─────────────────────────────────────┐
         │                                     │
         ▼                                     ▼
  3. EventBus.emit()                    4. SpotdlInvocator.run()
     'playlist.sync.started'                   │
         │                                     │
         ▼                                     │
  5. Handlers Execute:                        │
     - Log to console                         │
     - Track start time                       │
     - Update UI (future)                     │
                                              │
                                              ▼
                                        6. spotdl CLI Executes
                                              │
         ┌────────────────────────────────────┤
         │                                    │
         ▼                                    ▼
  7a. Success                           7b. Failure
      │                                      │
      ▼                                      ▼
  8a. EventBus.emit()                   8b. EventBus.emit()
      'playlist.sync.completed'             'playlist.sync.failed'
      │                                      │
      ▼                                      ▼
  9a. Handlers Execute:                 9b. Handlers Execute:
      - Log completion                       - Log error
      - Update metrics                       - Send notification
      - Cleanup old logs                     - Track failure count
      - Update UI (future)                   - Alert admin
```

## Handler Registration Flow

```
Server Startup
     │
     ▼
server/plugins/events.ts
     │
     ├──> registerLoggingHandler()
     │         │
     │         └──> bus.onAny(handler)
     │
     ├──> registerMetricsHandler()
     │         │
     │         ├──> bus.on('playlist.sync.completed', ...)
     │         └──> bus.on('playlist.sync.failed', ...)
     │
     ├──> registerSchedulerReloadHandler()
     │         │
     │         ├──> bus.on('playlist.created', ...)
     │         ├──> bus.on('playlist.updated', ...)
     │         ├──> bus.on('playlist.deleted', ...)
     │         └──> bus.on('scheduler.reload', ...)
     │
     └──> registerSyncDurationWarningHandler()
               │
               ├──> bus.on('playlist.sync.started', ...)
               └──> bus.on('playlist.sync.completed', ...)
```

## Data Flow: Event Structure

```
┌─────────────────────────────────────────────────────────┐
│                    Event Object                         │
├─────────────────────────────────────────────────────────┤
│  id: string (UUID)           ← Auto-generated          │
│  timestamp: Date             ← Auto-generated          │
│  type: EventType             ← Discriminator           │
│  payload: object             ← Type-safe data          │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│              Zod Schema Validation                      │
│  EventSchema = discriminatedUnion("type", [...])       │
└─────────────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│            TypeScript Type Inference                    │
│  type Event = z.infer<typeof EventSchema>              │
│                                                         │
│  Compiler ensures:                                      │
│  - Correct payload for each event type                 │
│  - No typos in event names                             │
│  - Handlers receive correct types                      │
└─────────────────────────────────────────────────────────┘
```

## Module Boundaries (DDD)

```
src/modules/server/
│
├── events/              ← Event Bus (Infrastructure)
│   ├── schema.ts        ← Event definitions (Domain)
│   ├── EventBus.ts      ← Pub/Sub implementation
│   ├── handlers.ts      ← Pre-built handlers (Application)
│   └── index.ts         ← Public API
│
├── scheduler/           ← Scheduling (Application)
│   └── PlaylistScheduler.ts
│       └── emits: sync events
│
├── invocation/          ← Invocation tracking (Domain)
│   └── repository.ts
│       └── future: emit creation events
│
├── playlist/            ← Playlist management (Domain)
│   └── repository.ts    ← Future implementation
│       └── future: emit CRUD events
│
└── spotdl/              ← spotdl integration (Infrastructure)
    └── SpotdlInvocator.ts

Arrows show event flow:
  Scheduler/Playlist → Events → Handlers
```

## Async Handler Execution

```
EventBus.emit(event)
      │
      ├─────────────────┬─────────────────┬─────────────────┐
      │                 │                 │                 │
      ▼                 ▼                 ▼                 ▼
  Handler 1         Handler 2         Handler 3       Global Handler
    (async)           (sync)            (async)          (async)
      │                 │                 │                 │
      ├─────────────────┴─────────────────┴─────────────────┤
      │                                                      │
      │         Promise.allSettled([...promises])           │
      │              (parallel execution)                   │
      │                                                      │
      └──────────────────────────────────────────────────────┘
                             │
                             ▼
                    All handlers complete
                    (even if some fail)
```

## Error Handling Flow

```
Handler throws error
      │
      ▼
safeInvoke() catches
      │
      ├──> Log error to console
      │
      └──> Continue to next handler
           (no cascade failure)
```

## Extension Pattern

```
1. Define new event in schema.ts
      │
      ├──> Create Zod schema
      ├──> Add to discriminated union
      └──> Export type
      │
      ▼
2. Emit event from source
      │
      └──> await bus.emit({ type: 'new.event', payload: {...} })
      │
      ▼
3. Register handler (optional)
      │
      ├──> In plugin: bus.on('new.event', handler)
      └──> Or: custom module registers own handler
```

## Key Design Decisions

1. **Singleton Pattern**
   - Single EventBus instance across application
   - Prevents event duplication
   - Simplifies lifecycle management

2. **Type-Safe Events**
   - Zod schemas for runtime validation
   - TypeScript for compile-time safety
   - Discriminated unions for efficient routing

3. **Error Isolation**
   - Each handler wrapped in try-catch
   - Failed handlers don't affect others
   - Errors logged but not thrown

4. **Async-First**
   - All handlers can be async
   - Parallel execution with Promise.allSettled
   - No blocking on slow handlers

5. **Unsubscribe Pattern**
   - Each subscription returns unsubscribe function
   - Easy cleanup in tests
   - Prevents memory leaks

6. **Event Enrichment**
   - Auto-generate ID and timestamp
   - Consistent event structure
   - Trace events across system
