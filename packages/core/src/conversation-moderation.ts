import { RelayKitError } from "./errors.js";
import type { ModerationAdapter } from "./adapter.js";
import type {
  Conversation,
  ConversationId,
  ConversationPermissions,
  ConversationRole,
  KnockOptions,
  Participant,
  UserId
} from "./models.js";
import type { ConversationOperationsContext } from "./conversation-operations.js";

/**
 * Deciding who may be in a conversation and what they may do in it.
 *
 * Apart from the rest of what a conversation does because it answers a different question: everything else
 * is what a conversation *is*, and this is who is allowed to change it. It is also the half a backend is
 * most likely not to have at all.
 */
export class ConversationModeration {
  constructor(
    private readonly context: ConversationOperationsContext,
    /** Writing a conversation down and telling whoever is watching, which the rest of it does too. */
    private readonly save: (conversation: Conversation) => Promise<Conversation>
  ) {}

  /** Removes somebody from the conversation. They can come back if invited again. */
  async remove(conversationId: string, userId: UserId, reason?: string): Promise<Conversation> {
    return this.save(
      await this.moderation.removeFromConversation(conversationId, this.requireUser(userId), reason)
    );
  }
  /** Removes somebody and keeps them out until the ban is lifted. */
  async ban(conversationId: string, userId: UserId, reason?: string): Promise<Conversation> {
    return this.save(
      await this.moderation.banFromConversation(conversationId, this.requireUser(userId), reason)
    );
  }
  async unban(conversationId: string, userId: UserId): Promise<Conversation> {
    return this.save(await this.moderation.unbanFromConversation(conversationId, this.requireUser(userId)));
  }
  /** Asks to come in to a conversation that does not let people join on their own. */
  async knock(conversationId: string, options: KnockOptions = {}): Promise<void> {
    this.context.assertStarted();
    await this.moderation.knockConversation(conversationId, options);
  }
  async permissions(conversationId: string): Promise<ConversationPermissions> {
    this.context.assertStarted();
    return this.moderation.getPermissions(conversationId);
  }
  /** Everybody the conversation knows about and what each of them is in it. */
  async participants(conversationId: ConversationId): Promise<readonly Participant[]> {
    this.context.assertStarted();
    return this.moderation.listParticipants(conversationId);
  }
  async setRole(conversationId: string, userId: UserId, role: ConversationRole): Promise<void> {
    await this.moderation.setRole(conversationId, this.requireUser(userId), role);
  }
  private requireUser(userId: UserId): UserId {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new RelayKitError("INVALID_INPUT", "A user id is required");
    }
    return userId.trim();
  }

  /** The one place that answers whether this adapter does this at all. */
  private get moderation(): ModerationAdapter {
    const found = this.context.adapter.moderation;
    if (!found) {
      throw new RelayKitError(
        "NOT_SUPPORTED",
        "Moderating a conversation is not something this homeserver has"
      );
    }
    return found;
  }
}
