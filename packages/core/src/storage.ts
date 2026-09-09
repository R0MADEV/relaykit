import type { Conversation, ConversationId, Message, MessageId, OutboxOperation } from "./models.js";

export interface MessagingStorage {
  deleteMessage(messageId: MessageId): Promise<void>;
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
  clear(): Promise<void>;
}
