import type { MessagingAdapter } from "./adapter.js";
import type { ConversationId, MessageId, Reaction } from "./models.js";
import { SdkError } from "./errors.js";

export interface ReactionOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class ReactionOperations {
  constructor(private readonly context: ReactionOperationsContext) {}

  async add(conversationId: ConversationId, messageId: MessageId, key: string): Promise<Reaction> {
    this.context.assertStarted();
    if (!key.trim()) {
      throw new SdkError("INVALID_INPUT", "Reaction key cannot be empty");
    }
    return this.context.adapter.addReaction(conversationId, messageId, key);
  }

  async remove(conversationId: ConversationId, reactionId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.removeReaction(conversationId, reactionId);
  }
}
