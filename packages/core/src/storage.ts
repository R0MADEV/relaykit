import type { Conversation, ConversationId, Message, MessageId, OutboxOperation, User } from "./models.js";

export interface MessagingStorage {
  deleteMessage(messageId: MessageId): Promise<void>;
  /** Drops many at once, for the same reason `saveMessages` exists. */
  deleteMessages(messageIds: readonly MessageId[]): Promise<void>;
  getConversations(): Promise<readonly Conversation[]>;
  getMessage(messageId: MessageId): Promise<Message | undefined>;
  getMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  getPendingMessages(): Promise<readonly Message[]>;
  getReadyOutbox(now: number): Promise<readonly OutboxOperation[]>;
  getOutboxOperation(operationId: string): Promise<OutboxOperation | undefined>;
  deleteOutboxOperation(operationId: string): Promise<void>;
  saveOutboxOperation(operation: OutboxOperation): Promise<void>;
  saveConversation(conversation: Conversation): Promise<void>;
  deleteConversation(conversationId: ConversationId): Promise<void>;
  saveMessage(message: Message): Promise<void>;
  /**
   * Keeps many at once. Reading a timeline can change hundreds of them, and writing each on its own means a
   * separate transaction for each, which is what makes opening a busy conversation feel slow.
   */
  saveMessages(messages: readonly Message[]): Promise<void>;
  saveConversations(conversations: readonly Conversation[]): Promise<void>;
  /** What somebody was writing and has not sent. It is their text, so it is kept like any other private content. */
  getDraft(conversationId: ConversationId): Promise<string | undefined>;
  saveDraft(conversationId: ConversationId, text: string | undefined): Promise<void>;
  /** What people are called, so a screen with no homeserver still shows names instead of identifiers. */
  getProfiles(): Promise<readonly User[]>;
  saveProfiles(profiles: readonly User[]): Promise<void>;
  clear(): Promise<void>;
}
