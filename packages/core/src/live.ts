import type { MessagingClient } from "./client.js";
import { byRecentActivity } from "./conversation-operations.js";
import { byOldestFirst } from "./message-operations.js";
import type { Conversation, ConversationId, Message } from "./models.js";

/**
 * A list that keeps itself current while the client runs. It exists so every application stops rewriting the
 * same glue: reconciling the local echo of a message, ordering, and reloading after every change.
 *
 * `subscribe` and `get` are bound, so they can be handed straight to a UI framework, for example to
 * `useSyncExternalStore` in React.
 */
export interface LiveCollection<Item> {
  readonly subscribe: (listener: () => void) => () => void;
  /** The current snapshot. The same reference is returned while the contents do not change. */
  readonly get: () => readonly Item[];
  readonly refresh: () => Promise<void>;
  readonly stop: () => void;
}

class Collection<Item> {
  private snapshot: readonly Item[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribers: (() => void)[] = [];
  private loading = false;
  private stale = false;
  private stopped = false;
  private repaintScheduled = false;

  constructor(
    private readonly load: () => Promise<readonly Item[]>,
    private readonly onListenerError: (error: unknown) => void = () => {}
  ) {}

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  readonly get = (): readonly Item[] => this.snapshot;

  /** Concurrent refreshes collapse into one more pass, so a burst of updates costs a single reload. */
  readonly refresh = async (): Promise<void> => {
    if (this.loading) {
      this.stale = true;
      return;
    }
    this.loading = true;
    try {
      do {
        this.stale = false;
        this.replace(await this.load());
      } while (this.stale && !this.stopped);
    } finally {
      this.loading = false;
    }
  };

  readonly stop = (): void => {
    this.stopped = true;
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.listeners.clear();
  };

  follow(unsubscribe: () => void): void {
    this.unsubscribers.push(unsubscribe);
  }

  replace(items: readonly Item[]): void {
    if (this.stopped || isSameContent(this.snapshot, items)) {
      return;
    }
    // The snapshot is current at once, so whoever asks gets the truth. Telling everybody waits until the end of
    // the turn: catching up delivers hundreds of changes in a row, and each one was a repaint of its own.
    this.snapshot = items;
    if (this.repaintScheduled) return;
    this.repaintScheduled = true;
    queueMicrotask(() => {
      this.repaintScheduled = false;
      if (this.stopped) return;
      // One subscriber that throws must not leave the rest of the screen stale, and must not become an
      // unhandled rejection out here where nobody can catch it.
      for (const listener of this.listeners) {
        try {
          listener();
        } catch (error) {
          this.onListenerError(error);
        }
      }
    });
  }

  isStopped(): boolean {
    return this.stopped;
  }
}

/** The conversations the user takes part in, ordered as `conversations.list` returns them. */
export function createConversationList(client: MessagingClient): LiveCollection<Conversation> {
  const collection = new Collection<Conversation>(
    () => client.conversations.list(),
    error => client.emitListenerError(error)
  );
  collection.follow(client.on("conversation.updated", conversation => {
    if (collection.isStopped()) return;
    const current = collection.get();
    // Reading every conversation again because one of them had a message is what makes a busy account crawl.
    // The one that changed arrives whole, so it is put in place and the rest are left alone.
    const known = current.some(item => item.id === conversation.id);
    if (!known) {
      void collection.refresh();
      return;
    }
    const replaced = current.map(item => (item.id === conversation.id ? conversation : item));
    collection.replace(byRecentActivity(replaced));
  }));
  return collection;
}

/** The timeline of one conversation, oldest first, with the local echo of each message resolved. */
export function createMessageTimeline(client: MessagingClient, conversationId: ConversationId): LiveCollection<Message> {
  const collection = new Collection<Message>(
    () => client.messages.list(conversationId),
    error => client.emitListenerError(error)
  );
  const apply = (message: Message): void => {
    if (message.conversationId !== conversationId || collection.isStopped()) return;
    collection.replace(merge(collection.get(), message));
  };
  collection.follow(client.on("message.received", apply));
  collection.follow(client.on("message.updated", apply));
  return collection;
}

/** A queued message arrives again with its server id once sent, so the transaction id is what links both. */
function keyOf(message: Message): string {
  return message.transactionId ?? message.id;
}

function merge(messages: readonly Message[], incoming: Message): readonly Message[] {
  const key = keyOf(incoming);
  const without = messages.filter(message => keyOf(message) !== key);
  if (incoming.status === "cancelled") {
    return without;
  }
  // The same order the client returns, tie breaker included, so the screen never shows a different one.
  return [...without, incoming].sort(byOldestFirst);
}

function isSameContent<Item>(current: readonly Item[], next: readonly Item[]): boolean {
  return current.length === next.length && current.every((item, index) => shallowEqual(item, next[index]));
}

function shallowEqual(left: unknown, right: unknown): boolean {
  // Almost always the very same object, and comparing those by hand costs nothing.
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}
