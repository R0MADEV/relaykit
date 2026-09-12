import { EventBus, type ClientEventMap, type EventListener, type EventName } from "./events.js";
import { ClientLifecycle, type StartOptions } from "./client-lifecycle.js";
import { PendingActions } from "./pending-actions.js";
import { ConversationOperations } from "./conversation-operations.js";
import { CryptoOperations } from "./crypto-operations.js";
import { DeviceOperations } from "./device-operations.js";
import { MessageMutations } from "./message-mutations.js";
import { MessageOperations, type MessageOperationsContext } from "./message-operations.js";
import { PresenceOperations } from "./presence-operations.js";
import { VerificationOperations } from "./verification-operations.js";
import { MediaOperations } from "./media-operations.js";
import { UserOperations } from "./user-operations.js";
import { SpaceOperations } from "./space-operations.js";
import { ReactionOperations } from "./reaction-operations.js";
import { UnavailableAdapter } from "./unavailable-adapter.js";
import { forgivingStorage } from "./forgiving-storage.js";
import { PollOperations } from "./poll-operations.js";
import { LocationOperations } from "./location-operations.js";
import type { MessagingClientConfig } from "./client-config.js";
import type {
  AvatarImage,
  AvatarOptions,
  LinkPreview,
  LiveLocation,
  MarkReadOptions,
  ShareLocationInput,
  Poll,
  StartPollInput,
  Notification,
  ThreadSummary,
  PendingNotificationsOptions,
  SearchUsersOptions,
  Device,
  PushRegistration,
  JoinRule,
  HistoryVisibility,
  KnockOptions,
  PublicConversation,
  ListMessagesOptions,
  ListConversationsOptions,
  VerificationRequestOptions,
  GeoLocation,
  VoiceInfo,
  SignOutOptions,
  MediaRef,
  User,
  FileInput,
  SendFileOptions,
  SendMessageOptions,
  ConnectionStatus,
  Conversation,
  ConversationId,
  CreateConversationInput,
  JoinConversationOptions,
  LoginCredentials,
  RegisterCredentials,
  Message,
  MessageId,
  MessagePage,
  ConversationPermissions,
  ConversationRole,
  NotificationLevel,
  CreateSpaceInput,
  Space,
  MessageSearchOptions,
  ReadReceipt,
  PresenceUpdate,
  Reaction,
  Session,
  SyncStatus,
  RecoverySetupOptions
} from "./models.js";

/** Generous enough that a normal conversation never notices, small enough to stay out of the storage quota. */
const defaultCachedMessages = 500;
/** Enough that nothing recent is announced twice, few enough that a session left open does not keep growing. */
const defaultRememberedMessages = 10000;

export class MessagingClient {
  readonly conversations = {
    list: (options?: ListConversationsOptions): Promise<readonly Conversation[]> =>
      this.conversationOperations.list(options),
    create: (input: CreateConversationInput): Promise<Conversation> => this.conversationOperations.create(input),
    join: (conversationId: ConversationId, options?: JoinConversationOptions): Promise<Conversation> =>
      this.conversationOperations.join(conversationId, options),
    open: (userId: string): Promise<Conversation> => this.conversationOperations.open(userId),
    leave: (conversationId: ConversationId): Promise<void> => this.conversationOperations.leave(conversationId),
    invite: (conversationId: ConversationId, userId: string): Promise<Conversation> =>
      this.conversationOperations.invite(conversationId, userId),
    rename: (conversationId: ConversationId, title: string): Promise<Conversation> =>
      this.conversationOperations.rename(conversationId, title),
    remove: (conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation> =>
      this.conversationOperations.remove(conversationId, userId, reason),
    ban: (conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation> =>
      this.conversationOperations.ban(conversationId, userId, reason),
    unban: (conversationId: ConversationId, userId: string): Promise<Conversation> =>
      this.conversationOperations.unban(conversationId, userId),
    setUnread: (conversationId: ConversationId, unread: boolean): Promise<Conversation> =>
      this.conversationOperations.setUnread(conversationId, unread),
    setFavourite: (conversationId: ConversationId, favourite: boolean): Promise<Conversation> =>
      this.conversationOperations.setFavourite(conversationId, favourite),
    setTopic: (conversationId: ConversationId, topic: string): Promise<Conversation> =>
      this.conversationOperations.setTopic(conversationId, topic),
    setAvatar: (conversationId: ConversationId, image: AvatarImage): Promise<Conversation> =>
      this.conversationOperations.setAvatar(conversationId, image),
    setNotifications: (conversationId: ConversationId, level: NotificationLevel): Promise<Conversation> =>
      this.conversationOperations.setNotifications(conversationId, level),
    pin: (conversationId: ConversationId, messageId: MessageId): Promise<void> =>
      this.conversationOperations.pin(conversationId, messageId),
    unpin: (conversationId: ConversationId, messageId: MessageId): Promise<void> =>
      this.conversationOperations.unpin(conversationId, messageId),
    rotateKeys: (conversationId: ConversationId): Promise<void> =>
      this.conversationOperations.rotateKeys(conversationId),
    upgrade: (conversationId: ConversationId): Promise<Conversation> =>
      this.conversationOperations.upgrade(conversationId),
    current: (conversationId: ConversationId): Promise<Conversation> =>
      this.conversationOperations.current(conversationId),
    setAlias: (conversationId: ConversationId, alias: string): Promise<Conversation> =>
      this.conversationOperations.setAlias(conversationId, alias),
    publish: (conversationId: ConversationId, listed: boolean): Promise<void> =>
      this.conversationOperations.publish(conversationId, listed),
    discover: (query?: string): Promise<readonly PublicConversation[]> =>
      this.conversationOperations.discover(query),
    setJoinRule: (conversationId: ConversationId, rule: JoinRule): Promise<Conversation> =>
      this.conversationOperations.setJoinRule(conversationId, rule),
    setHistoryVisibility: (conversationId: ConversationId, visibility: HistoryVisibility): Promise<Conversation> =>
      this.conversationOperations.setHistoryVisibility(conversationId, visibility),
    knock: (conversationId: ConversationId, options?: KnockOptions): Promise<void> =>
      this.conversationOperations.knock(conversationId, options),
    saveDraft: async (conversationId: ConversationId, text: string): Promise<void> => {
      await this.conversationOperations.saveDraft(conversationId, text);
      // Something was written here, so the next message sent has a draft to clear.
      this.messageOperations.draftWritten(conversationId);
    },
    draft: (conversationId: ConversationId): Promise<string | undefined> =>
      this.conversationOperations.draft(conversationId),
    pinned: (conversationId: ConversationId): Promise<readonly Message[]> =>
      this.conversationOperations.pinned(conversationId),
    permissions: (conversationId: ConversationId): Promise<ConversationPermissions> =>
      this.conversationOperations.permissions(conversationId),
    setRole: (conversationId: ConversationId, userId: string, role: ConversationRole): Promise<void> =>
      this.conversationOperations.setRole(conversationId, userId, role),
    findDirect: (userId: string): Promise<Conversation | undefined> => this.conversationOperations.findDirect(userId),
    search: (query: string): Promise<readonly Conversation[]> => this.conversationOperations.search(query),
    typing: (conversationId: ConversationId, isTyping: boolean, timeoutMs = 5000): Promise<void> =>
      this.conversationOperations.typing(conversationId, isTyping, timeoutMs)
  };

  readonly messages = {
    list: (id: ConversationId, options?: ListMessagesOptions): Promise<readonly Message[]> =>
      this.messageOperations.listMessages(id, options),
    loadMore: (id: ConversationId, limit = 20): Promise<MessagePage> => this.messageOperations.loadMoreMessages(id, limit),
    search: (query: string, options?: MessageSearchOptions): Promise<readonly Message[]> => this.messageOperations.search(query, options),
    thread: (id: ConversationId, rootId: MessageId): Promise<readonly Message[]> => this.messageOperations.thread(id, rootId),
    threads: (id: ConversationId): Promise<readonly ThreadSummary[]> => this.messageOperations.threads(id),
    searchRemote: (query: string): Promise<readonly Message[]> => this.messageOperations.searchRemote(query),
    send: (id: ConversationId, body: string, options?: SendMessageOptions): Promise<Message> =>
      this.messageOperations.sendMessage(id, body, options),
    sendFile: (id: ConversationId, file: FileInput, options?: SendFileOptions): Promise<Message> =>
      this.messageOperations.sendFile(id, file, options),
    sendSticker: (id: ConversationId, sticker: FileInput): Promise<Message> =>
      this.messageOperations.sendSticker(id, sticker),
    sendLocation: (id: ConversationId, location: GeoLocation): Promise<Message> =>
      this.messageOperations.sendLocation(id, location),
    sendVoice: (id: ConversationId, file: FileInput, voice: VoiceInfo): Promise<Message> =>
      this.messageOperations.sendVoice(id, file, voice),
    report: (id: MessageId, reason: string): Promise<void> => this.messageOperations.report(id, reason),
    unreadSince: (id: ConversationId): Promise<readonly Message[]> =>
      this.messageOperations.unreadSince(id),
    forward: (id: MessageId, toConversationId: ConversationId): Promise<Message> =>
      this.messageOperations.forward(id, toConversationId),
    retry: (id: MessageId): Promise<Message> => this.messageOperations.retryMessage(id),
    cancel: (id: MessageId): Promise<Message> => this.messageOperations.cancelMessage(id),
    markRead: (conversationId: ConversationId, messageId: MessageId, options?: MarkReadOptions): Promise<void> =>
      this.messageOperations.markRead(conversationId, messageId, options),
    readBy: (conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]> =>
      this.messageOperations.readBy(conversationId, messageId),
    edit: (id: ConversationId, messageId: MessageId, body: string): Promise<Message> => this.messageMutations.edit(id, messageId, body),
    delete: (id: ConversationId, messageId: MessageId): Promise<Message> => this.messageMutations.delete(id, messageId)
  };

  readonly reactions = {
    add: (id: ConversationId, messageId: MessageId, key: string): Promise<Reaction> => this.reactionOperations.add(id, messageId, key),
    remove: (id: ConversationId, reactionId: string): Promise<void> => this.reactionOperations.remove(id, reactionId)
  };
  readonly devices = {
    verification: (userId: string, deviceId: string) => this.deviceOperations.verification(userId, deviceId),
    verify: (userId: string, deviceId: string) => this.deviceOperations.verify(userId, deviceId),
    revoke: (userId: string, deviceId: string) => this.deviceOperations.revoke(userId, deviceId),
    list: (): Promise<readonly Device[]> => this.deviceOperations.list(),
    rename: (deviceId: string, displayName: string): Promise<void> => this.deviceOperations.rename(deviceId, displayName),
    signOut: (deviceIds: readonly string[], options?: SignOutOptions): Promise<void> =>
      this.deviceOperations.signOut(deviceIds, options)
  };
  /** Being woken while the application is closed, which the homeserver does through a push gateway. */
  readonly push = {
    register: (registration: PushRegistration): Promise<void> => this.deviceOperations.registerPush(registration),
    registered: (): Promise<readonly PushRegistration[]> => this.deviceOperations.pushRegistrations(),
    unregister: (deviceToken: string): Promise<void> => this.deviceOperations.unregisterPush(deviceToken),
    watchFor: (word: string): Promise<void> => this.deviceOperations.watchFor(word),
    stopWatchingFor: (word: string): Promise<void> => this.deviceOperations.stopWatchingFor(word),
    keywords: (): Promise<readonly string[]> => this.deviceOperations.keywords(),
    pending: (options?: PendingNotificationsOptions): Promise<readonly Notification[]> =>
      this.deviceOperations.pending(options),
    muted: (): Promise<readonly string[]> => this.deviceOperations.muted(),
    mute: (userId: string): Promise<void> => this.deviceOperations.mute(userId),
    unmute: (userId: string): Promise<void> => this.deviceOperations.unmute(userId),
    level: (): Promise<NotificationLevel> => this.deviceOperations.level(),
    setLevel: (level: NotificationLevel): Promise<void> => this.deviceOperations.setLevel(level)
  };
  readonly crypto = {
    status: () => this.cryptoOperations.status(),
    backupStatus: () => this.cryptoOperations.backupStatus(),
    setupRecovery: (options?: RecoverySetupOptions) => this.cryptoOperations.setupRecovery(options),
    recover: (recoveryKey: string) => this.cryptoOperations.recover(recoveryKey)
  };
  readonly presence = { set: (update: PresenceUpdate): Promise<void> => this.presenceOperations.set(update) };
  readonly users = {
    profile: (userId: string, conversationId?: ConversationId): Promise<User> =>
      this.userOperations.profile(userId, conversationId),
    avatar: (userId: string, options?: AvatarOptions): Promise<AvatarImage | undefined> =>
      this.userOperations.avatar(userId, options),
    search: (query: string, options?: SearchUsersOptions): Promise<readonly User[]> =>
      this.userOperations.search(query, options),
    setDisplayName: (displayName: string): Promise<void> => this.userOperations.setDisplayName(displayName),
    setAvatar: (image: AvatarImage): Promise<void> => this.userOperations.setAvatar(image),
    ignored: (): Promise<readonly string[]> => this.userOperations.ignored(),
    ignore: (userId: string): Promise<void> => this.userOperations.ignore(userId),
    unignore: (userId: string): Promise<void> => this.userOperations.unignore(userId)
  };
  readonly spaces = {
    list: (): Promise<readonly Space[]> => this.spaceOperations.list(),
    create: (input: CreateSpaceInput): Promise<Space> => this.spaceOperations.create(input),
    add: (spaceId: ConversationId, conversationId: ConversationId): Promise<void> =>
      this.spaceOperations.add(spaceId, conversationId),
    remove: (spaceId: ConversationId, conversationId: ConversationId): Promise<void> =>
      this.spaceOperations.remove(spaceId, conversationId),
    conversations: (spaceId: ConversationId): Promise<readonly Conversation[]> =>
      this.spaceOperations.conversations(spaceId)
  };
  /** Telling where you are while you move, for a while that ends on its own. */
  readonly location = {
    start: (conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation> =>
      this.locationOperations.start(conversationId, input),
    update: (sharingId: string, position: GeoLocation): Promise<void> =>
      this.locationOperations.update(sharingId, position),
    stop: (sharingId: string): Promise<void> => this.locationOperations.stop(sharingId),
    list: (conversationId: ConversationId): Promise<readonly LiveLocation[]> =>
      this.locationOperations.list(conversationId)
  };
  /** Asking the conversation something and counting the votes. */
  readonly polls = {
    start: (conversationId: ConversationId, input: StartPollInput): Promise<Poll> =>
      this.pollOperations.start(conversationId, input),
    vote: (conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void> =>
      this.pollOperations.vote(conversationId, pollId, answerId),
    close: (conversationId: ConversationId, pollId: MessageId): Promise<void> =>
      this.pollOperations.close(conversationId, pollId),
    list: (conversationId: ConversationId): Promise<readonly Poll[]> =>
      this.pollOperations.list(conversationId)
  };
  readonly media = {
    download: (media: MediaRef): Promise<Uint8Array> => this.mediaOperations.download(media),
    preview: (url: string): Promise<LinkPreview> => this.mediaOperations.preview(url)
  };
  readonly verification = {
    request: (userId: string, deviceId?: string, options?: VerificationRequestOptions) =>
      this.verificationOperations.request(userId, deviceId, options),
    qrCode: (sessionId: string) => this.verificationOperations.qrCode(sessionId),
    scan: (sessionId: string, code: Uint8Array) => this.verificationOperations.scan(sessionId, code),
    accept: (sessionId: string) => this.verificationOperations.accept(sessionId),
    cancel: (sessionId: string) => this.verificationOperations.cancel(sessionId),
    confirm: (sessionId: string) => this.verificationOperations.confirm(sessionId),
    reject: (sessionId: string) => this.verificationOperations.reject(sessionId)
  };

  private readonly events = new EventBus();
  /** The smaller things somebody did while there was no homeserver to tell. */
  private readonly waiting = new PendingActions();
  private readonly messageOperations: MessageOperations;
  private readonly messageMutations: MessageMutations;
  private readonly conversationOperations: ConversationOperations;
  private readonly reactionOperations: ReactionOperations;
  private readonly deviceOperations: DeviceOperations;
  private readonly cryptoOperations: CryptoOperations;
  private readonly presenceOperations: PresenceOperations;
  private readonly verificationOperations: VerificationOperations;
  private readonly mediaOperations: MediaOperations;
  private readonly pollOperations: PollOperations;
  private readonly locationOperations: LocationOperations;
  private readonly userOperations: UserOperations;
  private readonly spaceOperations: SpaceOperations;
  private readonly lifecycle: ClientLifecycle;
  private session: Session | undefined;

  constructor(config: MessagingClientConfig) {
    const adapter = config.adapter ?? new UnavailableAdapter();
    // The local copy is a convenience, not the truth. A store that cannot write must cost somebody that
    // convenience and nothing else, so its failures are reported rather than thrown at whoever was reading.
    const storage = config.storage ? forgivingStorage(config.storage, error => this.emitError(error)) : undefined;
    const base = {
      adapter,
      assertStarted: () => this.lifecycle.assertStarted(),
      emitError: (error: unknown) => this.emitError(error)
    };
    const messageContext: MessageOperationsContext = {
      ...base,
      getSession: () => this.session,
      emitMessageUpdated: message => this.events.emit("message.updated", message),
      emitMessageReceived: message => this.events.emit("message.received", message),
      // Built after this one, so it is reached when it is needed rather than when this is put together.
      wasRead: conversationId => this.conversationOperations.clearUnreadMark(conversationId),
      cachedMessagesPerConversation: config.cache?.messagesPerConversation ?? defaultCachedMessages,
      rememberedMessages: config.cache?.seenMessages ?? defaultRememberedMessages,
      ...(storage ? { storage } : {})
    };
    this.messageOperations = new MessageOperations(messageContext);
    const storageContext = storage ? { storage } : {};
    this.messageMutations = new MessageMutations({
      ...base,
      ...storageContext,
      waiting: this.waiting,
      emitUpdated: message => this.events.emit("message.updated", message)
    });
    this.conversationOperations = new ConversationOperations({
      ...base,
      ...storageContext,
      getSession: () => this.session,
      emitUpdated: conversation => this.events.emit("conversation.updated", conversation),
      now: config.now ?? (() => Date.now()),
      isCaughtUp: () => this.lifecycle.isCaughtUp(),
      ...(config.cache?.conversations !== undefined ? { cachedConversations: config.cache.conversations } : {})
    });
    this.reactionOperations = new ReactionOperations({
      ...base,
      getSession: () => this.session,
      waiting: this.waiting
    });
    this.deviceOperations = new DeviceOperations(base);
    this.cryptoOperations = new CryptoOperations(base);
    this.presenceOperations = new PresenceOperations(base);
    this.verificationOperations = new VerificationOperations({
      ...base,
      getSession: () => this.session,
      openDirect: (userId: string) => this.conversationOperations.open(userId)
    });
    this.mediaOperations = new MediaOperations({
      ...base,
      cachedBytes: config.cache?.downloadedBytes ?? 32 * 1024 * 1024,
      now: config.now ?? (() => Date.now())
    });
    this.pollOperations = new PollOperations(base);
    this.locationOperations = new LocationOperations(base);
    this.userOperations = new UserOperations({
      ...base,
      ...storageContext,
      now: config.now ?? (() => Date.now()),
      cachedAvatarBytes: config.cache?.avatarBytes ?? 8 * 1024 * 1024
    });
    this.spaceOperations = new SpaceOperations(base);
    this.session = config.session;
    this.lifecycle = new ClientLifecycle({
      adapter,
      getSession: () => this.session,
      setSession: session => { this.session = session; },
      flushPending: async () => {
        await this.messageOperations.flushPending();
        // What was read while there was nobody to tell is told now, and so is everything else that waited.
        await this.messageOperations.tellWhatWasRead();
        await this.waiting.runWhatIsWaiting(error => this.emitError(error));
      },
      purgeStorage: async () => {
        await storage?.clear();
        this.mediaOperations.forget();
      },
      forgetRunningState: () => {
        this.waiting.clear();
        this.conversationOperations.forget();
        this.messageOperations.forget();
        this.userOperations.forget();
      },
      handlers: {
        onConversationUpdated: conversation => {
          // A member may have renamed themselves, and what was held about this conversation would say otherwise.
          this.userOperations.forgetConversation(conversation.id);
          // Keeping it, not only announcing it: otherwise anything read from the local store goes stale.
          void storage?.saveConversation(conversation);
          this.events.emit("conversation.updated", conversation);
        },
        onMessageReceived: message => this.messageOperations.receiveMessage(message),
        onMessageUpdated: message => this.messageOperations.updateMessage(message),
        onReactionAdded: reaction => this.events.emit("reaction.added", reaction),
        onReactionRemoved: reaction => this.events.emit("reaction.removed", reaction),
        onTypingChanged: update => this.events.emit("typing.changed", update),
        onReceiptReceived: receipt => this.events.emit("receipt.received", receipt),
        onPresenceChanged: presence => this.events.emit("presence.changed", presence),
        onNotification: notification => this.events.emit("notification", notification),
        onSessionEnded: () => {
          // Stopping first, so whatever the application does when told finds a client that is honestly stopped
          // rather than one that still looks alive and fails on the next thing it is asked.
          void this.lifecycle.sessionEnded().finally(() => this.events.emit("session.ended", undefined));
        },
        onVerificationRequested: verification => this.events.emit("verification.requested", verification),
        onVerificationChanged: verification => this.events.emit("verification.changed", verification),
        onError: error => this.emitError(error)
      },
      emitConnection: status => this.events.emit("connection.changed", status),
      emitSync: status => this.events.emit("sync.changed", status),
      emitError: error => this.emitError(error)
    });
  }

  login(credentials: LoginCredentials): Promise<Session> { return this.lifecycle.login(credentials); }
  register(credentials: RegisterCredentials): Promise<Session> { return this.lifecycle.register(credentials); }
  start(options?: StartOptions): Promise<void> { return this.lifecycle.start(options); }
  stop(): Promise<void> { this.messageOperations.clear(); return this.lifecycle.stop(); }
  logout(): Promise<void> { this.messageOperations.clear(); return this.lifecycle.logout(); }
  on<Name extends EventName>(name: Name, listener: EventListener<Name>): () => void { return this.events.on(name, listener); }
  getConnectionStatus(): ConnectionStatus { return this.lifecycle.getConnectionStatus(); }
  getSyncStatus(): SyncStatus { return this.lifecycle.getSyncStatus(); }

  /** A live list telling the application something went wrong inside one of its own subscribers. */
  emitListenerError(error: unknown): void {
    this.emitError(error);
  }

  private emitError(error: unknown): void {
    this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
  }
}

export type ClientEvents = ClientEventMap;
