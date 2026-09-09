import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type { ConversationId, Message, MessageId } from "./models.js";

export interface MessageMutationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly assertStarted: () => void;
  readonly emitUpdated: (message: Message) => void;
}

export class MessageMutations {
  constructor(private readonly context: MessageMutationsContext) {}

  async edit(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message> {
    this.context.assertStarted();
    if (!body.trim()) {
      throw new SdkError("INVALID_INPUT", "Message body cannot be empty");
    }

    const message = await this.context.adapter.editMessage(conversationId, messageId, body);
    await this.context.storage?.saveMessage(message);
    this.context.emitUpdated(message);
    return message;
  }

  async delete(conversationId: ConversationId, messageId: MessageId): Promise<Message> {
    this.context.assertStarted();
    const message = await this.context.adapter.deleteMessage(conversationId, messageId);
    await this.context.storage?.saveMessage(message);
    this.context.emitUpdated(message);
    return message;
  }
}
