import { SdkError } from "./errors.js";
import { OutboxOperations, type OutboxOperationsContext } from "./outbox-operations.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type {
  ConversationId,
  FileInput,
  Message,
  MessageId,
  MessagePage,
  MessageSearchOptions,
  ReadReceipt,
  SendFileOptions,
  SendMessageOptions,
  Session
} from "./models.js";

export interface MessageOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly getSession: () => Session | undefined;
  readonly assertStarted: () => void;
  readonly emitMessageUpdated: (message: Message) => void;
  /** How many delivered messages to keep cached per conversation. */
  readonly cachedMessagesPerConversation: number;
  readonly emitError: (error: unknown) => void;
}

export class MessageOperations {
  private readonly receivedMessageIds = new Set<string>();
  private readonly outbox: OutboxOperations;

  constructor(private readonly context: MessageOperationsContext) {
    const baseContext: OutboxOperationsContext = {
      adapter: context.adapter,
      getSession: context.getSession,
      assertStarted: context.assertStarted,
      emitUpdated: context.emitMessageUpdated,
      emitError: context.emitError
    };
    const outboxContext = context.storage
      ? { ...baseContext, storage: context.storage }
      : baseContext;
    this.outbox = new OutboxOperations(outboxContext, this.receivedMessageIds);
  }

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    this.context.assertStarted();
    const stored = this.context.storage ? await this.context.storage.getMessages(conversationId) : [];
    try {
      const messages = await this.context.adapter.listMessages(conversationId);
      await this.persistChanged(messages, stored);
      for (const message of messages) this.receivedMessageIds.add(message.id);
      const merged = this.merge(stored, messages);
      await this.trimCache(merged);
      return merged;
    } catch (error) {
      if (stored.length === 0) throw error;
      return stored;
    }
  }

  async loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage> {
    this.context.assertStarted();
    if (!Number.isInteger(limit) || limit < 1) {
      throw new SdkError("INVALID_INPUT", "Message limit must be a positive integer");
    }
    const stored = this.context.storage ? await this.context.storage.getMessages(conversationId) : [];
    try {
      const page = await this.context.adapter.loadMoreMessages(conversationId, limit);
      await this.persistChanged(page.messages, stored);
      for (const message of page.messages) this.receivedMessageIds.add(message.id);
      return { messages: this.merge(stored, page.messages), hasMore: page.hasMore };
    } catch (error) {
      if (!this.context.storage) throw error;
      // Older history cannot be reached right now, so the cached timeline is all there is to show.
      return { messages: stored, hasMore: false };
    }
  }

  /** Searches messages already available locally. Encrypted history is never searched on the server. */
  async search(query: string, options: MessageSearchOptions = {}): Promise<readonly Message[]> {
    this.context.assertStarted();
    const needle = query.trim().toLowerCase();
    if (!needle) {
      throw new SdkError("INVALID_INPUT", "Search query cannot be empty");
    }
    const conversationIds = options.conversationId
      ? [options.conversationId]
      : (await this.localConversations()).map(conversation => conversation.id);
    const results: Message[] = [];
    for (const conversationId of conversationIds) {
      const messages = await this.localMessages(conversationId);
      for (const message of messages) {
        const matches = message.deletedAt === undefined && message.body.toLowerCase().includes(needle);
        if (matches) results.push(message);
      }
    }
    return results.sort((left, right) => right.createdAt - left.createdAt);
  }

  private localConversations() {
    const { storage, adapter } = this.context;
    return storage ? storage.getConversations() : adapter.listConversations();
  }

  private localMessages(conversationId: ConversationId) {
    const { storage, adapter } = this.context;
    return storage ? storage.getMessages(conversationId) : adapter.listMessages(conversationId);
  }

  sendMessage(conversationId: ConversationId, body: string, options: SendMessageOptions = {}): Promise<Message> {
    return this.outbox.send(conversationId, body, options);
  }

  sendFile(conversationId: ConversationId, file: FileInput, options: SendFileOptions = {}): Promise<Message> {
    return this.outbox.sendFile(conversationId, file, options);
  }

  retryMessage(messageId: MessageId): Promise<Message> {
    return this.outbox.retry(messageId);
  }

  cancelMessage(messageId: MessageId): Promise<Message> {
    return this.outbox.cancel(messageId);
  }

  /** Who has read a message, so an application can show it without knowing anything about receipts. */
  async readBy(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]> {
    this.context.assertStarted();
    if (!messageId.trim()) {
      throw new SdkError("INVALID_INPUT", "A message id is required");
    }
    return this.context.adapter.getReadReceipts(conversationId, messageId);
  }

  async markRead(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    this.context.assertStarted();
    return this.context.adapter.markMessageRead(conversationId, messageId);
  }

  receiveMessage(message: Message): void {
    if (this.receivedMessageIds.has(message.id)) return;
    this.receivedMessageIds.add(message.id);
    void this.persistAndEmit(message);
  }

  private async persistAndEmit(message: Message): Promise<void> {
    try {
      await this.context.storage?.saveMessage(message);
      this.context.emitMessageUpdated(message);
    } catch (error) {
      this.context.emitError(error);
    }
  }

  updateMessage(message: Message): void {
    this.receivedMessageIds.add(message.id);
    void this.persistAndEmit(message);
  }

  flushPending(): Promise<void> {
    return this.outbox.flush();
  }

  clear(): void {
    this.receivedMessageIds.clear();
    this.outbox.cancelScheduledRetries();
  }

  /**
   * The local store is a cache, so old messages are dropped rather than growing without end until the browser
   * runs out of quota. Anything still queued is kept, because only the local copy knows about it.
   */
  private async trimCache(messages: readonly Message[]): Promise<void> {
    const { storage, cachedMessagesPerConversation: limit } = this.context;
    if (!storage || messages.length <= limit) return;
    const delivered = messages.filter(message => message.status === "sent");
    const excess = delivered.length - limit;
    if (excess <= 0) return;
    const oldest = [...delivered].sort((left, right) => left.createdAt - right.createdAt).slice(0, excess);
    await Promise.all(oldest.map(message => storage.deleteMessage(message.id)));
  }

  /** Rewriting a whole timeline on every read is wasted work, and every write is encrypted. */
  private async persistChanged(messages: readonly Message[], stored: readonly Message[]): Promise<void> {
    const { storage } = this.context;
    if (!storage) return;
    const known = new Map(stored.map(message => [message.id, JSON.stringify(message)]));
    const changed = messages.filter(message => known.get(message.id) !== JSON.stringify(message));
    await Promise.all(changed.map(message => storage.saveMessage(message)));
  }

  private merge(stored: readonly Message[], remote: readonly Message[]): readonly Message[] {
    const messages = new Map<string, Message>();
    for (const message of stored) messages.set(message.id, message);
    for (const message of remote) messages.set(message.id, message);
    return [...messages.values()].sort((left, right) => left.createdAt - right.createdAt);
  }
}
