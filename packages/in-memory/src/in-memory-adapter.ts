import type {
  AccountAdapter,
  HistoryAdapter,
  RemoteSearchOptions,
  RemoteSearchPage,
  RoomVersions,
  WayIn,
  PushRegistration,
  AdapterHandlers,
  CallingAdapter,
  CryptoAdapter,
  DevicesAdapter,
  LocationAdapter,
  MediaAdapter,
  PollsAdapter,
  PushAdapter,
  ReactionsAdapter,
  SpacesAdapter,
  MessagingAdapter,
  MarkReadOptions,
  Notification,
  ThreadSummary,
  LinkPreview,
  MediaLimits,
  Call,
  ConversationSettingsAdapter,
  EditingAdapter,
  IgnoringAdapter,
  ModerationAdapter,
  PinsAdapter,
  PresenceAdapter,
  ReceiptsAdapter,
  SearchAdapter,
  ThreadsAdapter
} from "@relaykit/core";
import type {
  Attachment,
  ConnectionStatus,
  AvatarImage,
  ConversationPermissions,
  ConversationRole,
  NotificationLevel,
  SendContent,
  MediaRef,
  ReadReceipt,
  ThumbnailInput,
  FileInput,
  MessagePage,
  User,
  Conversation,
  Participant,
  ConversationId,
  CreateConversationInput,
  MessageId,
  PublicConversation,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  Reaction,
  PresenceUpdate,
  LoginCredentials,
  RegisterCredentials,
  Message,
  Session,
  UserId,
  UserPresence,
  VerificationSession
} from "@relaykit/core";
import { SdkError, conversationLinkedIn } from "@relaykit/core";
import { InMemoryCalls } from "./in-memory-calls.js";
import { InMemoryCrypto } from "./in-memory-crypto.js";
import { InMemoryPeople, type HeldProfile } from "./in-memory-people.js";
import { InMemoryShares } from "./in-memory-shares.js";
import { InMemoryModeration, type Knock } from "./in-memory-moderation.js";
import { InMemoryFromOutside } from "./in-memory-from-outside.js";
import { InMemorySpaces } from "./in-memory-spaces.js";
import { InMemoryAccount, InMemoryGuests } from "./in-memory-account.js";
import { InMemorySso } from "./in-memory-sso.js";
import { InMemoryFeatures } from "./in-memory-features.js";
import { InMemoryVerification } from "./in-memory-verification.js";

/** A message somebody said was worth the homeserver's attention, and what they said about it. */
interface Report {
  readonly conversationId: ConversationId;
  readonly messageId: MessageId;
  readonly reason: string;
}

export interface InMemoryAdapterOptions {
  readonly conversations?: readonly Conversation[];
  readonly messages?: readonly Message[];
  /**
   * How many of a conversation's messages reading it gives, newest last, with the rest reached by going back.
   *
   * A homeserver hands over the end of a conversation and keeps the rest until it is asked. Left out, this
   * double hands over everything, which is what most tests want and what it has always done.
   */
  readonly showAtMost?: number;
}

/** What a message invites into, when it carries a link to somewhere. Nothing, when it carries none. */
function invitation(body: string): { invitesTo?: ConversationId } {
  const invitesTo = conversationLinkedIn(body);
  return invitesTo ? { invitesTo } : {};
}

export class InMemoryAdapter implements MessagingAdapter {
  /**
   * The optional halves this adapter can do, which is all of them.
   *
   * `this` rather than an object of its own: the class already has every one of those methods, so it
   * satisfies each of those shapes as it stands. Saying it here is what tells the library it does.
   */
  readonly conversationSettings: ConversationSettingsAdapter = this;
  readonly editing: EditingAdapter = this;
  readonly ignoring: IgnoringAdapter = this;
  readonly sso = new InMemorySso({
    signIn: userId => {
      const session = { homeserver: "memory://test", userId, accessToken: `memory-token-${userId}` };
      this.currentUserId = userId;
      return session;
    }
  });
  /** Whatever this session came in with, which is what changing it has to be told. */
  private currentPassword = "token";
  private readonly accountIn = new InMemoryAccount({
    password: () => this.currentPassword,
    changed: to => (this.currentPassword = to)
  });
  readonly account: AccountAdapter = this.accountIn;
  readonly guests = new InMemoryGuests();
  readonly moderation: ModerationAdapter = this;
  readonly pins: PinsAdapter = this;
  readonly presence: PresenceAdapter = this;
  readonly receipts: ReceiptsAdapter = this;
  readonly search: SearchAdapter = this;
  readonly threads: ThreadsAdapter = this;

  private readonly conversations: Conversation[];
  private readonly messages: Message[];
  private handlers: AdapterHandlers = {};
  private currentUserId: UserId | undefined;
  private currentDeviceId: string | undefined;
  private nextMessageId = 1;
  private nextConversationId = 1;
  private nextAttachmentId = 1;
  private readonly unreadCounts = new Map<ConversationId, number>();
  private readonly reported: Report[] = [];
  private readonly published = new Set<ConversationId>();
  /** What each conversation is filed under, which only this account sees. */
  private readonly filedUnder = new Map<ConversationId, Set<string>>();
  /** How far back each conversation has been read, for a double that hands over the end and keeps the rest. */
  private readonly reached = new Map<ConversationId, number>();

  private readonly readBy: ReadReceipt[] = [];
  private readonly attachments = new Map<string, Uint8Array>();
  private readonly features = new InMemoryFeatures(
    () => this.currentUserId,
    () => this.handlers
  );
  private readonly verification = new InMemoryVerification(() => this.handlers);
  private readonly cryptography = new InMemoryCrypto(this.features, this.verification, conversationId =>
    this.requireConversation(conversationId)
  );
  private readonly moderating = new InMemoryModeration({
    requireUserId: () => this.requireUserId(),
    currentUserId: () => this.currentUserId,
    requireConversation: conversationId => this.requireConversation(conversationId),
    replaceConversation: conversation => this.replaceConversation(conversation)
  });
  private readonly fromOutside = new InMemoryFromOutside({ messages: () => this.messages });
  private readonly spacesIn = new InMemorySpaces({
    conversations: () => this.conversations,
    nextId: () => this.nextConversationId++
  });
  private readonly people = new InMemoryPeople({
    requireUserId: () => this.requireUserId(),
    deviceId: () => this.currentDeviceId,
    everybodySeen: () => this.conversations.flatMap(conversation => conversation.participantIds)
  });
  private readonly shares = new InMemoryShares({
    requireUserId: () => this.requireUserId(),
    nextId: () => this.nextMessageId++
  });
  private readonly callsGoingOn = new InMemoryCalls({
    handlers: () => this.handlers,
    requireUserId: () => this.requireUserId(),
    deviceId: () => this.currentDeviceId,
    hasConversation: conversationId => this.conversations.some(item => item.id === conversationId),
    nextId: () => this.nextMessageId++
  });

  constructor(private readonly options: InMemoryAdapterOptions = {}) {
    this.conversations = [...(options.conversations ?? [])];
    this.messages = [...(options.messages ?? [])];
  }

  async start(session: Session, handlers: AdapterHandlers): Promise<void> {
    this.currentUserId = session.userId;
    this.currentDeviceId = session.deviceId;
    this.handlers = handlers;
  }

  private readonly takenUsernames = new Set<string>();
  private requiredRegistrationStages: readonly string[] = [];

  /** Test helper: makes a username unavailable, as a homeserver would. */
  takeUsername(username: string): void {
    this.takenUsernames.add(username);
  }

  /** Test helper: makes the homeserver ask for more than a password. */
  requireRegistrationStages(stages: readonly string[]): void {
    this.requiredRegistrationStages = stages;
  }

  async register(credentials: RegisterCredentials): Promise<Session> {
    if (this.requiredRegistrationStages.length > 0) {
      throw new SdkError(
        "REGISTRATION_UNSUPPORTED",
        `This homeserver requires: ${this.requiredRegistrationStages.join(", ")}`
      );
    }
    if (this.takenUsernames.has(credentials.username)) {
      throw new SdkError("USERNAME_TAKEN", "That username is already taken");
    }
    this.takenUsernames.add(credentials.username);
    return {
      homeserver: credentials.homeserver,
      userId: credentials.username,
      accessToken: `memory-token-${credentials.username}`
    };
  }

  async login(credentials: LoginCredentials): Promise<Session> {
    return {
      homeserver: credentials.homeserver,
      userId: credentials.username,
      accessToken: `memory-token-${credentials.username}`
    };
  }

  async stop(): Promise<void> {
    this.handlers = {};
    this.currentUserId = undefined;
  }

  async logout(): Promise<void> {
    await this.stop();
  }

  async listConversations(): Promise<readonly Conversation[]> {
    return this.conversations.map(conversation => this.asSeenFromOutside(conversation));
  }

  /**
   * Whatever leaves this adapter looks the same however it left. Handing out a conversation without its unread
   * count on one path and with it on another makes a live list flicker for no reason.
   */
  private asSeenFromOutside(conversation: Conversation): Conversation {
    return { ...conversation, unreadCount: this.unreadCounts.get(conversation.id) ?? 0 };
  }

  /** Test helper: simulates a message arriving from another participant. */
  receiveMessage(
    conversationId: ConversationId,
    senderId: UserId,
    body: string,
    overrides: Partial<Message> = {}
  ): Message {
    const message: Message = {
      id: `memory-message-${this.nextMessageId++}`,
      conversationId,
      senderId,
      body,
      createdAt: this.stamp(),
      status: "sent",
      ...invitation(body),
      ...overrides
    };
    if (this.ignoredUsers.includes(senderId)) return message;
    this.unreadCounts.set(conversationId, (this.unreadCounts.get(conversationId) ?? 0) + 1);
    const appended = this.appendMessage(message);
    const ownUserId = this.currentUserId;
    const level = this.findConversation(conversationId)?.notifications;
    const namesMe = ownUserId !== undefined && body.toLowerCase().includes(ownUserId.toLowerCase());
    // A silenced conversation says nothing, and one set to mentions only speaks when it names you.
    if (level === "none" || (level === "mentions" && !namesMe)) return appended;
    this.handlers.onNotification?.({
      conversationId,
      messageId: appended.id,
      senderId,
      body,
      isMention: ownUserId !== undefined && body.toLowerCase().includes(ownUserId.toLowerCase())
    });
    return appended;
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    const conversation: Conversation = {
      id: `memory-conversation-${this.nextConversationId++}`,
      participantIds: [...input.participantIds],
      // Creating a conversation invites the others; they are not in it until they accept.
      invitedIds: [...input.participantIds],
      membership: "join",
      // A conversation is for the people invited to it unless it was asked to be open.
      joinRule: input.public ? "public" : "invite",
      // What the conversation is, not what was asked for. With no homeserver to have a policy of its own,
      // only what was asked for is encrypted here, but it is always said so nobody has to assume.
      isEncrypted: input.encrypted === true,
      ...(input.title ? { title: input.title } : {}),
      ...(input.direct ? { isDirect: true } : {})
    };
    this.conversations.push(conversation);
    this.handlers.onConversationUpdated?.(conversation);
    return conversation;
  }

  async joinConversation(
    conversationId: ConversationId,
    _via: readonly string[] = []
  ): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), membership: "join" });
  }

  async leaveConversation(conversationId: ConversationId): Promise<void> {
    const index = this.conversations.findIndex(item => item.id === conversationId);
    if (index >= 0) this.conversations.splice(index, 1);
    this.unreadCounts.delete(conversationId);
  }

  async inviteToConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    const conversation = this.requireConversation(conversationId);
    const participantIds = conversation.participantIds.includes(userId)
      ? conversation.participantIds
      : [...conversation.participantIds, userId];
    const invitedIds = [...new Set([...(conversation.invitedIds ?? []), userId])];
    // Letting somebody in answers the knock, so they stop waiting at the door.
    const knockingIds = (conversation.knockingIds ?? []).filter(waiting => waiting !== userId);
    return this.replaceConversation({ ...conversation, participantIds, invitedIds, knockingIds });
  }

  /** Test helper: the conversations whose key was thrown away. */
  rotatedKeysOf(): readonly ConversationId[] {
    return this.cryptography.rotatedKeys();
  }

  async upgradeConversation(conversationId: ConversationId): Promise<Conversation> {
    const previous = this.requireConversation(conversationId);
    // What was said before stays where it was; only the people and the name carry over.
    const { lastMessage, replacedBy, id, ...carriedOver } = previous;
    const replacement: Conversation = {
      ...carriedOver,
      id: `memory-conversation-${this.nextConversationId++}`,
      replaces: previous.id
    };
    this.conversations.push(replacement);
    this.replaceConversation({ ...previous, replacedBy: replacement.id });
    this.handlers.onConversationUpdated?.(replacement);
    return replacement;
  }

  async setConversationAlias(conversationId: ConversationId, alias: string): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), alias });
  }

  async publishConversation(conversationId: ConversationId, listed: boolean): Promise<void> {
    if (listed) this.published.add(conversationId);
    else this.published.delete(conversationId);
  }

  async discoverConversations(query: string | undefined): Promise<readonly PublicConversation[]> {
    const wanted = query?.toLowerCase();
    return (
      this.conversations
        .filter(conversation => this.published.has(conversation.id))
        // Listing a conversation nobody can join says nothing, so it is not shown either.
        .filter(conversation => conversation.joinRule !== "invite")
        // The real thing matches the name, what it is about and the name people type, so the double does too.
        .filter(conversation => {
          if (!wanted) return true;
          const searchable = [conversation.title, conversation.topic, conversation.alias, conversation.id];
          return searchable.some(field => (field ?? "").toLowerCase().includes(wanted));
        })
        .map(conversation => ({
          id: conversation.id,
          participantCount: conversation.participantIds.length,
          ...(conversation.title ? { title: conversation.title } : {}),
          ...(conversation.topic ? { topic: conversation.topic } : {}),
          ...(conversation.alias ? { alias: conversation.alias } : {}),
          ...(conversation.joinRule ? { joinRule: conversation.joinRule } : {})
        }))
    );
  }

  async reportMessage(conversationId: ConversationId, messageId: MessageId, reason: string): Promise<void> {
    this.reported.push({ conversationId, messageId, reason });
  }

  /** Test helper: what has been reported to whoever runs the server. */
  reports(): readonly Report[] {
    return this.reported;
  }

  async setJoinRule(conversationId: ConversationId, rule: JoinRule): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), joinRule: rule });
  }

  async setHistoryVisibility(
    conversationId: ConversationId,
    visibility: HistoryVisibility
  ): Promise<Conversation> {
    return this.replaceConversation({
      ...this.requireConversation(conversationId),
      historyVisibility: visibility
    });
  }

  /** Test helper: simulates someone accepting the invitation to a conversation. */
  acceptInvitation(conversationId: ConversationId, userId: UserId): Conversation {
    const conversation = this.requireConversation(conversationId);
    const invitedIds = (conversation.invitedIds ?? []).filter(invited => invited !== userId);
    return this.replaceConversation({ ...conversation, invitedIds });
  }

  async renameConversation(conversationId: ConversationId, title: string): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), title });
  }

  private findConversation(conversationId: ConversationId): Conversation | undefined {
    return this.conversations.find(item => item.id === conversationId);
  }

  private requireConversation(conversationId: ConversationId): Conversation {
    const conversation = this.findConversation(conversationId);
    if (!conversation) throw new Error("The conversation does not exist");
    return conversation;
  }

  private replaceConversation(conversation: Conversation): Conversation {
    this.conversations[this.conversations.findIndex(item => item.id === conversation.id)] = conversation;
    const seen = this.asSeenFromOutside(conversation);
    this.handlers.onConversationUpdated?.(seen);
    return seen;
  }

  async setTyping(conversationId: ConversationId, isTyping: boolean): Promise<void> {
    return this.features.setTyping(conversationId, isTyping);
  }

  async setPresence(_update: PresenceUpdate): Promise<void> {
    return this.features.setPresence(_update);
  }

  async getPresence(userId: UserId): Promise<UserPresence | undefined> {
    return this.features.getPresence(userId);
  }

  async knockConversation(conversationId: ConversationId, options: KnockOptions): Promise<void> {
    return this.moderating.knockConversation(conversationId, options);
  }

  /** Test helper: who has asked to come in to a conversation and is still waiting. */
  knocksOn(conversationId: ConversationId): readonly Knock[] {
    return this.moderating.knocksOn(conversationId);
  }

  /** Test helper: simulates somebody knocking at a conversation this account is in. */
  receiveKnock(conversationId: ConversationId, userId: UserId): Conversation {
    return this.moderating.receiveKnock(conversationId, userId);
  }

  /** Test helper: sets what somebody is allowed to do in a conversation. */
  setPowerLevel(conversationId: ConversationId, userId: UserId, level: number): void {
    this.moderating.setPowerLevel(conversationId, userId, level);
  }

  powerLevelOf(conversationId: ConversationId, userId: UserId): number {
    return this.moderating.powerLevelOf(conversationId, userId);
  }

  async getPermissions(conversationId: ConversationId): Promise<ConversationPermissions> {
    return this.moderating.getPermissions(conversationId);
  }

  async setRole(conversationId: ConversationId, userId: UserId, role: ConversationRole): Promise<void> {
    return this.moderating.setRole(conversationId, userId, role);
  }

  async listParticipants(conversationId: ConversationId): Promise<readonly Participant[]> {
    return this.moderating.listParticipants(conversationId);
  }

  async removeFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    return this.moderating.removeFromConversation(conversationId, userId);
  }

  async banFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    return this.moderating.banFromConversation(conversationId, userId);
  }

  async unbanFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    return this.moderating.unbanFromConversation(conversationId, userId);
  }

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.said(conversationId).slice(-this.showing(conversationId));
  }

  /** What was said in a conversation. What hangs from a thread lives in the thread, not in the middle of it. */
  private said(conversationId: ConversationId): readonly Message[] {
    return this.messages.filter(
      message => message.conversationId === conversationId && message.threadId === undefined
    );
  }

  /** How far back this conversation has been asked for, which starts at whatever a screen opens with. */
  private showing(conversationId: ConversationId): number {
    return this.reached.get(conversationId) ?? this.options.showAtMost ?? Number.MAX_SAFE_INTEGER;
  }

  private readonly pinned = new Map<ConversationId, Set<MessageId>>();

  /** Gone from this account's list. It stays made: forgetting is about whose history it is in. */
  async forgetConversation(conversationId: ConversationId): Promise<void> {
    const at = this.conversations.findIndex(conversation => conversation.id === conversationId);
    if (at >= 0) this.conversations.splice(at, 1);
    this.filedUnder.delete(conversationId);
  }

  async setConversationTag(conversationId: ConversationId, tag: string): Promise<void> {
    this.requireConversation(conversationId);
    const already = this.filedUnder.get(conversationId) ?? new Set<string>();
    already.add(tag);
    this.filedUnder.set(conversationId, already);
  }

  async removeConversationTag(conversationId: ConversationId, tag: string): Promise<void> {
    this.filedUnder.get(this.requireConversation(conversationId).id)?.delete(tag);
  }

  async listConversationTags(conversationId: ConversationId): Promise<readonly string[]> {
    return [...(this.filedUnder.get(this.requireConversation(conversationId).id) ?? [])];
  }

  /** What this double admits, which is one version: there is nothing here for a second one to mean. */
  async listRoomVersions(): Promise<RoomVersions> {
    return { preferred: "memory-1", available: ["memory-1"] };
  }

  async setConversationTopic(conversationId: ConversationId, topic: string): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), topic });
  }

  async setConversationAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation> {
    const id = `memory-attachment-${this.nextAttachmentId++}`;
    this.attachments.set(id, new Uint8Array(image.data));
    const avatar: MediaRef = { mimeType: image.mimeType, size: image.data.byteLength, source: id };
    return this.replaceConversation({ ...this.requireConversation(conversationId), avatar });
  }

  async setConversationNotifications(
    conversationId: ConversationId,
    level: NotificationLevel
  ): Promise<Conversation> {
    const { notifications: _previous, ...conversation } = this.requireConversation(conversationId);
    return this.replaceConversation(
      level === "all" ? conversation : { ...conversation, notifications: level }
    );
  }

  async pinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    const pinned = this.pinned.get(conversationId) ?? new Set<MessageId>();
    pinned.add(messageId);
    this.pinned.set(conversationId, pinned);
    this.tellAboutPinned(conversationId);
  }

  /** What is pinned travels with the conversation, so it is still known with no homeserver to ask. */
  private tellAboutPinned(conversationId: ConversationId): void {
    const conversation = this.findConversation(conversationId);
    if (!conversation) return;
    this.replaceConversation({ ...conversation, pinnedIds: [...(this.pinned.get(conversationId) ?? [])] });
  }

  async unpinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    this.pinned.get(conversationId)?.delete(messageId);
    this.tellAboutPinned(conversationId);
  }

  async listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    const pinned = this.pinned.get(conversationId) ?? new Set<MessageId>();
    return this.messages.filter(message => pinned.has(message.id));
  }

  /**
   * A page at a time, where a cursor is simply how many have been handed over already.
   *
   * A homeserver's cursor is its own business and means nothing here; what the double has to get right is
   * that a second page is not the first one again, and that the last one says there is no more.
   */
  async searchMessages(query: string, options: RemoteSearchOptions = {}): Promise<RemoteSearchPage> {
    const needle = query.toLowerCase();
    const found = this.messages.filter(message => message.body.toLowerCase().includes(needle));
    const from = Number(options.cursor ?? 0);
    const limit = options.limit ?? found.length;
    const page = found.slice(from, from + limit);
    const handedOver = from + page.length;
    return { messages: page, ...(handedOver < found.length ? { cursor: String(handedOver) } : {}) };
  }

  async listThread(conversationId: ConversationId, rootId: MessageId): Promise<readonly Message[]> {
    return this.messages.filter(
      message => message.conversationId === conversationId && message.threadId === rootId
    );
  }

  async loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage> {
    const said = this.said(conversationId);
    const reached = Math.min(this.showing(conversationId) + limit, said.length);
    this.reached.set(conversationId, reached);
    return { messages: said.slice(-reached), hasMore: reached < said.length };
  }

  async sendMessage(
    conversationId: ConversationId,
    body: string,
    options: SendContent = {}
  ): Promise<Message> {
    const { transactionId, replyToId, threadId, formattedBody, mentions, kind, location } = options;
    const senderId = this.requireUserId();
    const alreadySent = this.sentAlready(transactionId);
    if (alreadySent) {
      return alreadySent;
    }

    return this.appendMessage({
      id: `memory-message-${this.nextMessageId++}`,
      conversationId,
      senderId,
      body,
      createdAt: this.stamp(),
      status: "sent",
      ...invitation(body),
      ...(transactionId ? { transactionId } : {}),
      ...(replyToId ? { replyToId } : {}),
      ...(threadId ? { threadId } : {}),
      ...(formattedBody ? { formattedBody } : {}),
      ...(mentions ? { mentions } : {}),
      ...(location ? { location } : {}),
      ...(kind ? { kind } : {})
    });
  }

  async sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message> {
    const senderId = this.requireUserId();
    const alreadySent = this.sentAlready(transactionId);
    if (alreadySent) {
      return alreadySent;
    }
    onProgress?.(0);
    const id = `memory-attachment-${this.nextAttachmentId++}`;
    this.attachments.set(id, new Uint8Array(file.data));
    const thumbnail = file.thumbnail ? this.storeThumbnail(file.thumbnail) : undefined;
    onProgress?.(1);
    const attachment: Attachment = {
      id,
      name: file.name,
      mimeType: file.mimeType,
      size: file.data.byteLength,
      ...(file.width !== undefined ? { width: file.width } : {}),
      ...(file.height !== undefined ? { height: file.height } : {}),
      ...(thumbnail ? { thumbnail } : {}),
      ...(file.voice ? { voice: file.voice } : {}),
      ...(file.blurhash ? { blurhash: file.blurhash } : {}),
      source: id
    };
    return this.appendMessage({
      id: `memory-message-${this.nextMessageId++}`,
      conversationId,
      senderId,
      body: file.name,
      createdAt: this.stamp(),
      status: "sent",
      attachment,
      // A sticker draws itself, so whoever receives it has to be able to tell it apart from an attachment.
      ...(file.sticker ? { kind: "sticker" as const } : {}),
      ...(transactionId ? { transactionId } : {})
    });
  }

  /** Test helper: gives a user a display name and an avatar. */
  private ignoredUsers: readonly UserId[] = [];
  /** Silenced, not ignored: what they say still arrives, it just does not interrupt. */
  private readonly mutedUsers = new Set<UserId>();
  /** Calls still going on that this side walked out of, which are not this side's any more. */
  /** What the next call would be made with. Kept so a test can see that choosing one was taken notice of. */
  /** How far each thread was read, kept apart from how far its conversation was. */
  private readonly threadReads = new Map<string, MessageId>();
  private notificationLevel: NotificationLevel = "all";

  async setConversationFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation> {
    const { isFavourite: _was, ...conversation } = this.requireConversation(conversationId);
    return this.replaceConversation(favourite ? { ...conversation, isFavourite: true } : conversation);
  }

  async listIgnoredUsers(): Promise<readonly UserId[]> {
    return this.ignoredUsers;
  }

  async setIgnoredUsers(userIds: readonly UserId[]): Promise<void> {
    this.ignoredUsers = [...userIds];
  }

  /** Test helper: adds another session of this account. */
  /** Test helper: what somebody goes by everywhere, and the picture they go by it with. */
  setProfile(userId: UserId, profile: HeldProfile): void {
    this.people.setProfile(userId, profile);
  }

  /** Test helper: the name somebody uses inside one conversation, which can differ from their own. */
  setConversationName(conversationId: ConversationId, userId: UserId, displayName: string): void {
    this.people.setConversationName(conversationId, userId, displayName);
  }

  /** Test helper: another device of this account, which is not another person. */
  /** Test helper: what this homeserver offers besides a password. */
  offerSignInWith(waysIn: readonly WayIn[]): void {
    this.sso.offer(waysIn);
  }

  addDevice(deviceId: string, displayName?: string, lastSeenAt?: number): void {
    this.people.addDevice(deviceId, displayName, lastSeenAt);
  }

  setDisplayName(displayName: string): Promise<void> {
    return this.people.setDisplayName(displayName);
  }

  setAvatar(image: AvatarImage): Promise<void> {
    return this.people.setAvatar(image);
  }

  getProfile(userId: UserId, conversationId?: ConversationId): Promise<User> {
    return this.people.getProfile(userId, conversationId);
  }

  getAvatar(
    userId: UserId,
    _conversationId?: ConversationId,
    _size?: number
  ): Promise<AvatarImage | undefined> {
    return this.people.getAvatar(userId);
  }

  searchUsers(query: string, limit: number): Promise<readonly User[]> {
    return this.people.searchUsers(query, limit);
  }

  /** Sending twice under one transaction is one message: the second ask gets the first answer. */
  private sentAlready(transactionId?: string): Message | undefined {
    return transactionId ? this.messages.find(item => item.transactionId === transactionId) : undefined;
  }

  private requireUserId(): UserId {
    if (!this.currentUserId) throw new Error("The in-memory adapter is not started");
    return this.currentUserId;
  }

  private storeThumbnail(thumbnail: ThumbnailInput): MediaRef {
    const id = `memory-attachment-${this.nextAttachmentId++}`;
    this.attachments.set(id, new Uint8Array(thumbnail.data));
    return {
      mimeType: thumbnail.mimeType,
      size: thumbnail.data.byteLength,
      ...(thumbnail.width !== undefined ? { width: thumbnail.width } : {}),
      ...(thumbnail.height !== undefined ? { height: thumbnail.height } : {}),
      source: id
    };
  }

  /** Conferences, which this double always holds. */
  readonly calling: CallingAdapter = this.callsGoingOn;
  /** Everything else this double does, which is all of it. */
  readonly polls: PollsAdapter = this.shares;
  readonly location: LocationAdapter = this.shares;
  readonly spaces: SpacesAdapter = this.spacesIn;
  readonly history: HistoryAdapter = this.fromOutside;

  /**
   * When a message was said, never twice the same.
   *
   * Real messages are stamped by a homeserver's clock, and two of them landing in the same millisecond makes
   * the order of a conversation a matter of luck. A double that stamps everything alike turns that from rare
   * into always, so this one moves on whether the clock has or not.
   */
  private lastStamp = 0;
  private stamp(): number {
    this.lastStamp = Math.max(Date.now(), this.lastStamp + 1);
    return this.lastStamp;
  }

  /** Test helper: the person clicked the link in the message the homeserver sent to their address. */
  proveAddress(proofId: string): void {
    this.accountIn.prove(proofId);
  }

  /** Test helper: the password this account is signed in with, which changing it has to have changed. */
  passwordNow(): string {
    return this.currentPassword;
  }

  /** Test helper: the homeserver handing out a new access token before the old one runs out. */
  refreshTheSession(session: Session): void {
    this.handlers.onSessionRefreshed?.(session);
  }

  readonly media: MediaAdapter = this;
  /** Registrations live with the people; what is waiting and how loud lives here. */
  readonly push: PushAdapter = {
    registerPush: (registration: PushRegistration) => this.people.registerPush(registration),
    listPushRegistrations: () => this.people.listPushRegistrations(),
    unregisterPush: (deviceToken: string) => this.people.unregisterPush(deviceToken),
    watchForKeyword: (word: string) => this.people.watchForKeyword(word),
    stopWatchingForKeyword: (word: string) => this.people.stopWatchingForKeyword(word),
    listKeywords: () => this.people.listKeywords(),
    listPendingNotifications: (limit: number) => this.listPendingNotifications(limit),
    getNotificationLevel: () => this.getNotificationLevel(),
    setNotificationLevel: (level: NotificationLevel) => this.setNotificationLevel(level)
  };
  readonly devices: DevicesAdapter = this.people;
  readonly reactions: ReactionsAdapter = this;
  readonly crypto: CryptoAdapter = this.cryptography;

  /** Test helper: somebody else starts a call in this conversation, which rings here to be joined. */
  startConferenceAs(conversationId: ConversationId, userId: UserId): Call {
    return this.callsGoingOn.startAs(conversationId, userId);
  }

  /** Test helper: the last of them leaves, and a call nobody is on is not going on any more. */
  endConference(callId: string): void {
    this.callsGoingOn.end(callId);
  }

  /** Test helper: somebody else walks into a call that is already going on. */
  joinCallAs(callId: string, userId: UserId): void {
    this.callsGoingOn.joinAs(callId, userId);
  }

  /** Test helper: whether a call is still going on at all, which is not this side being on it. */
  callIsGoingOn(callId: string): boolean {
    return this.callsGoingOn.isGoingOn(callId);
  }

  /** Test helper: somebody else starts sharing, and one screen at a time means whoever was sharing stops. */
  shareScreenAs(callId: string, _userId: UserId): void {
    this.callsGoingOn.shareScreenAs(callId);
  }

  /** Test helper: somebody starts talking, which is told apart from the call changing. */
  startSpeaking(callId: string, userIds: readonly UserId[]): void {
    this.callsGoingOn.startSpeaking(callId, userIds);
  }

  /** With no homeserver to ask, this double knows about one link and no others. */
  /** A double takes what fits in a browser's memory; the number is here so a test has one to reason about. */
  /** A double sends instantly, so there is never one on its way to stop. */
  async stopSendingFile(): Promise<boolean> {
    return false;
  }

  async mediaLimits(): Promise<MediaLimits> {
    return { maxUploadBytes: 100 * 1024 * 1024 };
  }

  async previewLink(url: string): Promise<LinkPreview> {
    if (url === "https://ejemplo.test/articulo") {
      return { url, title: "Un articulo de ejemplo", description: "De lo que va el articulo" };
    }
    return { url };
  }

  async downloadAttachment(media: MediaRef): Promise<Uint8Array> {
    const data = this.attachments.get(media.source);
    if (!data) {
      throw new Error("The attachment does not exist");
    }
    return new Uint8Array(data);
  }

  private appendMessage(message: Message): Message {
    this.messages.push(message);
    const conversation = this.findConversation(message.conversationId);
    if (conversation) this.replaceConversation({ ...conversation, lastMessage: message });
    this.handlers.onMessageReceived?.(message);
    return message;
  }

  private requireMessage(conversationId: ConversationId, messageId: MessageId): Message {
    const message = this.messages.find(
      item => item.id === messageId && item.conversationId === conversationId
    );
    if (!message) {
      throw new Error("The message does not exist");
    }
    return message;
  }

  private replaceMessage(previous: Message, next: Message): Message {
    this.messages[this.messages.indexOf(previous)] = next;
    this.handlers.onMessageUpdated?.(next);
    return next;
  }

  async editMessage(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message> {
    const message = this.requireMessage(conversationId, messageId);
    return this.replaceMessage(message, { ...message, body, editedAt: Date.now() });
  }

  async deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message> {
    const message = this.requireMessage(conversationId, messageId);
    return this.replaceMessage(message, { ...message, body: "", deletedAt: Date.now() });
  }

  /** Test helper: simulates being invited to a conversation by someone else. */
  receiveInvitation(fromUserId: UserId, options: { readonly direct?: boolean } = {}): Conversation {
    const conversation: Conversation = {
      id: `memory-conversation-${this.nextConversationId++}`,
      participantIds: [fromUserId],
      membership: "invite",
      ...(options.direct === false ? {} : { isDirect: true })
    };
    this.conversations.push(conversation);
    this.handlers.onConversationUpdated?.(conversation);
    return conversation;
  }

  /** Test helper: simulates the connection changing, as sync would report it. */
  simulateConnection(status: ConnectionStatus): void {
    this.handlers.onConnectionChanged?.(status);
  }

  /** Test helper: simulates another participant reading a message. */
  receiveReadReceipt(conversationId: ConversationId, messageId: MessageId, userId: UserId): ReadReceipt {
    const receipt: ReadReceipt = { conversationId, messageId, userId, readAt: Date.now() };
    this.readBy.push(receipt);
    this.handlers.onReceiptReceived?.(receipt);
    return receipt;
  }

  async getReadReceipts(
    conversationId: ConversationId,
    messageId: MessageId
  ): Promise<readonly ReadReceipt[]> {
    return this.readBy.filter(
      receipt => receipt.conversationId === conversationId && receipt.messageId === messageId
    );
  }

  async markMessageRead(
    conversationId: ConversationId,
    messageId: MessageId,
    options: MarkReadOptions = {}
  ): Promise<void> {
    // Reading inside a thread says nothing about the conversation it hangs from.
    if (options.threadId) {
      this.threadReads.set(`${conversationId}/${options.threadId}`, messageId);
      return;
    }
    this.unreadCounts.set(conversationId, 0);
    const conversation = this.findConversation(conversationId);
    // Where the person left off is remembered, not only that the counter went back to zero.
    if (conversation) {
      this.replaceConversation({ ...conversation, lastReadMessageId: messageId, unreadCount: 0 });
    }
    return this.features.markMessageRead(conversationId, messageId);
  }

  /** Grouped from what is held, which is the same answer a homeserver gives from what it holds. */
  async listThreads(conversationId: ConversationId): Promise<readonly ThreadSummary[]> {
    const byRoot = new Map<MessageId, Message[]>();
    for (const message of this.messages) {
      // Held in its own name rather than asked for twice: that is what lets this be known to be a thread
      // answer from here on, instead of being asserted to be one at each mention.
      const root = message.threadId;
      if (root === undefined || message.conversationId !== conversationId) continue;
      const answers = byRoot.get(root) ?? [];
      answers.push(message);
      byRoot.set(root, answers);
    }
    return [...byRoot].map(([rootId, answers]) => {
      // Held in its own name: asking for it twice makes the compiler forget the first answer said it was
      // there, and then it has to be told again.
      const last = answers.at(-1);
      const lastRead = this.threadReads.get(`${conversationId}/${rootId}`);
      const readAt = answers.findIndex(answer => answer.id === lastRead);
      return {
        conversationId,
        rootId,
        replyCount: answers.length,
        ...(last ? { lastMessage: last } : {}),
        ...(lastRead ? { lastReadMessageId: lastRead } : {}),
        unreadCount: readAt === -1 ? answers.length : answers.length - readAt - 1
      };
    });
  }

  /** Silencing somebody is not ignoring them: what they say still arrives, it just does not interrupt. */
  async listMutedUsers(): Promise<readonly UserId[]> {
    return [...this.mutedUsers];
  }

  async setUserMuted(userId: UserId, muted: boolean): Promise<void> {
    if (muted) this.mutedUsers.add(userId);
    else this.mutedUsers.delete(userId);
  }

  async getNotificationLevel(): Promise<NotificationLevel> {
    return this.notificationLevel;
  }

  async setNotificationLevel(level: NotificationLevel): Promise<void> {
    this.notificationLevel = level;
  }

  async setConversationUnread(conversationId: ConversationId, unread: boolean): Promise<Conversation> {
    const { isUnread: _was, ...conversation } = this.requireConversation(conversationId);
    return this.replaceConversation(
      unread ? { ...conversation, isUnread: true } : { ...conversation, isUnread: false }
    );
  }

  /** No homeserver holding anything, so what is waiting is what has arrived and has not been read. */
  async listPendingNotifications(limit: number): Promise<readonly Notification[]> {
    const waiting = [];
    for (const conversation of this.conversations) {
      if (waiting.length >= limit) break;
      const unread = this.unreadCounts.get(conversation.id) ?? 0;
      const last = conversation.lastMessage;
      if (unread === 0 || !last) continue;
      waiting.push({
        conversationId: conversation.id,
        messageId: last.id,
        senderId: last.senderId,
        body: last.body,
        isMention: last.mentions?.userIds?.includes(this.requireUserId()) ?? false
      });
    }
    return waiting;
  }

  async addReaction(conversationId: ConversationId, messageId: MessageId, key: string): Promise<Reaction> {
    return this.features.addReaction(messageId, key);
  }

  async removeReaction(_conversationId: ConversationId, reactionId: string): Promise<void> {
    await this.features.removeReaction(reactionId);
  }

  /** Test helper: makes this account one that cannot verify with a code. */
  disableQrCodes(): void {
    this.verification.disableQrCodes();
  }

  /** Test helper: simulates another device asking this one to verify. */
  receiveVerificationRequest(userId: string, deviceId?: string): VerificationSession {
    return this.verification.receive(userId, deviceId);
  }
}
