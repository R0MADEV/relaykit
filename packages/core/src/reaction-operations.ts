import type { MessagingAdapter, ReactionsAdapter } from "./adapter.js";
import type { ConversationId, MessageId, Reaction, Session } from "./models.js";
import type { PendingActions } from "./pending-actions.js";
import { SdkError } from "./errors.js";

export interface ReactionOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
  readonly getSession: () => Session | undefined;
  readonly waiting: PendingActions;
}

export class ReactionOperations {
  constructor(private readonly context: ReactionOperationsContext) {}

  /**
   * With no homeserver to tell, the reaction is remembered and given when there is one. What comes back is
   * what to show meanwhile: it carries a local identifier until the real one arrives.
   */
  async add(conversationId: ConversationId, messageId: MessageId, key: string): Promise<Reaction> {
    this.context.assertStarted();
    if (!key.trim()) {
      throw new SdkError("INVALID_INPUT", "Reaction key cannot be empty");
    }
    // Asked for before trying, because what follows treats a failure as this side being offline and keeps it
    // to send later. Something the homeserver does not do would wait in that queue for ever.
    const reactions = this.reactions;
    try {
      const reaction = await reactions.addReaction(conversationId, messageId, key);
      this.context.waiting.forget(reactionTarget(messageId, key));
      return reaction;
    } catch {
      this.context.waiting.remember(reactionTarget(messageId, key), () =>
        reactions.addReaction(conversationId, messageId, key)
      );
      return {
        id: `local-reaction-${messageId}-${key}`,
        messageId,
        key,
        senderId: this.context.getSession()?.userId ?? "",
        createdAt: Date.now()
      };
    }
  }

  async remove(conversationId: ConversationId, reactionId: string): Promise<void> {
    this.context.assertStarted();
    const reactions = this.reactions;
    try {
      await reactions.removeReaction(conversationId, reactionId);
      this.context.waiting.forget(`reaction-gone:${reactionId}`);
    } catch {
      this.context.waiting.remember(`reaction-gone:${reactionId}`, () =>
        reactions.removeReaction(conversationId, reactionId)
      );
    }
  }

  /** The one place that answers whether this adapter does this at all. */
  private get reactions(): ReactionsAdapter {
    const reactions = this.context.adapter.reactions;
    if (!reactions) throw new SdkError("NOT_SUPPORTED", "Reactions are not something this homeserver has");
    return reactions;
  }
}

function reactionTarget(messageId: MessageId, key: string): string {
  return `reaction:${messageId}:${key}`;
}
