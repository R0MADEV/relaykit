import { RelayKitError } from "./errors.js";
import { historyVisibilities, joinRules } from "./models.js";
import type { ConversationSettingsAdapter, PinsAdapter } from "./adapter.js";
import type {
  AvatarImage,
  Conversation,
  ConversationId,
  RoomVersions,
  HistoryVisibility,
  JoinRule,
  Message,
  NotificationLevel
} from "./models.js";
import type { ConversationOperationsContext } from "./conversation-operations.js";

/**
 * What a conversation is called, what it looks like, who may come in, and what is kept to hand in it.
 *
 * Apart from the rest because these all change the conversation rather than take part in it, and because a
 * backend may have none of them: a protocol with no names, no avatars and no pins still carries messages.
 */
export class ConversationSettings {
  /**
   * Takes a conversation out of this account's history.
   *
   * Leaving stops it arriving; forgetting stops it being there at all, which is what somebody who left a
   * conversation by mistake and does not want to see it again actually means. It has to be left first: a
   * conversation forgotten while still in it would come back on the next sync.
   */
  async forget(conversationId: ConversationId): Promise<void> {
    this.context.assertStarted();
    await this.conversationSettings.forgetConversation(conversationId);
  }

  /** Filing it under a name of this person's own. Nobody else sees it. */
  async tag(conversationId: ConversationId, tag: string): Promise<void> {
    this.context.assertStarted();
    await this.conversationSettings.setConversationTag(conversationId, requireTag(tag));
  }

  async untag(conversationId: ConversationId, tag: string): Promise<void> {
    this.context.assertStarted();
    await this.conversationSettings.removeConversationTag(conversationId, requireTag(tag));
  }

  async tags(conversationId: ConversationId): Promise<readonly string[]> {
    this.context.assertStarted();
    return this.conversationSettings.listConversationTags(conversationId);
  }

  /** What an upgrade has to choose from: a conversation cannot be moved to a version nobody admits. */
  async versions(): Promise<RoomVersions> {
    this.context.assertStarted();
    return this.conversationSettings.listRoomVersions();
  }

  constructor(
    private readonly context: ConversationOperationsContext,
    private readonly save: (conversation: Conversation) => Promise<Conversation>,
    /** Conversations this person put back to unread, which the rest of the operations reads too. */
    private readonly markedUnread: Set<string>
  ) {}

  async rename(conversationId: string, title: string): Promise<Conversation> {
    this.context.assertStarted();
    if (!title.trim()) {
      throw new RelayKitError("INVALID_INPUT", "Conversation title cannot be empty");
    }
    return this.save(await this.conversationSettings.renameConversation(conversationId, title.trim()));
  }
  /**
   * Somebody who read a conversation and wants to come back to it later. It is a mark of their own, so it is
   * taken off the moment they actually read it.
   */
  async setUnread(conversationId: string, unread: boolean): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.conversationSettings.setConversationUnread(conversationId, unread));
  }
  /**
   * Reading a conversation takes the mark off, because a conversation somebody is looking at is not one they
   * left for later. Nothing goes out when there is no mark, which is almost every time one is opened.
   */
  async clearUnreadMark(conversationId: string): Promise<void> {
    if (!this.markedUnread.has(conversationId)) return;
    await this.setUnread(conversationId, false);
  }
  async setFavourite(conversationId: string, favourite: boolean): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.conversationSettings.setConversationFavourite(conversationId, favourite));
  }
  async setTopic(conversationId: string, topic: string): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.conversationSettings.setConversationTopic(conversationId, topic.trim()));
  }
  async setAvatar(conversationId: string, image: AvatarImage): Promise<Conversation> {
    this.context.assertStarted();
    if (image.data.byteLength === 0 || !image.mimeType.trim()) {
      throw new RelayKitError("INVALID_INPUT", "A picture needs content and a type");
    }
    return this.save(await this.conversationSettings.setConversationAvatar(conversationId, image));
  }
  /** Decides how much a conversation may interrupt, which is what silencing a noisy group means. */
  async setNotifications(conversationId: string, level: NotificationLevel): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.conversationSettings.setConversationNotifications(conversationId, level));
  }
  async pin(conversationId: string, messageId: string): Promise<void> {
    this.context.assertStarted();
    if (!messageId.trim()) {
      throw new RelayKitError("INVALID_INPUT", "A message id is required");
    }
    await this.pins.pinMessage(conversationId, messageId.trim());
  }
  async unpin(conversationId: string, messageId: string): Promise<void> {
    this.context.assertStarted();
    await this.pins.unpinMessage(conversationId, messageId.trim());
  }
  /** Kept to hand, and readable with no homeserver as long as the conversation itself is. */
  async pinned(conversationId: string): Promise<readonly Message[]> {
    this.context.assertStarted();
    try {
      return await this.pins.listPinnedMessages(conversationId);
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
  /**
   * Replaces a conversation with a new one that carries on from it. Everything said before stays where it was;
   * the old conversation keeps a pointer so nobody is left talking in a room the rest have walked out of.
   */
  async upgrade(conversationId: string): Promise<Conversation> {
    this.context.assertStarted();
    return this.save(await this.conversationSettings.upgradeConversation(conversationId));
  }
  /** A name people can type instead of the identifier. It has to look like `#something:server`. */
  async setAlias(conversationId: string, alias: string): Promise<Conversation> {
    this.context.assertStarted();
    const wanted = alias.trim();
    const looksLikeAnAlias = wanted.startsWith("#") && wanted.includes(":") && wanted.length > 3;
    if (!looksLikeAnAlias) {
      throw new RelayKitError("INVALID_INPUT", "An alias looks like #name:server");
    }
    return this.save(await this.conversationSettings.setConversationAlias(conversationId, wanted));
  }
  /**
   * Puts a conversation on the public list of the homeserver, or takes it off. A conversation only invited
   * people can enter stays out of sight even when listed, because the list would be pointing at a closed door.
   */
  async publish(conversationId: string, listed: boolean): Promise<void> {
    this.context.assertStarted();
    await this.conversationSettings.publishConversation(conversationId, listed);
  }
  /** Who may come in: only those invited, anybody, or anybody willing to ask first. */
  async setJoinRule(conversationId: string, rule: JoinRule): Promise<Conversation> {
    this.context.assertStarted();
    if (!joinRules.includes(rule)) {
      throw new RelayKitError("INVALID_INPUT", `Unknown join rule: ${rule}`);
    }
    return this.save(await this.conversationSettings.setJoinRule(conversationId, rule));
  }
  /** How far back somebody who arrives late is allowed to read. */
  async setHistoryVisibility(conversationId: string, visibility: HistoryVisibility): Promise<Conversation> {
    this.context.assertStarted();
    if (!historyVisibilities.includes(visibility)) {
      throw new RelayKitError("INVALID_INPUT", `Unknown history visibility: ${visibility}`);
    }
    return this.save(await this.conversationSettings.setHistoryVisibility(conversationId, visibility));
  }
  /** The one place that answers whether this adapter does this at all. */
  private get conversationSettings(): ConversationSettingsAdapter {
    const found = this.context.adapter.conversationSettings;
    if (!found)
      throw new RelayKitError(
        "NOT_SUPPORTED",
        "Changing what a conversation is is not something this homeserver has"
      );
    return found;
  }

  /** The one place that answers whether this adapter does this at all. */
  private get pins(): PinsAdapter {
    const found = this.context.adapter.pins;
    if (!found)
      throw new RelayKitError("NOT_SUPPORTED", "Pinning messages is not something this homeserver has");
    return found;
  }
}

/** A name nobody typed is not a name, and the homeserver would keep it for ever. */
function requireTag(tag: string): string {
  if (!tag.trim()) {
    throw new RelayKitError("INVALID_INPUT", "A tag name is required");
  }
  return tag.trim();
}
