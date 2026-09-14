import type { MessagingClient } from "./client.js";
import { byRecentActivity } from "./conversation-operations.js";
import { byOldestFirst } from "./message-operations.js";
import type { Conversation, ConversationId, ListMessagesOptions, Message } from "./models.js";

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

/**
 * A timeline that can also go backwards.
 *
 * Reaching further back is part of reading a conversation, not a separate thing an application has to sew
 * onto one: without it, a live timeline is only ever the end of the conversation and whoever scrolls up
 * reloads it by hand and reconciles the result themselves.
 */
export interface LiveTimeline extends LiveCollection<Message> {
  /** Goes back by `limit` more and answers whether there is anything older still. */
  readonly loadMore: (limit?: number) => Promise<boolean>;
}

/** The conversations the user takes part in, ordered as `conversations.list` returns them. */
export function createConversationList(client: MessagingClient): LiveCollection<Conversation> {
  const collection = new Collection<Conversation>(
    () => client.conversations.list(),
    error => client.emitListenerError(error)
  );
  collection.follow(
    client.on("conversation.updated", conversation => {
      if (collection.isStopped()) return;
      const current = collection.get();
      // Reading every conversation again because one of them had a message is what makes a busy account crawl.
      // The one that changed arrives whole, so it is put in place and the rest are left alone.
      const known = current.some(item => item.id === conversation.id);
      if (!known) {
        // Reloading is asking the adapter again, and it can refuse. Nobody is holding this promise, so
        // where it goes wrong is said on the same channel as anything else that goes wrong in here.
        void collection.refresh().catch(error => client.emitListenerError(error));
        return;
      }
      const replaced = current.map(item => (item.id === conversation.id ? conversation : item));
      collection.replace(byRecentActivity(replaced));
    })
  );
  return collection;
}

/**
 * The timeline of one conversation, oldest first, with the local echo of each message resolved.
 *
 * `options` is handed on to `messages.list` every time it reloads. Asking for `atLeast` is how a screen opens
 * a conversation with something to read: what the sync happened to bring is not a number anybody chose.
 */
export function createMessageTimeline(
  client: MessagingClient,
  conversationId: ConversationId,
  options?: ListMessagesOptions
): LiveTimeline {
  const collection = new Collection<Message>(
    () => client.messages.list(conversationId, options),
    error => client.emitListenerError(error)
  );
  const apply = (message: Message): void => {
    if (message.conversationId !== conversationId || collection.isStopped()) return;
    // What hangs from a thread is read as a thread, the same as when the conversation was listed. Without
    // this, a conversation with a thread going in it fills up with the answers as they arrive, and reads
    // one way on the way in and another way afterwards.
    if (message.threadId !== undefined) return;
    collection.replace(merge(collection.get(), message));
  };
  collection.follow(client.on("message.received", apply));
  collection.follow(client.on("message.updated", apply));
  return Object.assign(collection, {
    loadMore: async (limit = defaultStepBack): Promise<boolean> => {
      const page = await client.messages.loadMore(conversationId, limit);
      // Put together with what is on screen rather than put in its place. Reaching further back can come
      // back with less than is already here — history out of reach for a moment answers with the local copy,
      // which on a device that was not there is nothing — and going back must never take anything away.
      collection.replace(alsoHaving(collection.get(), page.messages));
      return page.hasMore;
    }
  });
}

/** How much further back to go when nobody says, which is about a screenful. */
const defaultStepBack = 20;

/** Two stretches of the same conversation as one, oldest first, each message appearing once. */
function alsoHaving(here: readonly Message[], arriving: readonly Message[]): readonly Message[] {
  const byKey = new Map(here.map(message => [keyOf(message), message]));
  for (const message of arriving) byKey.set(keyOf(message), message);
  return [...byKey.values()].sort(byOldestFirst);
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
