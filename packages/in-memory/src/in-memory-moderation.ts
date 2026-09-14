import type {
  Conversation,
  ConversationId,
  ConversationPermissions,
  ConversationRole,
  KnockOptions,
  Participant,
  UserId
} from "@relaykit/core";

/** Somebody waiting at the door of a conversation, and why they say they should be let in. */
export interface Knock {
  readonly userId: UserId;
  readonly reason?: string;
}

/** What moderating needs from the adapter around it, and nothing else of it. */
export interface InMemoryModerationContext {
  readonly requireUserId: () => UserId;
  readonly currentUserId: () => UserId | undefined;
  readonly requireConversation: (conversationId: ConversationId) => Conversation;
  readonly replaceConversation: (conversation: Conversation) => Conversation;
}

/**
 * Who is in a conversation, what each of them may do, and showing somebody the door.
 *
 * Apart from the rest of the double because ranks are their own small world: what a level is worth, who
 * outranks whom, and who is shut out are four maps and one comparison that nothing else here reads.
 */
export class InMemoryModeration {
  private readonly knocks = new Map<ConversationId, Knock[]>();
  private readonly powerLevels = new Map<string, number>();
  /** Who has been shut out of what, kept so they can be let back in. */
  private readonly shutOut = new Set<string>();

  constructor(private readonly context: InMemoryModerationContext) {}

  async knockConversation(conversationId: ConversationId, options: KnockOptions): Promise<void> {
    const waiting = this.knocks.get(conversationId) ?? [];
    this.knocks.set(conversationId, [
      ...waiting,
      { userId: this.context.requireUserId(), ...(options.reason ? { reason: options.reason } : {}) }
    ]);
  }
  /** Test helper: who has asked to come in to a conversation and is still waiting. */
  knocksOn(conversationId: ConversationId): readonly Knock[] {
    return this.knocks.get(conversationId) ?? [];
  }
  /** Test helper: simulates somebody knocking at a conversation this account is in. */
  receiveKnock(conversationId: ConversationId, userId: UserId): Conversation {
    const conversation = this.context.requireConversation(conversationId);
    const knockingIds = [...new Set([...(conversation.knockingIds ?? []), userId])];
    return this.context.replaceConversation({ ...conversation, knockingIds });
  }
  /** Test helper: sets what somebody is allowed to do in a conversation. */
  setPowerLevel(conversationId: ConversationId, userId: UserId, level: number): void {
    this.powerLevels.set(`${conversationId}:${userId}`, level);
  }
  /** Whoever is signed in holds the conversation unless a test says otherwise; everybody else is a member. */
  powerLevelOf(conversationId: ConversationId, userId: UserId): number {
    const kept = this.powerLevels.get(`${conversationId}:${userId}`);
    if (kept !== undefined) return kept;
    return userId === this.context.currentUserId() ? levels.admin : levels.member;
  }
  async getPermissions(conversationId: ConversationId): Promise<ConversationPermissions> {
    const level = this.powerLevelOf(conversationId, this.context.requireUserId());
    return {
      canSend: level >= 0,
      canInvite: level >= 50,
      canRemove: level >= 50,
      canBan: level >= 50,
      canRename: level >= 50
    };
  }
  async setRole(conversationId: ConversationId, userId: UserId, role: ConversationRole): Promise<void> {
    this.setPowerLevel(conversationId, userId, levels[role]);
  }
  /**
   * Everybody the conversation knows about: this account, those in it, those invited, and those shut out —
   * because letting somebody back in is something only a list that still has them in it can offer.
   */
  async listParticipants(conversationId: ConversationId): Promise<readonly Participant[]> {
    const conversation = this.context.requireConversation(conversationId);
    const me = this.context.requireUserId();
    const mine = this.powerLevelOf(conversationId, me);
    const shutOut = [...this.shutOut]
      .filter(each => each.startsWith(`${conversationId}:`))
      .map(each => ({ userId: each.slice(conversationId.length + 1), membership: "ban" as const }));
    const invited = new Set(conversation.invitedIds ?? []);
    const others = conversation.participantIds
      .filter(userId => userId !== me)
      .map(userId => ({ userId, membership: invited.has(userId) ? ("invite" as const) : ("join" as const) }));
    return [{ userId: me, membership: "join" as const }, ...others, ...shutOut].map(
      ({ userId, membership }) => {
        const theirs = this.powerLevelOf(conversationId, userId);
        return { userId, role: roleOf(theirs), membership, isUnderMe: theirs < mine };
      }
    );
  }
  async removeFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    const conversation = this.context.requireConversation(conversationId);
    return this.context.replaceConversation({
      ...conversation,
      participantIds: conversation.participantIds.filter(participant => participant !== userId),
      invitedIds: (conversation.invitedIds ?? []).filter(invited => invited !== userId)
    });
  }
  async banFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    this.shutOut.add(`${conversationId}:${userId}`);
    return this.removeFromConversation(conversationId, userId);
  }
  async unbanFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    // Lifting a ban only allows somebody back in; it does not put them back.
    this.shutOut.delete(`${conversationId}:${userId}`);
    return this.context.requireConversation(conversationId);
  }
}

/** What each role is worth, which is the whole of what ranks one person above another. */
const levels: Record<ConversationRole, number> = { member: 0, moderator: 50, admin: 100 };

function roleOf(level: number): ConversationRole {
  if (level >= levels.admin) return "admin";
  if (level >= levels.moderator) return "moderator";
  return "member";
}
