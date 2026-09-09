import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type { Conversation, CreateConversationInput, Session, UserId } from "./models.js";
import { SdkError } from "./errors.js";

export interface ConversationOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly assertStarted: () => void;
  readonly getSession: () => Session | undefined;
  readonly emitUpdated: (conversation: Conversation) => void;
}

export class ConversationOperations {
  constructor(private readonly context: ConversationOperationsContext) {}

  async list(): Promise<readonly Conversation[]> {
    this.context.assertStarted();
    const storedConversations = this.context.storage
      ? await this.context.storage.getConversations()
      : [];
    try {
      const conversations = await this.context.adapter.listConversations();
      await this.persistChanged(conversations, storedConversations);
      return byRecentActivity(conversations);
    } catch (error) {
      if (storedConversations.length === 0) {
        throw error;
      }
      return byRecentActivity(storedConversations);
    }
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    this.context.assertStarted();
    if (input.participantIds.length === 0) {
      throw new SdkError("INVALID_INPUT", "A conversation requires at least one participant");
    }
    const hasEmptyParticipant = input.participantIds.some(participantId => !participantId.trim());
    if (hasEmptyParticipant) {
      throw new SdkError("INVALID_INPUT", "Conversation participants cannot be empty");
    }
    const uniqueParticipants = new Set(input.participantIds);
    if (uniqueParticipants.size !== input.participantIds.length) {
      throw new SdkError("INVALID_INPUT", "Conversation participants must be unique");
    }
    if (input.title !== undefined && !input.title.trim()) {
      throw new SdkError("INVALID_INPUT", "Conversation title cannot be empty");
    }

    const conversation = await this.context.adapter.createConversation(input);
    await this.context.storage?.saveConversation(conversation);
    this.context.emitUpdated(conversation);
    return conversation;
  }

  /** Returns the joined direct conversation with `userId`, if there is one. */
  async findDirect(userId: UserId): Promise<Conversation | undefined> {
    const conversations = await this.list();
    return this.directWith(conversations, userId, "join");
  }

  /**
   * Opens the direct conversation with `userId`. An invitation from that same user is that conversation, so it
   * is joined rather than answered with a second one, which would leave each side talking in its own room.
   */
  async open(userId: UserId): Promise<Conversation> {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new SdkError("INVALID_INPUT", "A user id is required to open a conversation");
    }
    const conversations = await this.list();
    const joined = this.directWith(conversations, userId, "join");
    if (joined) return joined;
    const invitation = this.directWith(conversations, userId, "invite");
    if (invitation) return this.join(invitation.id);
    return this.create({ participantIds: [userId], direct: true });
  }

  private directWith(
    conversations: readonly Conversation[],
    userId: UserId,
    membership: "join" | "invite"
  ): Conversation | undefined {
    const ownUserId = this.context.getSession()?.userId;
    return conversations.find(conversation => {
      const others = conversation.participantIds.filter(participantId => participantId !== ownUserId);
      const isDirectWithUser = conversation.isDirect === true && others.length === 1 && others[0] === userId;
      const matchesMembership = membership === "invite"
        ? conversation.membership === "invite"
        : conversation.membership !== "invite";
      return isDirectWithUser && matchesMembership;
    });
  }

  async search(query: string): Promise<readonly Conversation[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      throw new SdkError("INVALID_INPUT", "Search query cannot be empty");
    }
    const conversations = await this.list();
    return conversations.filter(conversation => {
      const matchesTitle = conversation.title?.toLowerCase().includes(needle) ?? false;
      return matchesTitle || conversation.participantIds.some(participantId => participantId.toLowerCase().includes(needle));
    });
  }

  async join(conversationId: string): Promise<Conversation> {
    this.context.assertStarted();
    const conversation = await this.context.adapter.joinConversation(conversationId);
    await this.context.storage?.saveConversation(conversation);
    this.context.emitUpdated(conversation);
    return conversation;
  }

  async leave(conversationId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.leaveConversation(conversationId);
    // What was cached for a conversation the user left is no longer theirs to keep.
    await this.context.storage?.deleteConversation(conversationId);
  }

  async invite(conversationId: string, userId: UserId): Promise<Conversation> {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new SdkError("INVALID_INPUT", "A user id is required to invite someone");
    }
    return this.save(await this.context.adapter.inviteToConversation(conversationId, userId.trim()));
  }

  async rename(conversationId: string, title: string): Promise<Conversation> {
    this.context.assertStarted();
    if (!title.trim()) {
      throw new SdkError("INVALID_INPUT", "Conversation title cannot be empty");
    }
    return this.save(await this.context.adapter.renameConversation(conversationId, title.trim()));
  }

  /**
   * Rewriting every conversation on each listing is the difference between a snappy list and a frozen one
   * once there are hundreds of them, and each write is encrypted.
   */
  private async persistChanged(
    conversations: readonly Conversation[],
    stored: readonly Conversation[]
  ): Promise<void> {
    const { storage } = this.context;
    if (!storage) return;
    const known = new Map(stored.map(conversation => [conversation.id, JSON.stringify(conversation)]));
    const changed = conversations.filter(conversation => known.get(conversation.id) !== JSON.stringify(conversation));
    await Promise.all(changed.map(conversation => storage.saveConversation(conversation)));
  }

  private async save(conversation: Conversation): Promise<Conversation> {
    await this.context.storage?.saveConversation(conversation);
    this.context.emitUpdated(conversation);
    return conversation;
  }

  async typing(conversationId: string, isTyping: boolean, timeoutMs = 5000): Promise<void> {
    this.context.assertStarted();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw new SdkError("INVALID_INPUT", "Typing timeout must be a non-negative integer");
    }
    await this.context.adapter.setTyping(conversationId, isTyping, timeoutMs);
  }
}

/** Newest activity first, which is the order a conversation list is expected to show. */
function byRecentActivity(conversations: readonly Conversation[]): readonly Conversation[] {
  return [...conversations].sort((left, right) => (right.lastMessage?.createdAt ?? 0) - (left.lastMessage?.createdAt ?? 0));
}
