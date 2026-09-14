import { SdkError } from "./errors.js";
import type { ReceiptsAdapter } from "./adapter.js";
import type {
  Conversation,
  ConversationId,
  MarkReadOptions,
  Message,
  MessageId,
  ReadReceipt
} from "./models.js";
import type { MessageOperationsContext } from "./message-operations.js";

/**
 * How far this person has read, and telling the others about it.
 *
 * Apart from the messages themselves because it is a different thing about them: what was said does not
 * change when somebody reads it, and a backend that carries messages perfectly well may have no receipts
 * at all.
 */
export class MessageReadState {
  /** The last message read in each conversation, so a marker is not moved backwards by a stale call. */
  private readonly lastReadByConversation = new Map<ConversationId, MessageId>();
  private readonly readToTellAbout = new Map<ConversationId, MessageId>();

  constructor(
    private readonly context: MessageOperationsContext,
    /** What is on screen and what conversations are held, both of which live with the messages. */
    private readonly reading: {
      readonly listMessages: (conversationId: ConversationId) => Promise<readonly Message[]>;
      readonly localConversations: () => Promise<readonly Conversation[]>;
    }
  ) {}

  /** What arrived after the point this person had read, which is what an application draws a line above. */
  async unreadSince(conversationId: ConversationId): Promise<readonly Message[]> {
    this.context.assertStarted();
    const messages = await this.reading.listMessages(conversationId);
    const conversations = await this.reading.localConversations();
    const lastRead = conversations.find(item => item.id === conversationId)?.lastReadMessageId;
    if (lastRead === undefined) return messages;
    const index = messages.findIndex(message => message.id === lastRead);
    // A marker pointing at something no longer here says nothing about what is, so nothing is hidden.
    return index === -1 ? messages : messages.slice(index + 1);
  }
  /** Who has read a message, so an application can show it without knowing anything about receipts. */
  async readBy(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]> {
    this.context.assertStarted();
    if (!messageId.trim()) {
      throw new SdkError("INVALID_INPUT", "A message id is required");
    }
    return this.receipts.getReadReceipts(conversationId, messageId);
  }
  /**
   * Applications call this every time a conversation is opened. Saying again that the same message was read
   * tells nobody anything, so it does not go out: it would be a request per open on a busy screen.
   */
  async markRead(
    conversationId: ConversationId,
    messageId: MessageId,
    options: MarkReadOptions = {}
  ): Promise<void> {
    this.context.assertStarted();
    // A thread is read on its own: saying so does not say the conversation was read, so none of what is
    // remembered about the conversation applies, and neither does the mark somebody left on it.
    if (options.threadId) {
      await this.receipts.markMessageRead(conversationId, messageId, options);
      return;
    }
    if (this.lastReadByConversation.get(conversationId) === messageId) return;
    try {
      await this.receipts.markMessageRead(conversationId, messageId, options);
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

  /** Signing out forgets how far anybody had read: the next session reads it from the homeserver again. */
  forget(): void {
    this.lastReadByConversation.clear();
    this.readToTellAbout.clear();
  }

  /** The one place that answers whether this adapter does this at all. */
  private get receipts(): ReceiptsAdapter {
    const found = this.context.adapter.receipts;
    if (!found) throw new SdkError("NOT_SUPPORTED", "Read receipts are not something this homeserver has");
    return found;
  }
}
