import { randomUUID } from "node:crypto";
import type { Event, EventType } from "./schema";

/**
 * Event handler function type
 */
export type EventHandler<T extends Event = Event> = (
	event: T,
) => void | Promise<void>;

/**
 * Event handler with metadata
 */
interface HandlerRegistration {
	id: string;
	handler: EventHandler;
	eventType?: EventType;
}

/**
 * Server-side event bus for async job coordination and decoupling
 * Implements pub/sub pattern with type-safe event handling
 *
 * Usage:
 * ```typescript
 * const bus = EventBus.getInstance();
 *
 * // Subscribe to specific event
 * bus.on('playlist.sync.completed', (event) => {
 *   console.log('Sync completed:', event.payload.playlistName);
 * });
 *
 * // Subscribe to all events
 * bus.onAny((event) => {
 *   console.log('Event:', event.type);
 * });
 *
 * // Emit event
 * await bus.emit({
 *   type: 'playlist.sync.started',
 *   payload: { ... }
 * });
 * ```
 */
export class EventBus {
	private static instance: EventBus | null = null;

	private handlers: Map<EventType, Set<HandlerRegistration>> = new Map();
	private globalHandlers: Set<HandlerRegistration> = new Set();

	private constructor() {}

	/**
	 * Get singleton instance of EventBus
	 */
	static getInstance(): EventBus {
		if (!EventBus.instance) {
			EventBus.instance = new EventBus();
		}
		return EventBus.instance;
	}

	/**
	 * Reset singleton instance (primarily for testing)
	 */
	static resetInstance(): void {
		EventBus.instance = null;
	}

	/**
	 * Subscribe to a specific event type
	 * Returns unsubscribe function
	 */
	on<T extends EventType>(
		eventType: T,
		handler: EventHandler<Extract<Event, { type: T }>>,
	): () => void {
		const registration: HandlerRegistration = {
			id: randomUUID(),
			handler: handler as EventHandler,
			eventType,
		};

		if (!this.handlers.has(eventType)) {
			this.handlers.set(eventType, new Set());
		}

		const handlerSet = this.handlers.get(eventType);
		if (handlerSet) {
			handlerSet.add(registration);
		}

		// Return unsubscribe function
		return () => {
			const handlerSet = this.handlers.get(eventType);
			if (handlerSet) {
				handlerSet.delete(registration);
				if (handlerSet.size === 0) {
					this.handlers.delete(eventType);
				}
			}
		};
	}

	/**
	 * Subscribe to all events
	 * Returns unsubscribe function
	 */
	onAny(handler: EventHandler): () => void {
		const registration: HandlerRegistration = {
			id: randomUUID(),
			handler,
		};

		this.globalHandlers.add(registration);

		// Return unsubscribe function
		return () => {
			this.globalHandlers.delete(registration);
		};
	}

	/**
	 * Subscribe once to a specific event type
	 * Auto-unsubscribes after first invocation
	 */
	once<T extends EventType>(
		eventType: T,
		handler: EventHandler<Extract<Event, { type: T }>>,
	): () => void {
		let unsubscribe: (() => void) | null = null;

		const wrappedHandler: EventHandler<Extract<Event, { type: T }>> = async (
			event,
		) => {
			if (unsubscribe) {
				unsubscribe();
			}
			await handler(event);
		};

		unsubscribe = this.on(eventType, wrappedHandler);
		return unsubscribe;
	}

	/**
	 * Emit an event to all subscribed handlers
	 * Enriches event with id and timestamp if not provided
	 */
	async emit(event: Omit<Event, "id" | "timestamp">): Promise<void>;
	async emit(event: Event): Promise<void>;
	async emit(event: Omit<Event, "id" | "timestamp"> | Event): Promise<void> {
		// Enrich event with id and timestamp if not present
		const enrichedEvent: Event = {
			...event,
			id: "id" in event ? event.id : randomUUID(),
			timestamp: "timestamp" in event ? event.timestamp : new Date(),
		} as Event;

		const eventType = enrichedEvent.type;
		const promises: Promise<void>[] = [];

		// Call specific event handlers
		const typeHandlers = this.handlers.get(eventType);
		if (typeHandlers) {
			for (const registration of typeHandlers) {
				promises.push(this.safeInvoke(registration.handler, enrichedEvent));
			}
		}

		// Call global handlers
		for (const registration of this.globalHandlers) {
			promises.push(this.safeInvoke(registration.handler, enrichedEvent));
		}

		// Wait for all handlers to complete
		await Promise.allSettled(promises);
	}

	/**
	 * Safely invoke handler with error logging
	 */
	private async safeInvoke(handler: EventHandler, event: Event): Promise<void> {
		try {
			await handler(event);
		} catch (error) {
			console.error(
				`[EventBus] Handler failed for event ${event.type}:`,
				error,
			);
		}
	}

	/**
	 * Remove all handlers for a specific event type
	 */
	off(eventType: EventType): void {
		this.handlers.delete(eventType);
	}

	/**
	 * Remove all handlers
	 */
	clear(): void {
		this.handlers.clear();
		this.globalHandlers.clear();
	}

	/**
	 * Get count of handlers for an event type
	 */
	getHandlerCount(eventType?: EventType): number {
		if (eventType) {
			return this.handlers.get(eventType)?.size ?? 0;
		}

		let total = this.globalHandlers.size;
		for (const handlers of this.handlers.values()) {
			total += handlers.size;
		}
		return total;
	}
}

/**
 * Helper to get the event bus instance
 */
export function getEventBus(): EventBus {
	return EventBus.getInstance();
}
