import type {
  Conversation,
  ConversationId,
  Message,
  MessageId,
  MessagingStorage,
  OutboxOperation
} from "@relaykit/core";

export class InMemoryStorage implements MessagingStorage {
  private readonly conversations = new Map<string, Conversation>();
  private readonly messages = new Map<MessageId, Message>();
  private readonly outbox = new Map<string, OutboxOperation>();

  async deleteOutboxOperation(operationId: string): Promise<void> {
    this.outbox.delete(operationId);
  }

  async getReadyOutbox(now: number): Promise<readonly OutboxOperation[]> {
    return [...this.outbox.values()].filter(operation => operation.nextAttemptAt <= now);
  }

  async getOutboxOperation(operationId: string): Promise<OutboxOperation | undefined> {
    return this.outbox.get(operationId);
  }

  async saveOutboxOperation(operation: OutboxOperation): Promise<void> {
    this.outbox.set(operation.id, operation);
  }

  async deleteMessage(messageId: MessageId): Promise<void> {
    this.messages.delete(messageId);
  }

  async getMessage(messageId: MessageId): Promise<Message | undefined> {
    return this.messages.get(messageId);
  }

  async getConversations(): Promise<readonly Conversation[]> {
    return [...this.conversations.values()];
  }

  async getMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return [...this.messages.values()].filter(message => message.conversationId === conversationId);
  }

  async getPendingMessages(): Promise<readonly Message[]> {
    return [...this.messages.values()].filter(message => message.status === "queued" || message.status === "failed");
  }

  async saveConversation(conversation: Conversation): Promise<void> {
    this.conversations.set(conversation.id, conversation);
  }

  async deleteConversation(conversationId: ConversationId): Promise<void> {
    this.conversations.delete(conversationId);
    for (const [messageId, message] of this.messages) {
      if (message.conversationId === conversationId) this.messages.delete(messageId);
    }
  }

  async saveMessage(message: Message): Promise<void> {
    this.messages.set(message.id, message);
  }

  async clear(): Promise<void> {
    this.conversations.clear();
    this.messages.clear();
    this.outbox.clear();
  }
}
