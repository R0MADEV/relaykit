import type {
  AdapterHandlers,
  MessagingAdapter,
  MarkReadOptions,
  Notification,
  ThreadSummary,
  LinkPreview,
  Poll,
  StartPollInput,
  LiveLocation,
  ShareLocationInput,
  GeoLocation
} from "@relaykit/core";
import type {
  Attachment,
  ConnectionStatus,
  AvatarImage,
  ConversationPermissions,
  ConversationRole,
  CreateSpaceInput,
  NotificationLevel,
  SendContent,
  Space,
  Device,
  MediaRef,
  ReadReceipt,
  ThumbnailInput,
  FileInput,
  MessagePage,
  User,
  Conversation,
  ConversationId,
  CreateConversationInput,
  MessageId,
  PublicConversation,
  PushRegistration,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  Reaction,
  DeviceVerification,
  CryptoStatus,
  PresenceUpdate,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  LoginCredentials,
  RegisterCredentials,
  RecoverySetup,
  Message,
  Session,
  UserId,
  VerificationRequestOptions,
  VerificationSession
} from "@relaykit/core";
import { SdkError } from "@relaykit/core";
import { InMemoryFeatures } from "./in-memory-features.js";
import { InMemoryVerification } from "./in-memory-verification.js";

export interface InMemoryAdapterOptions {
  readonly conversations?: readonly Conversation[];
  readonly messages?: readonly Message[];
}

export class InMemoryAdapter implements MessagingAdapter {
  private readonly conversations: Conversation[];
  private readonly messages: Message[];
  private handlers: AdapterHandlers = {};
  private currentUserId: UserId | undefined;
  private currentDeviceId: string | undefined;
  private nextMessageId = 1;
  private nextConversationId = 1;
  private nextAttachmentId = 1;
  private readonly unreadCounts = new Map<ConversationId, number>();
  private readonly profiles = new Map<UserId, { displayName?: string; avatar?: AvatarImage }>();
  private readonly pushRegistrations = new Map<string, PushRegistration>();
  private readonly knocks = new Map<ConversationId, { userId: UserId; reason?: string }[]>();
  private readonly reported: { conversationId: ConversationId; messageId: MessageId; reason: string }[] = [];
  private readonly published = new Set<ConversationId>();
  private readonly keywords = new Set<string>();
  private readonly conversationNames = new Map<string, string>();
  private readonly rotatedKeys: ConversationId[] = [];

  private readonly receipts: ReadReceipt[] = [];
  private readonly attachments = new Map<string, Uint8Array>();
  private readonly features = new InMemoryFeatures(() => this.currentUserId, () => this.handlers);
  private readonly verification = new InMemoryVerification(() => this.handlers);

  constructor(options: InMemoryAdapterOptions = {}) {
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
      createdAt: Date.now(),
      status: "sent",
      ...overrides
    };
    if (this.ignoredUsers.includes(senderId)) return message;
    this.unreadCounts.set(conversationId, (this.unreadCounts.get(conversationId) ?? 0) + 1);
    const appended = this.appendMessage(message);
    const ownUserId = this.currentUserId;
    const level = this.conversations.find(item => item.id === conversationId)?.notifications;
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
      // Lo que la conversacion es, no lo que se pidio. Sin homeserver que tenga politica propia, aqui solo
      // esta cifrada quien lo pidio, pero se dice siempre para que nadie tenga que suponerlo.
      isEncrypted: input.encrypted === true,
      ...(input.title ? { title: input.title } : {}),
      ...(input.direct ? { isDirect: true } : {})
    };
    this.conversations.push(conversation);
    this.handlers.onConversationUpdated?.(conversation);
    return conversation;
  }

  async joinConversation(conversationId: ConversationId, _via: readonly string[] = []): Promise<Conversation> {
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (!conversation) {
      throw new Error("The conversation does not exist");
    }
    const joinedConversation: Conversation = { ...conversation, membership: "join" };
    const index = this.conversations.indexOf(conversation);
    this.conversations[index] = joinedConversation;
    return joinedConversation;
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
    const invitedIds = [...new Set([...conversation.invitedIds ?? [], userId])];
    // Letting somebody in answers the knock, so they stop waiting at the door.
    const knockingIds = (conversation.knockingIds ?? []).filter(waiting => waiting !== userId);
    return this.replaceConversation({ ...conversation, participantIds, invitedIds, knockingIds });
  }

  async rotateConversationKeys(conversationId: ConversationId): Promise<void> {
    this.requireConversation(conversationId);
    this.rotatedKeys.push(conversationId);
  }

  /** Test helper: the conversations whose key was thrown away. */
  rotatedKeysOf(): readonly ConversationId[] {
    return this.rotatedKeys;
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
    return this.conversations
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
      }));
  }

  async reportMessage(conversationId: ConversationId, messageId: MessageId, reason: string): Promise<void> {
    this.reported.push({ conversationId, messageId, reason });
  }

  /** Test helper: what has been reported to whoever runs the server. */
  reports(): readonly { conversationId: ConversationId; messageId: MessageId; reason: string }[] {
    return this.reported;
  }

  async setJoinRule(conversationId: ConversationId, rule: JoinRule): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), joinRule: rule });
  }

  async setHistoryVisibility(conversationId: ConversationId, visibility: HistoryVisibility): Promise<Conversation> {
    return this.replaceConversation({
      ...this.requireConversation(conversationId),
      historyVisibility: visibility
    });
  }

  async knockConversation(conversationId: ConversationId, options: KnockOptions): Promise<void> {
    const waiting = this.knocks.get(conversationId) ?? [];
    this.knocks.set(conversationId, [
      ...waiting,
      { userId: this.requireUserId(), ...(options.reason ? { reason: options.reason } : {}) }
    ]);
  }

  /** Test helper: who has asked to come in to a conversation and is still waiting. */
  knocksOn(conversationId: ConversationId): readonly { userId: UserId; reason?: string }[] {
    return this.knocks.get(conversationId) ?? [];
  }

  /** Test helper: simulates somebody knocking at a conversation this account is in. */
  receiveKnock(conversationId: ConversationId, userId: UserId): Conversation {
    const conversation = this.requireConversation(conversationId);
    const knockingIds = [...new Set([...conversation.knockingIds ?? [], userId])];
    return this.replaceConversation({ ...conversation, knockingIds });
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

  private requireConversation(conversationId: ConversationId): Conversation {
    const conversation = this.conversations.find(item => item.id === conversationId);
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

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    // What hangs from a thread lives in the thread, not in the middle of the conversation.
    return this.messages.filter(message => message.conversationId === conversationId && message.threadId === undefined);
  }

  private readonly pinned = new Map<ConversationId, Set<MessageId>>();

  async setConversationTopic(conversationId: ConversationId, topic: string): Promise<Conversation> {
    return this.replaceConversation({ ...this.requireConversation(conversationId), topic });
  }

  async setConversationAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation> {
    const id = `memory-attachment-${this.nextAttachmentId++}`;
    this.attachments.set(id, new Uint8Array(image.data));
    const avatar: MediaRef = { mimeType: image.mimeType, size: image.data.byteLength, source: id };
    return this.replaceConversation({ ...this.requireConversation(conversationId), avatar });
  }

  async setConversationNotifications(conversationId: ConversationId, level: NotificationLevel): Promise<Conversation> {
    const { notifications: _previous, ...conversation } = this.requireConversation(conversationId);
    return this.replaceConversation(level === "all" ? conversation : { ...conversation, notifications: level });
  }

  async pinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    const pinned = this.pinned.get(conversationId) ?? new Set<MessageId>();
    pinned.add(messageId);
    this.pinned.set(conversationId, pinned);
    this.tellAboutPinned(conversationId);
  }

  /** What is pinned travels with the conversation, so it is still known with no homeserver to ask. */
  private tellAboutPinned(conversationId: ConversationId): void {
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (!conversation) return;
    this.replaceConversation({ ...conversation, pinnedIds: [...this.pinned.get(conversationId) ?? []] });
  }

  async unpinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    this.pinned.get(conversationId)?.delete(messageId);
    this.tellAboutPinned(conversationId);
  }

  async listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    const pinned = this.pinned.get(conversationId) ?? new Set<MessageId>();
    return this.messages.filter(message => pinned.has(message.id));
  }

  private readonly spaces: Space[] = [];
  private readonly spaceChildren = new Map<ConversationId, Set<ConversationId>>();

  async listSpaces(): Promise<readonly Space[]> {
    return this.spaces;
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const space: Space = { id: `memory-space-${this.nextConversationId++}`, title: input.title };
    this.spaces.push(space);
    return space;
  }

  async addToSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    const children = this.spaceChildren.get(spaceId) ?? new Set<ConversationId>();
    children.add(conversationId);
    this.spaceChildren.set(spaceId, children);
  }

  async removeFromSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    this.spaceChildren.get(spaceId)?.delete(conversationId);
  }

  async listSpaceConversations(spaceId: ConversationId): Promise<readonly Conversation[]> {
    const children = this.spaceChildren.get(spaceId) ?? new Set<ConversationId>();
    return this.conversations.filter(conversation => children.has(conversation.id));
  }

  async searchMessages(query: string): Promise<readonly Message[]> {
    const needle = query.toLowerCase();
    return this.messages.filter(message => message.body.toLowerCase().includes(needle));
  }

  async listThread(conversationId: ConversationId, rootId: MessageId): Promise<readonly Message[]> {
    return this.messages.filter(message => message.conversationId === conversationId && message.threadId === rootId);
  }

  /** Test helper: sets what somebody is allowed to do in a conversation. */
  setPowerLevel(conversationId: ConversationId, userId: UserId, level: number): void {
    this.powerLevels.set(`${conversationId}:${userId}`, level);
  }

  powerLevelOf(conversationId: ConversationId, userId: UserId): number {
    return this.powerLevels.get(`${conversationId}:${userId}`) ?? 0;
  }

  async getPermissions(conversationId: ConversationId): Promise<ConversationPermissions> {
    const level = this.powerLevels.get(`${conversationId}:${this.requireUserId()}`) ?? 100;
    return {
      canSend: level >= 0,
      canInvite: level >= 50,
      canRemove: level >= 50,
      canBan: level >= 50,
      canRename: level >= 50
    };
  }

  async setRole(conversationId: ConversationId, userId: UserId, role: ConversationRole): Promise<void> {
    const levels = { member: 0, moderator: 50, admin: 100 };
    this.setPowerLevel(conversationId, userId, levels[role]);
  }

  async loadMoreMessages(conversationId: ConversationId, _limit: number): Promise<MessagePage> {
    // There is no remote history behind this adapter, so the local timeline is always complete.
    return { messages: await this.listMessages(conversationId), hasMore: false };
  }

  async sendMessage(conversationId: ConversationId, body: string, options: SendContent = {}): Promise<Message> {
    const { transactionId, replyToId, threadId, formattedBody, mentions, kind, location } = options;
    const senderId = this.currentUserId;
    if (!senderId) {
      throw new Error("The in-memory adapter is not started");
    }
    const alreadySent = transactionId ? this.messages.find(item => item.transactionId === transactionId) : undefined;
    if (alreadySent) {
      return alreadySent;
    }

    return this.appendMessage({
      id: `memory-message-${this.nextMessageId++}`,
      conversationId,
      senderId,
      body,
      createdAt: Date.now(),
      status: "sent",
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
    const senderId = this.currentUserId;
    if (!senderId) {
      throw new Error("The in-memory adapter is not started");
    }
    const alreadySent = transactionId ? this.messages.find(item => item.transactionId === transactionId) : undefined;
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
      createdAt: Date.now(),
      status: "sent",
      attachment,
      // Una pegatina se pinta sola, asi que quien la recibe tiene que poder distinguirla de un adjunto.
      ...(file.sticker ? { kind: "sticker" as const } : {}),
      ...(transactionId ? { transactionId } : {})
    });
  }

  /** Test helper: gives a user a display name and an avatar. */
  setProfile(userId: UserId, profile: { displayName?: string; avatar?: AvatarImage }): void {
    this.profiles.set(userId, profile);
  }

  /** Test helper: the name somebody uses in one conversation, which can differ from the one they use elsewhere. */
  setConversationName(conversationId: ConversationId, userId: UserId, displayName: string): void {
    this.conversationNames.set(`${conversationId}/${userId}`, displayName);
  }

  private readonly devices = new Map<string, Device>();
  private ignoredUsers: readonly UserId[] = [];
  /** Silenced, not ignored: what they say still arrives, it just does not interrupt. */
  private readonly mutedUsers = new Set<UserId>();
  private readonly polls = new Map<MessageId, Poll>();
  private readonly liveLocations = new Map<string, LiveLocation>();
  private readonly pollVotes = new Map<MessageId, Map<UserId, string>>();
  /** How far each thread was read, kept apart from how far its conversation was. */
  private readonly threadReads = new Map<string, MessageId>();
  private notificationLevel: NotificationLevel = "all";
  private readonly powerLevels = new Map<string, number>();

  async removeFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    const conversation = this.requireConversation(conversationId);
    return this.replaceConversation({
      ...conversation,
      participantIds: conversation.participantIds.filter(participant => participant !== userId),
      invitedIds: (conversation.invitedIds ?? []).filter(invited => invited !== userId)
    });
  }

  async banFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation> {
    return this.removeFromConversation(conversationId, userId);
  }

  async unbanFromConversation(conversationId: ConversationId, _userId: UserId): Promise<Conversation> {
    // Lifting a ban only allows somebody back in; it does not put them back.
    return this.requireConversation(conversationId);
  }

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
  addDevice(deviceId: string, displayName?: string): void {
    this.devices.set(deviceId, { id: deviceId, isCurrent: false, ...(displayName ? { displayName } : {}) });
  }

  async setDisplayName(displayName: string): Promise<void> {
    const userId = this.requireUserId();
    this.profiles.set(userId, { ...this.profiles.get(userId), displayName });
  }

  async setAvatar(image: AvatarImage): Promise<void> {
    const userId = this.requireUserId();
    this.profiles.set(userId, { ...this.profiles.get(userId), avatar: image });
  }

  async watchForKeyword(word: string): Promise<void> {
    this.keywords.add(word);
  }

  async stopWatchingForKeyword(word: string): Promise<void> {
    this.keywords.delete(word);
  }

  async listKeywords(): Promise<readonly string[]> {
    return [...this.keywords];
  }

  async registerPush(registration: PushRegistration): Promise<void> {
    // The device token is what the gateway uses to find the device, so registering again replaces the old entry.
    this.pushRegistrations.set(registration.deviceToken, registration);
  }

  async listPushRegistrations(): Promise<readonly PushRegistration[]> {
    return [...this.pushRegistrations.values()];
  }

  async unregisterPush(deviceToken: string): Promise<void> {
    this.pushRegistrations.delete(deviceToken);
  }

  async listDevices(): Promise<readonly Device[]> {
    const current = this.currentDeviceId;
    const own: Device[] = current ? [{ id: current, isCurrent: true }] : [];
    return [...own, ...this.devices.values()];
  }

  async renameDevice(deviceId: string, displayName: string): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) this.devices.set(deviceId, { ...device, displayName });
  }

  async signOutDevices(deviceIds: readonly string[]): Promise<void> {
    for (const deviceId of deviceIds) this.devices.delete(deviceId);
  }

  private requireUserId(): UserId {
    if (!this.currentUserId) throw new Error("The in-memory adapter is not started");
    return this.currentUserId;
  }

  async getProfile(userId: UserId, conversationId?: ConversationId): Promise<User> {
    const profile = this.profiles.get(userId);
    const inConversation = conversationId ? this.conversationNames.get(`${conversationId}/${userId}`) : undefined;
    const displayName = inConversation ?? profile?.displayName;
    return {
      id: userId,
      ...(displayName ? { displayName } : {}),
      ...(profile?.avatar ? { avatarId: `memory-avatar-${userId}` } : {})
    };
  }

  async getAvatar(userId: UserId, _conversationId?: ConversationId, _size?: number): Promise<AvatarImage | undefined> {
    return this.profiles.get(userId)?.avatar;
  }

  /**
   * A homeserver's directory knows the people it has seen, which for this account means everybody it shares a
   * conversation with, plus anybody it has been told about. The double knows the same two things.
   */
  async searchUsers(query: string, limit: number): Promise<readonly User[]> {
    const wanted = query.toLowerCase();
    const everybody = new Set([
      ...this.profiles.keys(),
      ...this.conversations.flatMap(conversation => conversation.participantIds)
    ]);
    const found = [];
    for (const userId of everybody) {
      if (found.length >= limit) break;
      const profile = await this.getProfile(userId);
      const goesBy = profile.displayName?.toLowerCase() ?? "";
      const isWhoTheyMean = userId.toLowerCase().includes(wanted) || goesBy.includes(wanted);
      if (isWhoTheyMean) found.push(profile);
    }
    return found;
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

  async startLiveLocation(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation> {
    const id = `memory-location-${this.nextMessageId++}`;
    const sharing: LiveLocation = {
      id,
      conversationId,
      sharedBy: this.requireUserId(),
      isLive: true,
      startedAt: Date.now(),
      durationMs: input.durationMs,
      ...(input.description ? { description: input.description } : {})
    };
    this.liveLocations.set(id, sharing);
    return sharing;
  }

  async updateLiveLocation(sharingId: string, position: GeoLocation): Promise<void> {
    const sharing = this.liveLocations.get(sharingId);
    if (!sharing) throw new Error("That sharing does not exist");
    // Parada o caducada no admite mas: lo contrario seria seguir contando donde esta alguien que dijo basta.
    if (!sharing.isLive) throw new SdkError("INVALID_INPUT", "That sharing is no longer live");
    this.liveLocations.set(sharingId, { ...sharing, lastPosition: position });
  }

  async stopLiveLocation(sharingId: string): Promise<void> {
    const sharing = this.liveLocations.get(sharingId);
    if (!sharing) throw new Error("That sharing does not exist");
    this.liveLocations.set(sharingId, { ...sharing, isLive: false });
  }

  async listLiveLocations(conversationId: ConversationId): Promise<readonly LiveLocation[]> {
    return [...this.liveLocations.values()].filter(sharing => sharing.conversationId === conversationId);
  }

  async startPoll(conversationId: ConversationId, input: StartPollInput): Promise<Poll> {
    const id = `memory-poll-${this.nextMessageId++}`;
    const poll: Poll = {
      id,
      conversationId,
      question: input.question,
      answers: input.answers.map((text, index) => ({ id: `${id}-${index}`, text, votes: 0 })),
      startedBy: this.requireUserId(),
      startedAt: Date.now(),
      isClosed: false
    };
    this.polls.set(id, poll);
    return poll;
  }

  /** Cambiar de idea sustituye el voto anterior, que es lo que dice el protocolo: solo cuenta el ultimo. */
  async voteInPoll(_conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void> {
    const poll = this.polls.get(pollId);
    if (!poll) throw new Error("The poll does not exist");
    const votes = this.pollVotes.get(pollId) ?? new Map<UserId, string>();
    votes.set(this.requireUserId(), answerId);
    this.pollVotes.set(pollId, votes);
    this.polls.set(pollId, this.withVotes(poll, votes));
  }

  async closePoll(_conversationId: ConversationId, pollId: MessageId): Promise<void> {
    const poll = this.polls.get(pollId);
    if (!poll) throw new Error("The poll does not exist");
    this.polls.set(pollId, { ...poll, isClosed: true });
  }

  async listPolls(conversationId: ConversationId): Promise<readonly Poll[]> {
    return [...this.polls.values()].filter(poll => poll.conversationId === conversationId);
  }

  private withVotes(poll: Poll, votes: Map<UserId, string>): Poll {
    const chosen = [...votes.values()];
    return {
      ...poll,
      answers: poll.answers.map(answer => ({
        ...answer,
        votes: chosen.filter(answerId => answerId === answer.id).length
      })),
      ...(votes.get(this.requireUserId()) ? { ownAnswerId: votes.get(this.requireUserId()) as string } : {})
    };
  }

  /** Sin homeserver al que preguntar, este doble sabe de un enlace y de ninguno mas. */
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
    const conversation = this.conversations.find(item => item.id === message.conversationId);
    if (conversation) {
      const updatedConversation: Conversation = { ...conversation, lastMessage: message };
      const index = this.conversations.indexOf(conversation);
      this.conversations[index] = updatedConversation;
      this.handlers.onConversationUpdated?.({
        ...updatedConversation,
        unreadCount: this.unreadCounts.get(message.conversationId) ?? 0
      });
    }
    this.handlers.onMessageReceived?.(message);
    return message;
  }

  async editMessage(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message> {
    const message = this.messages.find(item => item.id === messageId && item.conversationId === conversationId);
    if (!message) {
      throw new Error("The message does not exist");
    }

    const updatedMessage: Message = { ...message, body, editedAt: Date.now() };
    const index = this.messages.indexOf(message);
    this.messages[index] = updatedMessage;
    this.handlers.onMessageUpdated?.(updatedMessage);
    return updatedMessage;
  }

  async deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message> {
    const message = this.messages.find(item => item.id === messageId && item.conversationId === conversationId);
    if (!message) {
      throw new Error("The message does not exist");
    }

    const deletedMessage: Message = { ...message, body: "", deletedAt: Date.now() };
    const index = this.messages.indexOf(message);
    this.messages[index] = deletedMessage;
    this.handlers.onMessageUpdated?.(deletedMessage);
    return deletedMessage;
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
    this.receipts.push(receipt);
    this.handlers.onReceiptReceived?.(receipt);
    return receipt;
  }

  async getReadReceipts(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]> {
    return this.receipts.filter(receipt => receipt.conversationId === conversationId && receipt.messageId === messageId);
  }

  async markMessageRead(conversationId: ConversationId, messageId: MessageId, options: MarkReadOptions = {}): Promise<void> {
    // Reading inside a thread says nothing about the conversation it hangs from.
    if (options.threadId) {
      this.threadReads.set(`${conversationId}/${options.threadId}`, messageId);
      return;
    }
    this.unreadCounts.set(conversationId, 0);
    const conversation = this.conversations.find(item => item.id === conversationId);
    // Where the person left off is remembered, not only that the counter went back to zero.
    if (conversation) {
      const updated = this.replaceConversation({ ...conversation, lastReadMessageId: messageId, unreadCount: 0 });
      this.handlers.onConversationUpdated?.(updated);
    }
    return this.features.markMessageRead(conversationId, messageId);
  }

  /** Grouped from what is held, which is the same answer a homeserver gives from what it holds. */
  async listThreads(conversationId: ConversationId): Promise<readonly ThreadSummary[]> {
    const byRoot = new Map<MessageId, Message[]>();
    for (const message of this.messages) {
      const belongsHere = message.conversationId === conversationId && message.threadId !== undefined;
      if (!belongsHere) continue;
      const answers = byRoot.get(message.threadId as MessageId) ?? [];
      answers.push(message);
      byRoot.set(message.threadId as MessageId, answers);
    }
    return [...byRoot].map(([rootId, answers]) => {
      const lastRead = this.threadReads.get(`${conversationId}/${rootId}`);
      const readAt = answers.findIndex(answer => answer.id === lastRead);
      return {
        conversationId,
        rootId,
        replyCount: answers.length,
        ...(answers.at(-1) ? { lastMessage: answers.at(-1) as Message } : {}),
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
    return this.replaceConversation(unread ? { ...conversation, isUnread: true } : { ...conversation, isUnread: false });
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

  async getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification> {
    return this.features.getDeviceVerification(userId, deviceId);
  }

  async setDeviceVerified(): Promise<void> {
    return this.features.setDeviceVerified();
  }

  async getCryptoStatus(): Promise<CryptoStatus> {
    return this.features.getCryptoStatus();
  }

  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    return this.features.getKeyBackupStatus();
  }

  async setupRecovery(): Promise<RecoverySetup> {
    return this.features.setupRecovery();
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    return this.features.recover(recoveryKey);
  }

  async requestVerification(
    userId: string,
    deviceId?: string,
    options?: VerificationRequestOptions
  ): Promise<VerificationSession> {
    return this.verification.request(userId, deviceId, options);
  }

  async getVerificationQrCode(sessionId: string): Promise<Uint8Array | undefined> {
    return this.verification.qrCode(sessionId);
  }

  async scanVerificationQrCode(sessionId: string, code: Uint8Array): Promise<VerificationSession> {
    return this.verification.scan(sessionId, code);
  }

  /** Test helper: makes this account one that cannot verify with a code. */
  disableQrCodes(): void {
    this.verification.disableQrCodes();
  }

  async acceptVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.accept(sessionId);
  }

  async cancelVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.cancel(sessionId);
  }

  async confirmVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.confirm(sessionId);
  }

  async rejectVerification(sessionId: string): Promise<VerificationSession> {
    return this.verification.reject(sessionId);
  }

  /** Test helper: simulates another device asking this one to verify. */
  receiveVerificationRequest(userId: string, deviceId?: string): VerificationSession {
    return this.verification.receive(userId, deviceId);
  }
}
