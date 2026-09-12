import type { MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type {
  AvatarImage,
  Conversation,
  Message,
  NotificationLevel,
  ConversationPermissions,
  ConversationRole,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  ListConversationsOptions,
  PublicConversation,
  CreateConversationInput,
  JoinConversationOptions,
  Session,
  UserId
} from "./models.js";
import { SdkError } from "./errors.js";
import { historyVisibilities, joinRules } from "./models.js";

export interface ConversationOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly storage?: MessagingStorage;
  readonly assertStarted: () => void;
  readonly getSession: () => Session | undefined;
  readonly emitUpdated: (conversation: Conversation) => void;
  /** How many conversations to keep locally. Undefined keeps all of them. */
  readonly cachedConversations?: number;
  readonly now: () => number;
  /** Whether what the adapter reports can be trusted as the whole picture yet. */
  readonly isCaughtUp: () => boolean;
}

export class ConversationOperations {
  /** Conversations this person put back to unread, so taking the mark off costs nothing when there is none. */
  private readonly markedUnread = new Set<string>();

  private readonly typingSince = new Map<string, number>();

  constructor(private readonly context: ConversationOperationsContext) {}

  async list(options: ListConversationsOptions = {}): Promise<readonly Conversation[]> {
    this.context.assertStarted();
    const limit = options.limit;
    if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) {
      throw new SdkError("INVALID_INPUT", "How many conversations must be a positive whole number");
    }
    const storedConversations = this.context.storage
      ? await this.context.storage.getConversations()
      : [];
    try {
      const conversations = await this.context.adapter.listConversations(limit);
      // Before catching up the adapter knows only what has arrived so far, so what was kept from last time is
      // shown alongside it. Once caught up, what the adapter says is the whole picture.
      const shown = this.context.isCaughtUp()
        ? conversations
        : union(storedConversations, conversations);
      this.remember(conversations);
      await this.persistChanged(conversations, storedConversations);
      await this.trimCache(shown);
      return firstFew(byRecentActivity(shown), limit);
    } catch (error) {
      if (storedConversations.length === 0) {
        throw error;
      }
      return firstFew(byRecentActivity(storedConversations), limit);
    }
  }

  async create(input: CreateConversationInput): Promise<Conversation> {
    this.context.assertStarted();
    // A public conversation can start empty: people join it instead of being invited.
    if (input.participantIds.length === 0 && input.public !== true) {
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

  async join(conversationId: string, options: JoinConversationOptions = {}): Promise<Conversation> {
    this.context.assertStarted();
    const via = (options.via ?? []).map(server => server.trim()).filter(server => server.length > 0);
    const conversation = await this.context.adapter.joinConversation(conversationId, via);
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
  /**
   * Somebody with hundreds of conversations should not carry every one of them on disk forever. The ones with
   * the most recent activity are kept, and one with something still waiting to be sent is never dropped:
   * that would throw away the message along with it.
   */
  private async trimCache(conversations: readonly Conversation[]): Promise<void> {
    const { storage, cachedConversations: limit } = this.context;
    if (!storage || limit === undefined || conversations.length <= limit) return;
    const pending = await storage.getPendingMessages();
    const waiting = new Set(pending.map(message => message.conversationId));
    const droppable = byRecentActivity(conversations).filter(conversation => !waiting.has(conversation.id));
    const excess = conversations.length - limit;
    const dropped = droppable.slice(-excess);
    await Promise.all(dropped.map(conversation => storage.deleteConversation(conversation.id)));
  }

  private async persistChanged(
    conversations: readonly Conversation[],
    stored: readonly Conversation[]
  ): Promise<void> {
    const { storage } = this.context;
    if (!storage) return;
    const known = new Map(stored.map(conversation => [conversation.id, JSON.stringify(conversation)]));
    const changed = conversations.filter(conversation => known.get(conversation.id) !== JSON.stringify(conversation));
    await storage.saveConversations(changed);
  }

  /** Removes somebody from the conversation. They can come back if invited again. */
  async remove(conversationId: string, userId: UserId, reason?: string): Promise<Conversation> {
    return this.save(await this.context.adapter.removeFromConversation(
      conversationId,
      this.requireUser(userId),
      reason
    ));
  }

  /** Removes somebody and keeps them out until the ban is lifted. */
  async ban(conversationId: string, userId: UserId, reason?: string): Promise<Conversation> {
    return this.save(await this.context.adapter.banFromConversation(conversationId, this.requireUser(userId), reason));
  }

  async unban(conversationId: string, userId: UserId): Promise<Conversation> {
    return this.save(await this.context.adapter.unbanFromConversation(conversationId, this.requireUser(userId)));
  }

  /**
   * Somebody who read a conversation and wants to come back to it later. It is a mark of their own, so it is
   * taken off the moment they actually read it.
   */
  async setUnread(conversationId: string, unread: boolean): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.context.adapter.setConversationUnread(conversationId, unread));
  }

  /**
   * Reading a conversation takes the mark off, because a conversation somebody is looking at is not one they
   * left for later. Nothing goes out when there is no mark, which is almost every time one is opened.
   */
  async clearUnreadMark(conversationId: string): Promise<void> {
    if (!this.markedUnread.has(conversationId)) return;
    await this.setUnread(conversationId, false);
  }

  /** Which conversations somebody left for later, so reading one only costs a request when it was marked. */
  private remember(conversations: readonly Conversation[]): void {
    for (const conversation of conversations) {
      if (conversation.isUnread) this.markedUnread.add(conversation.id);
      else this.markedUnread.delete(conversation.id);
    }
  }

  async setFavourite(conversationId: string, favourite: boolean): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.context.adapter.setConversationFavourite(conversationId, favourite));
  }

  async setTopic(conversationId: string, topic: string): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.context.adapter.setConversationTopic(conversationId, topic.trim()));
  }

  async setAvatar(conversationId: string, image: AvatarImage): Promise<Conversation> {
    this.context.assertStarted();
    if (image.data.byteLength === 0 || !image.mimeType.trim()) {
      throw new SdkError("INVALID_INPUT", "A picture needs content and a type");
    }
    return this.save(await this.context.adapter.setConversationAvatar(conversationId, image));
  }

  /** Decides how much a conversation may interrupt, which is what silencing a noisy group means. */
  async setNotifications(conversationId: string, level: NotificationLevel): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.context.adapter.setConversationNotifications(conversationId, level));
  }

  async pin(conversationId: string, messageId: string): Promise<void> {
    this.context.assertStarted();
    if (!messageId.trim()) {
      throw new SdkError("INVALID_INPUT", "A message id is required");
    }
    await this.context.adapter.pinMessage(conversationId, messageId.trim());
  }

  async unpin(conversationId: string, messageId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.unpinMessage(conversationId, messageId.trim());
  }

  /** Kept to hand, and readable with no homeserver as long as the conversation itself is. */
  async pinned(conversationId: string): Promise<readonly Message[]> {
    this.context.assertStarted();
    try {
      return await this.context.adapter.listPinnedMessages(conversationId);
    } catch (error) {
      const kept = await this.keptPinned(conversationId);
      if (kept.length === 0) throw error;
      return kept;
    }
  }

  /** What was known to be pinned last time, taken from the messages already here. */
  private async keptPinned(conversationId: string): Promise<readonly Message[]> {
    const { storage } = this.context;
    if (!storage) return [];
    const conversation = (await storage.getConversations()).find(item => item.id === conversationId);
    const wanted = new Set(conversation?.pinnedIds ?? []);
    if (wanted.size === 0) return [];
    return (await storage.getMessages(conversationId)).filter(message => wanted.has(message.id));
  }

  /** Keeps what somebody was writing. Blank text means there is nothing left to keep. */
  async saveDraft(conversationId: string, text: string): Promise<void> {
    this.context.assertStarted();
    const kept = text.trim();
    await this.context.storage?.saveDraft(conversationId, kept.length > 0 ? kept : undefined);
  }

  async draft(conversationId: string): Promise<string | undefined> {
    this.context.assertStarted();
    return this.context.storage?.getDraft(conversationId);
  }

  /**
   * Replaces a conversation with a new one that carries on from it. Everything said before stays where it was;
   * the old conversation keeps a pointer so nobody is left talking in a room the rest have walked out of.
   */
  async upgrade(conversationId: string): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.context.adapter.upgradeConversation(conversationId));
  }

  /** Follows the replacements until the conversation people are actually in. */
  async current(conversationId: string): Promise<Conversation> {
    this.context.assertStarted();
    const conversations = await this.list();
    const byId = new Map(conversations.map(conversation => [conversation.id, conversation]));
    const seen = new Set<string>();
    let conversation = byId.get(conversationId);
    if (!conversation) {
      throw new SdkError("CONVERSATION_NOT_FOUND", "The conversation does not exist");
    }
    // A chain that loops back on itself would spin forever, so every conversation is followed once.
    while (conversation.replacedBy && !seen.has(conversation.id)) {
      seen.add(conversation.id);
      const next = byId.get(conversation.replacedBy);
      if (!next) break;
      conversation = next;
    }
    return conversation;
  }

  /**
   * Throws away the key this conversation is locked with, so whatever is said from now on uses a new one.
   * Somebody who kept the old key can still read what was said before, but nothing said after this.
   */
  async rotateKeys(conversationId: string): Promise<void> {
    this.context.assertStarted();
    if (!conversationId.trim()) {
      throw new SdkError("INVALID_INPUT", "A conversation is required");
    }
    await this.context.adapter.rotateConversationKeys(conversationId.trim());
  }

  /** A name people can type instead of the identifier. It has to look like `#something:server`. */
  async setAlias(conversationId: string, alias: string): Promise<Conversation> {
    this.context.assertStarted();
    const wanted = alias.trim();
    const looksLikeAnAlias = wanted.startsWith("#") && wanted.includes(":") && wanted.length > 3;
    if (!looksLikeAnAlias) {
      throw new SdkError("INVALID_INPUT", "An alias looks like #name:server");
    }
    return this.save(await this.context.adapter.setConversationAlias(conversationId, wanted));
  }

  /**
   * Puts a conversation on the public list of the homeserver, or takes it off. A conversation only invited
   * people can enter stays out of sight even when listed, because the list would be pointing at a closed door.
   */
  async publish(conversationId: string, listed: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.publishConversation(conversationId, listed);
  }

  /** What is on that public list, which is how somebody finds a conversation they have not been invited to. */
  async discover(query?: string): Promise<readonly PublicConversation[]> {
    this.context.assertStarted();
    const wanted = query?.trim();
    return this.context.adapter.discoverConversations(wanted && wanted.length > 0 ? wanted : undefined);
  }

  /** Who may come in: only those invited, anybody, or anybody willing to ask first. */
  async setJoinRule(conversationId: string, rule: JoinRule): Promise<Conversation> {
    this.context.assertStarted();
    if (!joinRules.includes(rule)) {
      throw new SdkError("INVALID_INPUT", `Unknown join rule: ${rule}`);
    }
    return this.save(await this.context.adapter.setJoinRule(conversationId, rule));
  }

  /** How far back somebody who arrives late is allowed to read. */
  async setHistoryVisibility(conversationId: string, visibility: HistoryVisibility): Promise<Conversation> {
    this.context.assertStarted();
    if (!historyVisibilities.includes(visibility)) {
      throw new SdkError("INVALID_INPUT", `Unknown history visibility: ${visibility}`);
    }
    return this.save(await this.context.adapter.setHistoryVisibility(conversationId, visibility));
  }

  /** Asks to come in to a conversation that does not let people join on their own. */
  async knock(conversationId: string, options: KnockOptions = {}): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.knockConversation(conversationId, options);
  }

  async permissions(conversationId: string): Promise<ConversationPermissions> {
    this.context.assertStarted();
    return this.context.adapter.getPermissions(conversationId);
  }

  async setRole(conversationId: string, userId: UserId, role: ConversationRole): Promise<void> {
    await this.context.adapter.setRole(conversationId, this.requireUser(userId), role);
  }

  private requireUser(userId: UserId): UserId {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new SdkError("INVALID_INPUT", "A user id is required");
    }
    return userId.trim();
  }

  private async save(conversation: Conversation): Promise<Conversation> {
    this.remember([conversation]);
    await this.context.storage?.saveConversation(conversation);
    this.context.emitUpdated(conversation);
    return conversation;
  }

  /**
   * Says somebody is writing. Callers say it on every keystroke, so this only goes out when it tells the other
   * side something new: the first letter, and again before the notice runs out. Stopping always goes out,
   * because the other side is sitting there waiting for it.
   */
  async typing(conversationId: string, isTyping: boolean, timeoutMs = 5000): Promise<void> {
    this.context.assertStarted();
    if (!Number.isInteger(timeoutMs) || timeoutMs < 0) {
      throw new SdkError("INVALID_INPUT", "Typing timeout must be a non-negative integer");
    }
    const announcedAt = this.typingSince.get(conversationId);
    if (!isTyping) {
      if (announcedAt === undefined) return;
      this.typingSince.delete(conversationId);
      await this.context.adapter.setTyping(conversationId, false, timeoutMs);
      return;
    }
    const now = this.context.now();
    // Renewing before the notice expires, not after, so the other side never sees it flicker off.
    const stillFresh = announcedAt !== undefined && now - announcedAt < (timeoutMs * 2) / 3;
    if (stillFresh) return;
    this.typingSince.set(conversationId, now);
    await this.context.adapter.setTyping(conversationId, true, timeoutMs);
  }

  /** Who was writing is only true while the client runs, so it does not survive stopping it. */
  forget(): void {
    this.typingSince.clear();
  }
}

/** Newest activity first, which is the order a conversation list is expected to show. */
function firstFew(conversations: readonly Conversation[], limit: number | undefined): readonly Conversation[] {
  return limit === undefined ? conversations : conversations.slice(0, limit);
}

/** The adapter's version of a conversation wins, and whatever it has not heard of yet is kept. */
function union(stored: readonly Conversation[], fresh: readonly Conversation[]): readonly Conversation[] {
  const conversations = new Map(stored.map(conversation => [conversation.id, conversation]));
  for (const conversation of fresh) conversations.set(conversation.id, conversation);
  return [...conversations.values()];
}

/**
 * Newest activity first, and the identifier decides between conversations with nothing said in them. Without
 * that tie breaker the order depends on the order they happened to arrive, and a list that grows as more
 * arrive would reshuffle what somebody is already looking at.
 */
export function byRecentActivity(conversations: readonly Conversation[]): readonly Conversation[] {
  return [...conversations].sort((left, right) => {
    const byActivity = (right.lastMessage?.createdAt ?? 0) - (left.lastMessage?.createdAt ?? 0);
    if (byActivity !== 0) return byActivity;
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
