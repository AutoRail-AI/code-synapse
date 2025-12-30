/**
 * Type-Safe Event Bus
 *
 * Provides a strongly-typed pub/sub mechanism for progress updates,
 * status changes, and cross-module communication.
 *
 * @module
 */

// =============================================================================
// Event Types
// =============================================================================

/**
 * Event handler function type
 */
export type EventHandler<T> = (payload: T) => void;

/**
 * Async event handler function type
 */
export type AsyncEventHandler<T> = (payload: T) => void | Promise<void>;

// =============================================================================
// Event Bus Implementation
// =============================================================================

/**
 * Type-safe event emitter for decoupled communication.
 *
 * @example
 * ```typescript
 * interface MyEvents {
 *   'user:login': { userId: string };
 *   'user:logout': void;
 * }
 *
 * const bus = new EventBus<MyEvents>();
 * bus.on('user:login', ({ userId }) => console.log(userId));
 * bus.emit('user:login', { userId: '123' });
 * ```
 */
export class EventBus<Events extends object> {
  private handlers = new Map<keyof Events, Set<EventHandler<unknown>>>();

  /**
   * Subscribes to an event.
   *
   * @param event - Event name to subscribe to
   * @param handler - Handler function to call when event is emitted
   * @returns Unsubscribe function
   */
  on<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as EventHandler<unknown>);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribes from an event.
   *
   * @param event - Event name to unsubscribe from
   * @param handler - Handler function to remove
   */
  off<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as EventHandler<unknown>);
  }

  /**
   * Emits an event to all subscribers.
   *
   * @param event - Event name to emit
   * @param payload - Event payload
   */
  emit<K extends keyof Events>(event: K, payload: Events[K]): void {
    this.handlers.get(event)?.forEach((handler) => handler(payload));
  }

  /**
   * Subscribes to an event for a single emission.
   *
   * @param event - Event name to subscribe to
   * @param handler - Handler function to call once
   * @returns Unsubscribe function
   */
  once<K extends keyof Events>(event: K, handler: EventHandler<Events[K]>): () => void {
    const wrappedHandler: EventHandler<Events[K]> = (payload) => {
      this.off(event, wrappedHandler);
      handler(payload);
    };
    return this.on(event, wrappedHandler);
  }

  /**
   * Waits for an event to be emitted.
   *
   * @param event - Event name to wait for
   * @param timeoutMs - Optional timeout in milliseconds
   * @returns Promise that resolves with the event payload
   */
  waitFor<K extends keyof Events>(event: K, timeoutMs?: number): Promise<Events[K]> {
    return new Promise((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const unsubscribe = this.once(event, (payload) => {
        if (timeoutId) clearTimeout(timeoutId);
        resolve(payload);
      });

      if (timeoutMs !== undefined) {
        timeoutId = setTimeout(() => {
          unsubscribe();
          reject(new Error(`Timeout waiting for event: ${String(event)}`));
        }, timeoutMs);
      }
    });
  }

  /**
   * Removes all handlers for a specific event or all events.
   *
   * @param event - Optional event name to clear (clears all if not provided)
   */
  clear<K extends keyof Events>(event?: K): void {
    if (event !== undefined) {
      this.handlers.delete(event);
    } else {
      this.handlers.clear();
    }
  }

  /**
   * Returns the number of handlers for a specific event.
   */
  listenerCount<K extends keyof Events>(event: K): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  /**
   * Returns all registered event names.
   */
  eventNames(): Array<keyof Events> {
    return Array.from(this.handlers.keys());
  }
}

// =============================================================================
// Async Event Bus
// =============================================================================

/**
 * Event bus that supports async handlers and waits for all to complete.
 */
export class AsyncEventBus<Events extends object> {
  private handlers = new Map<keyof Events, Set<AsyncEventHandler<unknown>>>();

  /**
   * Subscribes to an event with an async handler.
   */
  on<K extends keyof Events>(event: K, handler: AsyncEventHandler<Events[K]>): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler as AsyncEventHandler<unknown>);
    return () => this.off(event, handler);
  }

  /**
   * Unsubscribes from an event.
   */
  off<K extends keyof Events>(event: K, handler: AsyncEventHandler<Events[K]>): void {
    this.handlers.get(event)?.delete(handler as AsyncEventHandler<unknown>);
  }

  /**
   * Emits an event and waits for all handlers to complete.
   */
  async emit<K extends keyof Events>(event: K, payload: Events[K]): Promise<void> {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return;

    const promises: Promise<void>[] = [];
    for (const handler of eventHandlers) {
      const result = handler(payload);
      if (result instanceof Promise) {
        promises.push(result);
      }
    }

    await Promise.all(promises);
  }

  /**
   * Emits an event and waits for all handlers, collecting errors.
   * Does not throw on handler errors; returns them instead.
   */
  async emitSafe<K extends keyof Events>(
    event: K,
    payload: Events[K]
  ): Promise<Error[]> {
    const eventHandlers = this.handlers.get(event);
    if (!eventHandlers) return [];

    const errors: Error[] = [];
    const promises: Promise<void>[] = [];

    for (const handler of eventHandlers) {
      promises.push(
        Promise.resolve()
          .then(() => handler(payload))
          .catch((error) => {
            errors.push(error instanceof Error ? error : new Error(String(error)));
          })
      );
    }

    await Promise.all(promises);
    return errors;
  }

  /**
   * Removes all handlers.
   */
  clear(): void {
    this.handlers.clear();
  }
}

// =============================================================================
// Pre-defined Event Types
// =============================================================================

/**
 * Indexer progress events
 */
export interface IndexerEvents {
  /** Indexing started */
  "indexer:start": { totalFiles: number };
  /** Progress update during indexing */
  "indexer:progress": { processed: number; total: number; currentFile: string };
  /** Single file completed */
  "indexer:file:done": { filePath: string; duration: number };
  /** Single file errored */
  "indexer:file:error": { filePath: string; error: Error };
  /** Indexing completed */
  "indexer:complete": { totalFiles: number; duration: number; errors: number };
}

/**
 * File watcher events
 */
export interface WatcherEvents {
  /** File change detected */
  "watcher:change": { path: string; type: "add" | "change" | "unlink" };
  /** Watcher error */
  "watcher:error": { error: Error };
  /** Watcher ready */
  "watcher:ready": undefined;
}

/**
 * Parser events
 */
export interface ParserEvents {
  /** Parse started */
  "parser:start": { filePath: string };
  /** Parse completed */
  "parser:done": { filePath: string; duration: number };
  /** Parse error */
  "parser:error": { filePath: string; error: Error };
}

/**
 * Database events
 */
export interface DatabaseEvents {
  /** Database connected */
  "db:connected": { path: string };
  /** Database disconnected */
  "db:disconnected": { path: string };
  /** Database error */
  "db:error": { error: Error };
  /** Transaction started */
  "db:tx:start": { id: string };
  /** Transaction committed */
  "db:tx:commit": { id: string };
  /** Transaction rolled back */
  "db:tx:rollback": { id: string };
}

/**
 * Combined application events
 */
export interface AppEvents
  extends IndexerEvents,
    WatcherEvents,
    ParserEvents,
    DatabaseEvents {}

// =============================================================================
// Global Event Bus (Optional)
// =============================================================================

/**
 * Creates a global event bus for the application.
 * Use sparingly - prefer dependency injection for testability.
 */
let globalBus: EventBus<AppEvents> | undefined;

export function getGlobalEventBus(): EventBus<AppEvents> {
  if (!globalBus) {
    globalBus = new EventBus<AppEvents>();
  }
  return globalBus;
}

/**
 * Resets the global event bus (for testing).
 */
export function resetGlobalEventBus(): void {
  globalBus?.clear();
  globalBus = undefined;
}
