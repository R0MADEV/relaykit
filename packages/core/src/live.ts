import type { MessagingClient } from "./client.js";
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

  constructor(private readonly load: () => Promise<readonly Item[]>) {}

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
    this.snapshot = items;
    for (const listener of this.listeners) listener();
  }

  isStopped(): boolean {
    return this.stopped;
  }
}

/** The conversations the user takes part in, ordered as `conversations.list` returns them. */
export function createConversationList(client: MessagingClient): LiveCollection<Conversation> {
  const collection = new Collection<Conversation>(() => client.conversations.list());
  collection.follow(client.on("conversation.updated", () => void collection.refresh()));
  return collection;
}

/** The timeline of one conversation, oldest first, with the local echo of each message resolved. */
export function createMessageTimeline(client: MessagingClient, conversationId: ConversationId): LiveCollection<Message> {
  const collection = new Collection<Message>(() => client.messages.list(conversationId));
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
  return [...without, incoming].sort((left, right) => left.createdAt - right.createdAt);
}

function isSameContent<Item>(current: readonly Item[], next: readonly Item[]): boolean {
  return current.length === next.length && current.every((item, index) => shallowEqual(item, next[index]));
}

function shallowEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
