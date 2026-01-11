# Event Bus

A type-safe, server-side event bus for handling asynchronous job coordination and decoupling in the spotdl-manager application.

## Overview

The Event Bus implements a publish-subscribe pattern that allows different parts of the application to communicate without tight coupling. It's particularly useful for:

- Tracking playlist sync lifecycle events
- Triggering side effects (notifications, metrics, cleanup)
- Coordinating between scheduler, invocator, and repository layers
- Enabling extensibility through custom event handlers

## Architecture

```
┌─────────────────┐
│   EventBus      │
│   (Singleton)   │
└────────┬────────┘
         │
         ├─── Type-safe events (Zod schemas)
         │
         ├─── Event handlers (sync/async)
         │
         └─── Event emission with enrichment
```

### Key Components

- **`schema.ts`**: Zod schemas for all event types with type inference
- **`EventBus.ts`**: Core pub/sub implementation with singleton pattern
- **`handlers.ts`**: Pre-built event handlers for common use cases
- **`index.ts`**: Public API exports

## Event Types

### Playlist Sync Lifecycle

1. **`playlist.sync.started`** - Sync job initiated
   ```typescript
   {
     playlistId: string
     playlistName: string
     invocationId: string (UUID)
     sourceUrl: string
     outputDir: string
   }
   ```

2. **`playlist.sync.completed`** - Sync finished successfully
   ```typescript
   {
     playlistId: string
     playlistName: string
     invocationId: string (UUID)
     duration: number (ms)
     exitCode: number
     summary?: string
     logPath?: string
     syncFilePath?: string
   }
   ```

3. **`playlist.sync.failed`** - Sync encountered an error
   ```typescript
   {
     playlistId: string
     playlistName: string
     invocationId: string (UUID)
     error: string
     exitCode?: number
     logPath?: string
   }
   ```

4. **`playlist.sync.canceled`** - Sync was canceled
   ```typescript
   {
     playlistId: string
     playlistName: string
     invocationId: string (UUID)
     reason?: string
   }
   ```

### Playlist Management

5. **`playlist.created`** - New playlist added
   ```typescript
   {
     playlistId: string
     playlistName: string
     sourceUrl: string
   }
   ```

6. **`playlist.updated`** - Playlist modified
   ```typescript
   {
     playlistId: string
     playlistName: string
     changes: Record<string, unknown>
   }
   ```

7. **`playlist.deleted`** - Playlist removed
   ```typescript
   {
     playlistId: string
     playlistName: string
   }
   ```

### System Events

8. **`scheduler.reload`** - Scheduler refresh requested
   ```typescript
   {
     reason?: string
   }
   ```

## Usage

### Basic Subscription

```typescript
import { getEventBus } from '~/modules/server/events';

const bus = getEventBus();

// Subscribe to specific event
const unsubscribe = bus.on('playlist.sync.completed', (event) => {
  console.log('Sync completed:', event.payload.playlistName);
  console.log('Duration:', event.payload.duration, 'ms');
});

// Unsubscribe when done
unsubscribe();
```

### Subscribe to All Events

```typescript
bus.onAny((event) => {
  console.log(`[${event.type}]`, event.timestamp, event.payload);
});
```

### One-Time Subscription

```typescript
bus.once('playlist.sync.started', (event) => {
  console.log('First sync started:', event.payload.playlistName);
});
```

### Emitting Events

```typescript
// Simple emit (id and timestamp auto-generated)
await bus.emit({
  type: 'playlist.sync.started',
  payload: {
    playlistId: 'pl-123',
    playlistName: 'My Playlist',
    invocationId: randomUUID(),
    sourceUrl: 'https://spotify.com/...',
    outputDir: '/downloads'
  }
});

// Emit with custom id/timestamp
await bus.emit({
  id: 'custom-id',
  timestamp: new Date(),
  type: 'playlist.created',
  payload: { ... }
});
```

### Type Safety

The event bus is fully type-safe. TypeScript will enforce correct payload structures:

```typescript
// ✅ Correct
bus.on('playlist.sync.completed', (event) => {
  const duration: number = event.payload.duration; // OK
});

// ❌ TypeScript error - wrong payload structure
bus.on('playlist.sync.completed', (event) => {
  const url: string = event.payload.sourceUrl; // Error: Property doesn't exist
});
```

## Pre-Built Handlers

The `handlers.ts` module provides ready-to-use handlers:

### Logging Handler
```typescript
import { registerLoggingHandler } from '~/modules/server/events';

// Log all events to console
const unsubscribe = registerLoggingHandler();
```

### Metrics Handler
```typescript
import { registerMetricsHandler } from '~/modules/server/events';

// Track sync success rate and average duration
const unsubscribe = registerMetricsHandler();
```

### Scheduler Reload Handler
```typescript
import { registerSchedulerReloadHandler } from '~/modules/server/events';
import { getScheduler } from '~/modules/server/scheduler';

// Auto-reload scheduler when playlists change
const unsubscribe = registerSchedulerReloadHandler(async () => {
  await getScheduler().reload();
});
```

### Duration Warning Handler
```typescript
import { registerSyncDurationWarningHandler } from '~/modules/server/events';

// Warn if sync takes longer than 5 minutes
const unsubscribe = registerSyncDurationWarningHandler(300000);
```

### Failure Notification Handler
```typescript
import { registerFailureNotificationHandler } from '~/modules/server/events';

// Send webhook on sync failure
const unsubscribe = registerFailureNotificationHandler(
  async (playlistName, error) => {
    await fetch('https://hooks.example.com/failure', {
      method: 'POST',
      body: JSON.stringify({ playlistName, error })
    });
  }
);
```

### Log Cleanup Handler
```typescript
import { registerLogCleanupHandler } from '~/modules/server/events';
import { unlink } from 'node:fs/promises';

// Keep only 5 most recent logs per playlist
const unsubscribe = registerLogCleanupHandler(
  async (logPath) => await unlink(logPath),
  5 // retention count
);
```

## Custom Handlers

Create custom handlers for your use cases:

```typescript
import { getEventBus } from '~/modules/server/events';

// Track consecutive failures
const failureCounts = new Map<string, number>();

bus.on('playlist.sync.failed', (event) => {
  const { playlistId, playlistName } = event.payload;
  const count = (failureCounts.get(playlistId) || 0) + 1;
  failureCounts.set(playlistId, count);
  
  if (count >= 3) {
    console.error(`Playlist "${playlistName}" has failed ${count} times!`);
    // Disable playlist, send alert, etc.
  }
});

bus.on('playlist.sync.completed', (event) => {
  // Reset failure count on success
  failureCounts.delete(event.payload.playlistId);
});
```

## Integration

The event bus is initialized in the Nitro plugin at `server/plugins/events.ts`:

```typescript
// server/plugins/events.ts
export default (nitroApp: NitroApp) => {
  const eventBus = getEventBus();
  
  // Register handlers
  registerLoggingHandler();
  registerMetricsHandler();
  registerSchedulerReloadHandler(async () => {
    await getScheduler().reload();
  });
  
  // Cleanup on shutdown
  nitroApp.hooks.hook("close", () => {
    eventBus.clear();
  });
};
```

Events are emitted from:

1. **PlaylistScheduler** - Sync lifecycle events during scheduled runs
2. **Playlist repository** - CRUD events (create/update/delete)
3. **Manual invocations** - User-triggered sync operations

## Testing

The event bus includes comprehensive unit tests:

```bash
pnpm test src/modules/server/events/EventBus.test.ts
```

Test coverage includes:
- Singleton instance management
- Event subscription/unsubscription
- One-time handlers
- Global handlers (onAny)
- Event enrichment (id, timestamp)
- Error handling in async handlers
- Type safety verification

## Best Practices

1. **Always unsubscribe**: Store the unsubscribe function and call it when handlers are no longer needed
   ```typescript
   const unsubscribe = bus.on('event.type', handler);
   // Later...
   unsubscribe();
   ```

2. **Use specific event types**: Subscribe to specific events rather than using `onAny` unless truly needed

3. **Handle errors**: Wrap handler logic in try-catch to prevent one handler from breaking others
   ```typescript
   bus.on('event.type', async (event) => {
     try {
       await riskyOperation(event);
     } catch (error) {
       console.error('Handler failed:', error);
     }
   });
   ```

4. **Keep handlers lightweight**: Offload heavy processing to background jobs or queues

5. **Test handlers independently**: Create unit tests for custom handlers using mock events

6. **Document custom events**: If adding new event types, update the schema and this README

## Extending with New Events

To add a new event type:

1. **Define schema** in `schema.ts`:
   ```typescript
   export const MyNewEventSchema = BaseEventSchema.extend({
     type: z.literal("my.new.event"),
     payload: z.object({
       myField: z.string(),
     }),
   });
   ```

2. **Add to union** in `schema.ts`:
   ```typescript
   export const EventSchema = z.discriminatedUnion("type", [
     // ... existing events
     MyNewEventSchema,
   ]);
   ```

3. **Export types**:
   ```typescript
   export type MyNewEvent = z.infer<typeof MyNewEventSchema>;
   ```

4. **Emit the event** where appropriate:
   ```typescript
   await bus.emit({
     type: 'my.new.event',
     payload: { myField: 'value' }
   });
   ```

5. **Create handlers** if needed in `handlers.ts`

6. **Update this README** with event documentation

## Performance Considerations

- Handlers run in parallel using `Promise.allSettled`
- Failed handlers don't block other handlers
- Singleton pattern ensures single event bus instance
- Minimal overhead for event enrichment (UUID + timestamp)
- No event persistence (in-memory only)

For high-throughput scenarios, consider:
- Batching events
- Using a message queue (Redis, RabbitMQ)
- Implementing rate limiting on handlers

## Future Enhancements

Potential improvements:

- [ ] Event persistence for audit trails
- [ ] Event replay capabilities
- [ ] Priority-based handler execution
- [ ] Event filtering/routing rules
- [ ] Performance metrics (handler execution time)
- [ ] Dead letter queue for failed events
- [ ] Integration with external message brokers
