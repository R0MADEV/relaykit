import { SdkError } from "./errors.js";
import { byRecentActivity } from "./conversation-operations.js";
import { RecentIds } from "./recent-ids.js";

/** Enough for a search box, and few enough that a full account still answers at once. */
const defaultSearchResults = 50;

/**
 * Oldest first, and the identifier decides between messages stamped at the same moment. Without that tie
 * breaker the cache boundary moves on every read and the same messages are written and deleted for ever.
 */
export function byOldestFirst(left: Message, right: Message): number {
  return left.createdAt - right.createdAt || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}
import { OutboxOperations, type OutboxOperationsContext } from "./outbox-operations.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type {
  ConversationId,
  FileInput,
  GeoLocation,
  ListMessagesOptions,
  VoiceInfo,
  Message,
  MessageId,
  MessagePage,
  MessageSearchOptions,
  ReadReceipt,
  SendFileOptions,
  SendMessageOptions,
  Session,
  MarkReadOptions,
  ThreadSummary
} from "./models.js";

export interface MessageOperationsContext {
  /** Told when a conversation is read, so whatever keeps the "unread" mark can take it off. */
  readonly wasRead?: (conversationId: ConversationId) => Promise<void>;
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly getSession: () => Session | undefined;
  readonly assertStarted: () => void;
  readonly emitMessageUpdated: (message: Message) => void;
  /** A message arriving is not the same as one already known changing, and applications listen to each. */
  readonly emitMessageReceived: (message: Message) => void;
  /** How many delivered messages to keep cached per conversation. */
  readonly cachedMessagesPerConversation: number;
  /** How many message identifiers to remember so the same message is not announced twice. */
  readonly rememberedMessages: number;
  readonly emitError: (error: unknown) => void;
}

export class MessageOperations {
  private readonly lastReadByConversation = new Map<ConversationId, MessageId>();
  private readonly readToTellAbout = new Map<ConversationId, MessageId>();

  private readonly receivedMessageIds: RecentIds;
  private readonly outbox: OutboxOperations;

  constructor(private readonly context: MessageOperationsContext) {
    this.receivedMessageIds = new RecentIds(context.rememberedMessages);
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

  async listMessages(
    conversationId: ConversationId,
    options: ListMessagesOptions = {}
  ): Promise<readonly Message[]> {
    this.context.assertStarted();
    const atLeast = options.atLeast;
    if (atLeast !== undefined && (!Number.isInteger(atLeast) || atLeast < 1)) {
      throw new SdkError("INVALID_INPUT", "At least how many must be a positive whole number");
    }
    const stored = this.context.storage ? await this.context.storage.getMessages(conversationId) : [];
    try {
      const messages = await this.context.adapter.listMessages(conversationId);
      for (const message of messages) this.receivedMessageIds.add(message.id);
      // The main timeline is what was said to everyone; what hangs from a thread is read as a thread.
      const merged = this.merge(stored, messages).filter(message => message.threadId === undefined);
      await this.updateCache(merged, stored);
      if (atLeast === undefined || merged.length >= atLeast) return merged;
      // Not enough to read, and the conversation may have more: older ones are fetched until there are.
      return this.fetchUntilThereIsEnough(conversationId, merged, atLeast);
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
      for (const message of page.messages) this.receivedMessageIds.add(message.id);
      const merged = this.merge(stored, page.messages);
      // The same decision as reading a conversation: keep the newest up to the limit and nothing else. Writing
      // down history that the cache is about to drop was work for nothing, on every look back.
      await this.updateCache(merged, stored);
      return { messages: merged, hasMore: page.hasMore };
    } catch (error) {
      if (!this.context.storage) throw error;
      // Older history cannot be reached right now, so the cached timeline is all there is to show.
      return { messages: stored, hasMore: false };
    }
  }

  /**
   * Asks the homeserver to search. It cannot look inside encrypted conversations, because the server never
   * sees what they say; `search` looks through what this device already holds.
   */
  async searchRemote(query: string): Promise<readonly Message[]> {
    this.context.assertStarted();
    if (!query.trim()) {
      throw new SdkError("INVALID_INPUT", "Search query cannot be empty");
    }
    return this.context.adapter.searchMessages(query.trim());
  }

  /**
   * The answers hanging from one message, which are kept out of the main conversation. Kept locally like the
   * conversation itself, so a thread that has been opened before is still readable with no homeserver.
   */
  async thread(conversationId: ConversationId, rootId: MessageId): Promise<readonly Message[]> {
    this.context.assertStarted();
    const root = rootId.trim();
    if (!root) {
      throw new SdkError("INVALID_INPUT", "A message id is required");
    }
    const stored = this.context.storage ? await this.context.storage.getMessages(conversationId) : [];
    const storedAnswers = stored.filter(message => message.threadId === root).sort(byOldestFirst);
    try {
      const answers = await this.context.adapter.listThread(conversationId, root);
      for (const message of answers) this.receivedMessageIds.add(message.id);
      await this.keepThread(answers, storedAnswers);
      return this.merge(storedAnswers, answers);
    } catch (error) {
      if (storedAnswers.length === 0) throw error;
      return storedAnswers;
    }
  }

  /** A thread is kept whole: it is short by nature, and dropping half of it would read as somebody leaving. */
  private async keepThread(answers: readonly Message[], stored: readonly Message[]): Promise<void> {
    const { storage } = this.context;
    if (!storage) return;
    const known = new Map(stored.map(message => [message.id, JSON.stringify(message)]));
    const changed = answers.filter(message => known.get(message.id) !== JSON.stringify(message));
    await storage.saveMessages(changed);
  }

  /** Searches messages already available locally. Encrypted history is never searched on the server. */
  async search(query: string, options: MessageSearchOptions = {}): Promise<readonly Message[]> {
    this.context.assertStarted();
    const needle = query.trim().toLowerCase();
    if (!needle) {
      throw new SdkError("INVALID_INPUT", "Search query cannot be empty");
    }
    const limit = options.limit ?? defaultSearchResults;
    if (!Number.isInteger(limit) || limit < 1) {
      throw new SdkError("INVALID_INPUT", "The search limit must be a positive whole number");
    }
    // Reading local history means decrypting it, so the search walks the conversations with the most recent
    // activity first and stops as soon as it has enough. On a full account that is the difference between
    // answering at once and chewing through everything ever said.
    const conversationIds = options.conversationId
      ? [options.conversationId]
      : byRecentActivity(await this.localConversations()).map(conversation => conversation.id);
    const results: Message[] = [];
    for (const conversationId of conversationIds) {
      const messages = await this.localMessages(conversationId);
      const matches = messages
        .filter(message => message.deletedAt === undefined && message.body.toLowerCase().includes(needle))
        .sort((left, right) => right.createdAt - left.createdAt);
      results.push(...matches.slice(0, limit - results.length));
      if (results.length >= limit) break;
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

  sendSticker(conversationId: ConversationId, sticker: FileInput): Promise<Message> {
    return this.outbox.sendSticker(conversationId, sticker);
  }

  sendLocation(conversationId: ConversationId, location: GeoLocation): Promise<Message> {
    return this.outbox.sendLocation(conversationId, location);
  }

  sendVoice(conversationId: ConversationId, file: FileInput, voice: VoiceInfo): Promise<Message> {
    return this.outbox.sendVoice(conversationId, file, voice);
  }

  /**
   * Passes a message on to another conversation. A file is fetched and sent again rather than pointed at, because
   * the copy in one conversation is locked with a key the other conversation does not have.
   */
  async forward(messageId: MessageId, toConversationId: ConversationId): Promise<Message> {
    this.context.assertStarted();
    const original = await this.findMessage(messageId);
    if (!original) {
      throw new SdkError("MESSAGE_NOT_FOUND", "The message does not exist");
    }
    if (original.undecryptable || original.deletedAt) {
      throw new SdkError("INVALID_INPUT", "A message that cannot be read cannot be passed on");
    }
    const { attachment } = original;
    if (attachment) {
      const data = await this.context.adapter.downloadAttachment(attachment);
      return this.outbox.sendFile(toConversationId, {
        name: attachment.name,
        mimeType: attachment.mimeType,
        data: new Uint8Array(data),
        ...(attachment.width !== undefined ? { width: attachment.width } : {}),
        ...(attachment.height !== undefined ? { height: attachment.height } : {}),
        ...(attachment.voice ? { voice: attachment.voice } : {})
      }, {});
    }
    if (original.location) {
      return this.outbox.sendLocation(toConversationId, original.location);
    }
    return this.outbox.send(toConversationId, original.body, {
      ...(original.formattedBody ? { formattedBody: original.formattedBody } : {}),
      ...(original.kind ? { kind: original.kind } : {})
    });
  }

  /** Hands a message to whoever runs the homeserver, which is what somebody does about abuse. */
  async report(messageId: MessageId, reason: string): Promise<void> {
    this.context.assertStarted();
    if (!reason.trim()) {
      throw new SdkError("INVALID_INPUT", "A report needs a reason, or nobody can act on it");
    }
    const message = await this.findMessage(messageId);
    if (!message) {
      throw new SdkError("MESSAGE_NOT_FOUND", "The message does not exist");
    }
    await this.context.adapter.reportMessage(message.conversationId, messageId, reason.trim());
  }

  /** Asks for older messages until there are enough to read, or until the conversation has no more. */
  private async fetchUntilThereIsEnough(
    conversationId: ConversationId,
    shown: readonly Message[],
    atLeast: number
  ): Promise<readonly Message[]> {
    let messages = shown;
    let hasMore = true;
    while (messages.length < atLeast && hasMore) {
      const page = await this.loadMoreMessages(conversationId, atLeast - messages.length);
      hasMore = page.hasMore && page.messages.length > messages.length;
      messages = page.messages;
    }
    return messages;
  }

  /** Looks in what is already here first, and asks the conversation only when it is not. */
  private async findMessage(messageId: MessageId): Promise<Message | undefined> {
    const stored = await this.context.storage?.getMessage(messageId);
    if (stored) return stored;
    for (const conversation of await this.localConversations()) {
      const found = (await this.localMessages(conversation.id)).find(message => message.id === messageId);
      if (found) return found;
    }
    return undefined;
  }

  /** What arrived after the point this person had read, which is what an application draws a line above. */
  async unreadSince(conversationId: ConversationId): Promise<readonly Message[]> {
    this.context.assertStarted();
    const messages = await this.listMessages(conversationId);
    const conversations = await this.localConversations();
    const lastRead = conversations.find(item => item.id === conversationId)?.lastReadMessageId;
    if (lastRead === undefined) return messages;
    const index = messages.findIndex(message => message.id === lastRead);
    // A marker pointing at something no longer here says nothing about what is, so nothing is hidden.
    return index === -1 ? messages : messages.slice(index + 1);
  }

  draftWritten(conversationId: ConversationId): void {
    this.outbox.draftWritten(conversationId);
  }

  retryMessage(messageId: MessageId): Promise<Message> {
    return this.outbox.retry(messageId);
  }

  cancelMessage(messageId: MessageId): Promise<Message> {
    return this.outbox.cancel(messageId);
  }

  /**
   * The threads of a conversation. A screen that shows which ones have something new would otherwise open
   * every thread to find out, which is a request per thread on every repaint.
   */
  async threads(conversationId: ConversationId): Promise<readonly ThreadSummary[]> {
    this.context.assertStarted();
    return this.context.adapter.listThreads(conversationId);
  }

  /** Who has read a message, so an application can show it without knowing anything about receipts. */
  async readBy(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]> {
    this.context.assertStarted();
    if (!messageId.trim()) {
      throw new SdkError("INVALID_INPUT", "A message id is required");
    }
    return this.context.adapter.getReadReceipts(conversationId, messageId);
  }

  /**
   * Applications call this every time a conversation is opened. Saying again that the same message was read
   * tells nobody anything, so it does not go out: it would be a request per open on a busy screen.
   */
  async markRead(conversationId: ConversationId, messageId: MessageId, options: MarkReadOptions = {}): Promise<void> {
    this.context.assertStarted();
    // A thread is read on its own: saying so does not say the conversation was read, so none of what is
    // remembered about the conversation applies, and neither does the mark somebody left on it.
    if (options.threadId) {
      await this.context.adapter.markMessageRead(conversationId, messageId, options);
      return;
    }
    if (this.lastReadByConversation.get(conversationId) === messageId) return;
    try {
      await this.context.adapter.markMessageRead(conversationId, messageId, options);
      this.lastReadByConversation.set(conversationId, messageId);
      this.readToTellAbout.delete(conversationId);
      // Somebody reading a conversation is not somebody who left it for later.
      await this.context.wasRead?.(conversationId);
    } catch {
      // Reading with no homeserver is still reading. It is remembered and told when there is one again, rather
      // than thrown at somebody who only opened a conversation. Only the furthest point matters.
      this.readToTellAbout.set(conversationId, messageId);
    }
  }

  /** Says how far each conversation was read, for whatever could not be told at the time. */
  async tellWhatWasRead(): Promise<void> {
    for (const [conversationId, messageId] of [...this.readToTellAbout]) {
      this.readToTellAbout.delete(conversationId);
      await this.markRead(conversationId, messageId);
    }
  }

  /** What was already said out loud is only true while the client runs. */
  forget(): void {
    this.lastReadByConversation.clear();
    this.readToTellAbout.clear();
    this.outbox.forgetWhatWasCleared();
  }

  receiveMessage(message: Message): void {
    const isOwnEcho = message.transactionId !== undefined && this.receivedMessageIds.has(message.transactionId);
    if (isOwnEcho || this.receivedMessageIds.has(message.id)) return;
    this.receivedMessageIds.add(message.id);
    void this.persistAndEmit(message, this.context.emitMessageReceived);
  }

  private async persistAndEmit(message: Message, emit: (message: Message) => void): Promise<void> {
    try {
      await this.context.storage?.saveMessage(message);
      emit(message);
    } catch (error) {
      this.context.emitError(error);
    }
  }

  updateMessage(message: Message): void {
    this.receivedMessageIds.add(message.id);
    void this.persistAndEmit(message, this.context.emitMessageUpdated);
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
  /**
   * Decides what the local copy should hold and makes it so in one pass: the newest delivered messages up to
   * the limit, plus everything still waiting to be sent. Writing the whole timeline and deleting the excess
   * afterwards meant writing and deleting the same messages on every read of a long conversation.
   */
  private async updateCache(messages: readonly Message[], stored: readonly Message[]): Promise<void> {
    const { storage, cachedMessagesPerConversation: limit } = this.context;
    if (!storage) return;
    // What hangs from a thread is not part of the main timeline and is not this decision to make: leaving it
    // out of what is kept would delete it on every read of the conversation.
    const inThreads = stored.filter(message => message.threadId !== undefined);
    const pending = messages.filter(message => message.status !== "sent");
    // Sorted here as well: whoever calls decides the order they want, and the cache boundary cannot depend on it.
    const delivered = messages.filter(message => message.status === "sent").sort(byOldestFirst);
    const keptDelivered = delivered.slice(Math.max(delivered.length - limit, 0));
    const kept = [...inThreads, ...pending, ...keptDelivered];
    const keptIds = new Set(kept.map(message => message.id));

    const known = new Map(stored.map(message => [message.id, JSON.stringify(message)]));
    const changed = kept.filter(message => known.get(message.id) !== JSON.stringify(message));
    const dropped = stored.filter(message => !keptIds.has(message.id)).map(message => message.id);
    await storage.saveMessages(changed);
    await storage.deleteMessages(dropped);
  }

  private merge(stored: readonly Message[], remote: readonly Message[]): readonly Message[] {
    const messages = new Map<string, Message>();
    for (const message of stored) messages.set(message.id, message);
    for (const message of remote) messages.set(message.id, message);
    return [...messages.values()].sort(byOldestFirst);
  }
}
