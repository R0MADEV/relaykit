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
import { AccountOperations } from "./account-operations.js";
import { codeOf, Diagnostics } from "./diagnostics.js";
import { RelayKitError } from "./errors.js";
import { SpaceOperations } from "./space-operations.js";
import { ReactionOperations } from "./reaction-operations.js";
import { UnavailableAdapter } from "./unavailable-adapter.js";
import { forgivingStorage } from "./forgiving-storage.js";
import { PollOperations } from "./poll-operations.js";
import { LocationOperations } from "./location-operations.js";
import { CallOperations } from "./call-operations.js";
import type { MessagingClientConfig } from "./client-config.js";
import type { AdapterHandlers, MessagingAdapter } from "./adapter.js";
import type { MessagingStorage } from "./storage.js";
import type {
  AccountAddress,
  AddressProof,
  AvatarImage,
  AvatarOptions,
  Call,
  CallQuality,
  LinkPreview,
  MediaLimits,
  LiveLocation,
  PastCall,
  PlaceCallOptions,
  MarkReadOptions,
  ShareLocationInput,
  Poll,
  Participant,
  RoomVersions,
  SpaceChild,
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
  KeyStanding,
  User,
  UserPresence,
  WayIn,
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
  MessageSurroundings,
  RemoteSearchOptions,
  RemoteSearchPage,
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
    create: (input: CreateConversationInput): Promise<Conversation> =>
      this.conversationOperations.create(input),
    join: (conversationId: ConversationId, options?: JoinConversationOptions): Promise<Conversation> =>
      this.conversationOperations.join(conversationId, options),
    open: (userId: string): Promise<Conversation> => this.conversationOperations.open(userId),
    leave: (conversationId: ConversationId): Promise<void> =>
      this.conversationOperations.leave(conversationId),
    invite: (conversationId: ConversationId, userId: string): Promise<Conversation> =>
      this.conversationOperations.invite(conversationId, userId),
    rename: (conversationId: ConversationId, title: string): Promise<Conversation> =>
      this.conversationOperations.settings.rename(conversationId, title),
    remove: (conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation> =>
      this.conversationOperations.moderating.remove(conversationId, userId, reason),
    ban: (conversationId: ConversationId, userId: string, reason?: string): Promise<Conversation> =>
      this.conversationOperations.moderating.ban(conversationId, userId, reason),
    unban: (conversationId: ConversationId, userId: string): Promise<Conversation> =>
      this.conversationOperations.moderating.unban(conversationId, userId),
    setUnread: (conversationId: ConversationId, unread: boolean): Promise<Conversation> =>
      this.conversationOperations.settings.setUnread(conversationId, unread),
    setFavourite: (conversationId: ConversationId, favourite: boolean): Promise<Conversation> =>
      this.conversationOperations.settings.setFavourite(conversationId, favourite),
    setTopic: (conversationId: ConversationId, topic: string): Promise<Conversation> =>
      this.conversationOperations.settings.setTopic(conversationId, topic),
    setAvatar: (conversationId: ConversationId, image: AvatarImage): Promise<Conversation> =>
      this.conversationOperations.settings.setAvatar(conversationId, image),
    setNotifications: (conversationId: ConversationId, level: NotificationLevel): Promise<Conversation> =>
      this.conversationOperations.settings.setNotifications(conversationId, level),
    pin: (conversationId: ConversationId, messageId: MessageId): Promise<void> =>
      this.conversationOperations.settings.pin(conversationId, messageId),
    unpin: (conversationId: ConversationId, messageId: MessageId): Promise<void> =>
      this.conversationOperations.settings.unpin(conversationId, messageId),
    rotateKeys: (conversationId: ConversationId): Promise<void> =>
      this.conversationOperations.rotateKeys(conversationId),
    upgrade: (conversationId: ConversationId): Promise<Conversation> =>
      this.conversationOperations.settings.upgrade(conversationId),
    current: (conversationId: ConversationId): Promise<Conversation> =>
      this.conversationOperations.current(conversationId),
    link: (conversationId: ConversationId): Promise<string> =>
      this.conversationOperations.link(conversationId),
    setAlias: (conversationId: ConversationId, alias: string): Promise<Conversation> =>
      this.conversationOperations.settings.setAlias(conversationId, alias),
    publish: (conversationId: ConversationId, listed: boolean): Promise<void> =>
      this.conversationOperations.settings.publish(conversationId, listed),
    discover: (query?: string): Promise<readonly PublicConversation[]> =>
      this.conversationOperations.discover(query),
    setJoinRule: (conversationId: ConversationId, rule: JoinRule): Promise<Conversation> =>
      this.conversationOperations.settings.setJoinRule(conversationId, rule),
    setHistoryVisibility: (
      conversationId: ConversationId,
      visibility: HistoryVisibility
    ): Promise<Conversation> =>
      this.conversationOperations.settings.setHistoryVisibility(conversationId, visibility),
    knock: (conversationId: ConversationId, options?: KnockOptions): Promise<void> =>
      this.conversationOperations.moderating.knock(conversationId, options),
    saveDraft: async (conversationId: ConversationId, text: string): Promise<void> => {
      await this.conversationOperations.saveDraft(conversationId, text);
      // Something was written here, so the next message sent has a draft to clear.
      this.messageOperations.sending.draftWritten(conversationId);
    },
    draft: (conversationId: ConversationId): Promise<string | undefined> =>
      this.conversationOperations.draft(conversationId),
    pinned: (conversationId: ConversationId): Promise<readonly Message[]> =>
      this.conversationOperations.settings.pinned(conversationId),
    participants: (conversationId: ConversationId): Promise<readonly Participant[]> =>
      this.conversationOperations.moderating.participants(conversationId),
    permissions: (conversationId: ConversationId): Promise<ConversationPermissions> =>
      this.conversationOperations.moderating.permissions(conversationId),
    forget: (conversationId: ConversationId): Promise<void> =>
      this.conversationOperations.settings.forget(conversationId),
    tag: (conversationId: ConversationId, tag: string): Promise<void> =>
      this.conversationOperations.settings.tag(conversationId, tag),
    untag: (conversationId: ConversationId, tag: string): Promise<void> =>
      this.conversationOperations.settings.untag(conversationId, tag),
    tags: (conversationId: ConversationId): Promise<readonly string[]> =>
      this.conversationOperations.settings.tags(conversationId),
    versions: (): Promise<RoomVersions> => this.conversationOperations.settings.versions(),
    setRole: (conversationId: ConversationId, userId: string, role: ConversationRole): Promise<void> =>
      this.conversationOperations.moderating.setRole(conversationId, userId, role),
    findDirect: (userId: string): Promise<Conversation | undefined> =>
      this.conversationOperations.findDirect(userId),
    search: (query: string): Promise<readonly Conversation[]> => this.conversationOperations.search(query),
    typing: (conversationId: ConversationId, isTyping: boolean, timeoutMs = 5000): Promise<void> =>
      this.conversationOperations.typing(conversationId, isTyping, timeoutMs)
  };

  readonly messages = {
    list: (id: ConversationId, options?: ListMessagesOptions): Promise<readonly Message[]> =>
      this.messageOperations.listMessages(id, options),
    loadMore: (id: ConversationId, limit = 20): Promise<MessagePage> =>
      this.messageOperations.loadMoreMessages(id, limit),
    search: (query: string, options?: MessageSearchOptions): Promise<readonly Message[]> =>
      this.messageOperations.search(query, options),
    thread: (id: ConversationId, rootId: MessageId): Promise<readonly Message[]> =>
      this.messageOperations.thread(id, rootId),
    threads: (id: ConversationId): Promise<readonly ThreadSummary[]> => this.messageOperations.threads(id),
    searchRemote: (query: string, options?: RemoteSearchOptions): Promise<RemoteSearchPage> =>
      this.messageOperations.searchRemote(query, options),
    around: (id: ConversationId, messageId: MessageId, limit?: number): Promise<MessageSurroundings> =>
      this.messageOperations.around(id, messageId, limit),
    send: (id: ConversationId, body: string, options?: SendMessageOptions): Promise<Message> =>
      this.messageOperations.sending.sendMessage(id, body, options),
    sendFile: (id: ConversationId, file: FileInput, options?: SendFileOptions): Promise<Message> =>
      this.messageOperations.sending.sendFile(id, file, options),
    sendSticker: (id: ConversationId, sticker: FileInput): Promise<Message> =>
      this.messageOperations.sending.sendSticker(id, sticker),
    sendLocation: (id: ConversationId, location: GeoLocation): Promise<Message> =>
      this.messageOperations.sending.sendLocation(id, location),
    sendVoice: (id: ConversationId, file: FileInput, voice: VoiceInfo): Promise<Message> =>
      this.messageOperations.sending.sendVoice(id, file, voice),
    report: (id: MessageId, reason: string): Promise<void> => this.messageOperations.report(id, reason),
    unreadSince: (id: ConversationId): Promise<readonly Message[]> =>
      this.messageOperations.reading.unreadSince(id),
    forward: (id: MessageId, toConversationId: ConversationId): Promise<Message> =>
      this.messageOperations.sending.forward(id, toConversationId),
    retry: (id: MessageId): Promise<Message> => this.messageOperations.sending.retryMessage(id),
    cancel: (id: MessageId): Promise<Message> => this.messageOperations.sending.cancelMessage(id),
    markRead: (
      conversationId: ConversationId,
      messageId: MessageId,
      options?: MarkReadOptions
    ): Promise<void> => this.messageOperations.reading.markRead(conversationId, messageId, options),
    readBy: (conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]> =>
      this.messageOperations.reading.readBy(conversationId, messageId),
    edit: (id: ConversationId, messageId: MessageId, body: string): Promise<Message> =>
      this.messageMutations.edit(id, messageId, body),
    delete: (id: ConversationId, messageId: MessageId): Promise<Message> =>
      this.messageMutations.delete(id, messageId)
  };

  readonly reactions = {
    add: (id: ConversationId, messageId: MessageId, key: string): Promise<Reaction> =>
      this.reactionOperations.add(id, messageId, key),
    remove: (id: ConversationId, reactionId: string): Promise<void> =>
      this.reactionOperations.remove(id, reactionId)
  };
  readonly devices = {
    verification: (userId: string, deviceId: string) => this.deviceOperations.verification(userId, deviceId),
    verify: (userId: string, deviceId: string) => this.deviceOperations.verify(userId, deviceId),
    revoke: (userId: string, deviceId: string) => this.deviceOperations.revoke(userId, deviceId),
    list: (): Promise<readonly Device[]> => this.deviceOperations.list(),
    rename: (deviceId: string, displayName: string): Promise<void> =>
      this.deviceOperations.rename(deviceId, displayName),
    signOut: (deviceIds: readonly string[], options?: SignOutOptions): Promise<void> =>
      this.deviceOperations.signOut(deviceIds, options)
  };
  /** Being woken while the application is closed, which the homeserver does through a push gateway. */
  readonly push = {
    register: (registration: PushRegistration): Promise<void> =>
      this.deviceOperations.registerPush(registration),
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
    /** Whether this device can read what was said before it, and what there is to offer when it cannot. */
    standing: (): Promise<KeyStanding> => this.cryptoOperations.standing(),
    backupStatus: () => this.cryptoOperations.backupStatus(),
    setupRecovery: (options?: RecoverySetupOptions) => this.cryptoOperations.setupRecovery(options),
    recover: (recoveryKey: string) => this.cryptoOperations.recover(recoveryKey)
  };
  /**
   * Signing in somewhere else and coming back: an organisation's single sign-on, or Google.
   *
   * All three happen before there is a session, so the homeserver is named each time.
   */
  /** The account itself: its password, its end, and whatever it remembers about itself. */
  readonly account = {
    changePassword: (currentPassword: string, newPassword: string): Promise<void> =>
      this.accountOperations.changePassword(currentPassword, newPassword),
    close: (password: string): Promise<void> => this.accountOperations.close(password),
    remember: (name: string, value: Readonly<Record<string, unknown>>): Promise<void> =>
      this.accountOperations.remember(name, value),
    remembered: (name: string): Promise<Readonly<Record<string, unknown>> | undefined> =>
      this.accountOperations.remembered(name),
    addresses: (): Promise<readonly AccountAddress[]> => this.accountOperations.addresses(),
    addEmail: (email: string): Promise<AddressProof> => this.accountOperations.addEmail(email),
    confirmEmail: (proof: AddressProof, password: string): Promise<void> =>
      this.accountOperations.confirmEmail(proof, password),
    removeAddress: (kind: "email" | "phone", address: string): Promise<void> =>
      this.accountOperations.removeAddress(kind, address)
  };
  readonly sso = {
    waysIn: (homeserver: string): Promise<readonly WayIn[]> => this.lifecycle.waysIn(homeserver),
    startAt: (homeserver: string, comeBackTo: string, wayInId?: string): Promise<string> =>
      this.lifecycle.wayInAddress(homeserver, comeBackTo, wayInId),
    finish: (homeserver: string, token: string): Promise<Session> =>
      this.lifecycle.finishSigningIn(homeserver, token)
  };
  readonly presence = {
    set: (update: PresenceUpdate): Promise<void> => this.presenceOperations.set(update),
    of: (userId: string): Promise<UserPresence | undefined> => this.presenceOperations.of(userId)
  };
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
      this.spaceOperations.conversations(spaceId),
    children: (spaceId: ConversationId): Promise<readonly SpaceChild[]> =>
      this.spaceOperations.children(spaceId)
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
  /** Calls between the people of a conversation. The audio and the video never pass through here. */
  readonly calls = {
    place: (conversationId: ConversationId, options?: PlaceCallOptions): Promise<Call> =>
      this.callOperations.place(conversationId, options),
    join: (conversationId: ConversationId, options?: PlaceCallOptions): Promise<Call> =>
      this.callOperations.join(conversationId, options),
    answer: (callId: string, options?: PlaceCallOptions): Promise<Call> =>
      this.callOperations.answer(callId, options),
    hangUp: (callId: string): Promise<void> => this.callOperations.hangUp(callId),
    reject: (callId: string): Promise<void> => this.callOperations.reject(callId),
    muteMicrophone: (callId: string, muted: boolean): Promise<void> =>
      this.callOperations.muteMicrophone(callId, muted),
    muteCamera: (callId: string, muted: boolean): Promise<void> =>
      this.callOperations.muteCamera(callId, muted),
    shareScreen: (callId: string, sharing: boolean): Promise<void> =>
      this.callOperations.shareScreen(callId, sharing),
    quality: (callId: string): Promise<CallQuality> => this.callOperations.quality(callId),
    useMicrophone: (deviceId: string): Promise<void> => this.callOperations.useMicrophone(deviceId),
    useCamera: (deviceId: string): Promise<void> => this.callOperations.useCamera(deviceId),
    list: (): Promise<readonly Call[]> => this.callOperations.list(),
    history: (conversationId: ConversationId, limit?: number): Promise<readonly PastCall[]> =>
      this.callOperations.history(conversationId, limit)
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
    preview: (url: string): Promise<LinkPreview> => this.mediaOperations.preview(url),
    limits: (): Promise<MediaLimits> => this.mediaOperations.limits()
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
  private readonly callOperations: CallOperations;
  private readonly userOperations: UserOperations;
  private readonly spaceOperations: SpaceOperations;
  private readonly accountOperations: AccountOperations;
  private readonly lifecycle: ClientLifecycle;
  private session: Session | undefined;
  /** Where what the library is doing goes, when anybody asked for it. */
  private readonly diagnostics: Diagnostics;

  constructor(config: MessagingClientConfig) {
    const adapter = config.adapter ?? new UnavailableAdapter();
    // The local copy is a convenience, not the truth. A store that cannot write must cost somebody that
    // convenience and nothing else, so its failures are reported rather than thrown at whoever was reading.
    this.diagnostics = new Diagnostics(config.diagnostics);
    const storage = config.storage
      ? forgivingStorage(config.storage, error => {
          // Almost always a browser refusing to write rather than anything remote, and almost always
          // invisible: what was lost was a cache. Worth knowing when somebody asks why it is slow.
          this.diagnostics.say("storage.failed", codeOf(error));
          this.emitError(error);
        })
      : undefined;
    const getSession = (): Session | undefined => this.session;
    const now = config.now ?? ((): number => Date.now());
    const base = {
      adapter,
      assertStarted: () => this.lifecycle.assertStarted(),
      emitError: (error: unknown) => this.emitError(error),
      diagnostics: this.diagnostics
    };
    const storageContext = storage ? { storage } : {};
    const messageContext: MessageOperationsContext = {
      ...base,
      getSession,
      emitMessageUpdated: message => this.announce("message.updated", message),
      emitMessageReceived: message => {
        // Something arrived that this device has no key for. Nothing here is broken and nothing will fix
        // itself, so it only ever shows up as a hole in a conversation somebody else can read.
        if (message.undecryptable) {
          this.diagnostics.say("crypto.undecryptable", { what: message.conversationId });
        }
        this.announce("message.received", message);
      },
      // Built after this one, so it is reached when it is needed rather than when this is put together.
      wasRead: conversationId => this.conversationOperations.settings.clearUnreadMark(conversationId),
      whatTheHomeserverTakes: () => this.mediaOperations.limits(),
      cachedMessagesPerConversation: config.cache?.messagesPerConversation ?? defaultCachedMessages,
      rememberedMessages: config.cache?.seenMessages ?? defaultRememberedMessages,
      ...storageContext
    };
    this.messageOperations = new MessageOperations(messageContext);
    this.messageMutations = new MessageMutations({
      ...base,
      ...storageContext,
      waiting: this.waiting,
      emitUpdated: message => this.announce("message.updated", message)
    });
    this.conversationOperations = new ConversationOperations({
      ...base,
      ...storageContext,
      getSession,
      now,
      emitUpdated: conversation => this.announce("conversation.updated", conversation),
      isCaughtUp: () => this.lifecycle.isCaughtUp(),
      ...(config.cache?.conversations !== undefined
        ? { cachedConversations: config.cache.conversations }
        : {})
    });
    this.reactionOperations = new ReactionOperations({ ...base, getSession, waiting: this.waiting });
    this.verificationOperations = new VerificationOperations({
      ...base,
      getSession,
      openDirect: (userId: string) => this.conversationOperations.open(userId)
    });
    this.mediaOperations = new MediaOperations({
      ...base,
      now,
      cachedBytes: config.cache?.downloadedBytes ?? 32 * 1024 * 1024
    });
    this.userOperations = new UserOperations({
      ...base,
      ...storageContext,
      now,
      cachedAvatarBytes: config.cache?.avatarBytes ?? 8 * 1024 * 1024
    });
    // The rest ask for nothing of their own.
    this.deviceOperations = new DeviceOperations(base);
    this.cryptoOperations = new CryptoOperations(base);
    this.presenceOperations = new PresenceOperations(base);
    this.pollOperations = new PollOperations(base);
    this.locationOperations = new LocationOperations(base);
    this.callOperations = new CallOperations(base);
    this.spaceOperations = new SpaceOperations(base);
    this.accountOperations = new AccountOperations({
      ...base,
      nothingLeftToBe: () => this.lifecycle.accountIsGone()
    });
    this.session = config.session;
    this.lifecycle = this.lifecycleFor(adapter, storage, config.storage);
  }

  /** Everything the adapter says while it runs, and the one place each of those goes. */
  private handlersFor(storage: MessagingStorage | undefined): AdapterHandlers {
    return {
      onConversationUpdated: conversation => {
        // A member may have renamed themselves, and what was held about this conversation would say otherwise.
        this.userOperations.forgetConversation(conversation.id);
        // Keeping it, not only announcing it: otherwise anything read from the local store goes stale.
        void storage?.saveConversation(conversation);
        this.announce("conversation.updated", conversation);
      },
      onMessageReceived: message => this.messageOperations.receiveMessage(message),
      onMessageUpdated: message => this.messageOperations.updateMessage(message),
      onReactionAdded: reaction => this.announce("reaction.added", reaction),
      onReactionRemoved: reaction => this.announce("reaction.removed", reaction),
      onTypingChanged: update => this.announce("typing.changed", update),
      onReceiptReceived: receipt => this.announce("receipt.received", receipt),
      onPresenceChanged: presence => this.announce("presence.changed", presence),
      onNotification: notification => this.announce("notification", notification),
      onCallIncoming: call => this.announce("call.incoming", call),
      onCallChanged: call => this.announce("call.changed", call),
      onCallSpeaking: speaking => this.announce("call.speaking", speaking),
      onSessionEnded: () => {
        // Stopping first, so whatever the application does when told finds a client that is honestly stopped
        // rather than one that still looks alive and fails on the next thing it is asked.
        void this.lifecycle.sessionEnded().finally(() => this.announce("session.ended", undefined));
      },
      onSessionRefreshed: session => {
        // Held here as well as handed out, so anything asked next uses the token that still works.
        this.nowSignedInAs(session);
        this.announce("session.refreshed", session);
      },
      onVerificationRequested: verification => this.announce("verification.requested", verification),
      onVerificationChanged: verification => this.announce("verification.changed", verification),
      onError: error => this.emitError(error)
    };
  }

  /**
   * The one place the session changes.
   *
   * Every way of getting one goes through here — signing in, registering, a guest, coming back from somebody
   * else's sign-in, a token renewed on its own, signing out — so that anything which has to follow who is
   * signed in follows one thing instead of remembering six.
   */
  private nowSignedInAs(session: Session | undefined): void {
    // Kept first and told second, and never the other way round: deciding whether this is news must not be
    // able to decide whether it is written down. A password change revokes the refresh token and hands back
    // the same person and the same access token, so anything that compared only those two would keep a token
    // the homeserver has already thrown away.
    const isNews = !theSameSession(this.session, session);
    this.session = session;
    if (isNews) this.announce("session.changed", session);
  }

  /** Signing in and out, starting, stopping, and putting back what was held while it was away. */
  private lifecycleFor(
    adapter: MessagingAdapter,
    storage: MessagingStorage | undefined,
    /** The store as it was handed in, not wrapped: emptying it is the one thing that may not fail quietly. */
    theRealStore: MessagingStorage | undefined
  ): ClientLifecycle {
    return new ClientLifecycle({
      adapter,
      getSession: () => this.session,
      setSession: session => this.nowSignedInAs(session),
      flushPending: async () => {
        await this.messageOperations.sending.flushPending();
        // What was read while there was nobody to tell is told now, and so is everything else that waited.
        await this.messageOperations.reading.tellWhatWasRead();
        await this.waiting.runWhatIsWaiting(error => this.emitError(error));
      },
      purgeStorage: async () => {
        // The real store, not the forgiving wrapper the rest of the library uses. Everywhere else a failed
        // write is a lost convenience and is swallowed on purpose; here somebody asked for their
        // conversations to be gone from this device, and quietly not doing it is the worst possible answer.
        try {
          await theRealStore?.clear();
        } catch (error) {
          this.diagnostics.say("storage.failed", codeOf(error));
          throw new RelayKitError("STORAGE_ERROR", "The local copy could not be emptied", {
            detail: error instanceof Error ? error.message : String(error)
          });
        } finally {
          this.mediaOperations.forget();
        }
      },
      forgetRunningState: () => {
        this.waiting.clear();
        this.conversationOperations.forget();
        this.messageOperations.forget();
        this.userOperations.forget();
      },
      handlers: this.handlersFor(storage),
      emitConnection: status => this.announce("connection.changed", status),
      emitSync: status => this.announce("sync.changed", status),
      emitError: error => this.emitError(error),
      diagnostics: this.diagnostics
    });
  }

  login(credentials: LoginCredentials): Promise<Session> {
    return this.lifecycle.login(credentials);
  }
  /** Coming in without an account, where the homeserver lets anybody in. */
  /**
   * A way back into an account whose password is forgotten: the homeserver sends something to an address it
   * knows belongs to it. Before there is a session, because somebody locked out cannot have one.
   */
  resetPassword(homeserver: string, email: string): Promise<AddressProof> {
    return this.accountOperations.startResettingPassword(homeserver, email);
  }

  /** Finishes it, with what arrived at the address and the password to use from now on. */
  finishResettingPassword(homeserver: string, proof: AddressProof, newPassword: string): Promise<void> {
    return this.accountOperations.finishResettingPassword(homeserver, proof, newPassword);
  }

  /**
   * The session this client is holding, or nothing when it is holding none.
   *
   * Pairs with `session.changed`: the event says when, this says what. Anything that subscribed late — a
   * screen drawn after a token was renewed on its own — has somewhere to ask instead of guessing.
   */
  currentSession(): Session | undefined {
    return this.session;
  }

  signInAsGuest(homeserver: string): Promise<Session> {
    return this.lifecycle.signInAsGuest(homeserver);
  }
  register(credentials: RegisterCredentials): Promise<Session> {
    return this.lifecycle.register(credentials);
  }
  start(options?: StartOptions): Promise<void> {
    return this.lifecycle.start(options);
  }
  stop(): Promise<void> {
    this.messageOperations.clear();
    return this.lifecycle.stop();
  }
  logout(): Promise<void> {
    this.messageOperations.clear();
    return this.lifecycle.logout();
  }
  on<Name extends EventName>(name: Name, listener: EventListener<Name>): () => void {
    return this.events.on(name, listener);
  }
  getConnectionStatus(): ConnectionStatus {
    return this.lifecycle.getConnectionStatus();
  }
  getSyncStatus(): SyncStatus {
    return this.lifecycle.getSyncStatus();
  }

  /** A live list telling the application something went wrong inside one of its own subscribers. */
  emitListenerError(error: unknown): void {
    this.emitError(error);
  }

  /**
   * Tells whoever is listening, and keeps going whatever they do about it.
   *
   * One place, so no future emission can forget: a bug in one application's screen must not stop the next
   * listener hearing about something, nor leave the work this was emitted from half finished.
   */
  private announce<Name extends EventName>(name: Name, payload: ClientEvents[Name]): void {
    this.events.emit(name, payload, (error: unknown) => this.emitError(error));
  }

  private emitError(error: unknown): void {
    // A listener that throws while being told about an error is told to nobody. There is nowhere left to
    // say it, and saying it again is a loop.
    this.events.emit("error", error instanceof Error ? error : new Error(String(error)), () => undefined);
  }
}

export type ClientEvents = ClientEventMap;

/**
 * Whether two sessions are the same one.
 *
 * Every field, because every one of them can change on its own: a token renewed, a refresh token revoked by a
 * password change, an expiry moved, a guest becoming somebody. Comparing a couple of them and calling it
 * equal is how a client ends up holding something the homeserver no longer honours.
 */
function theSameSession(one: Session | undefined, other: Session | undefined): boolean {
  if (one === undefined || other === undefined) return one === other;
  return (
    one.homeserver === other.homeserver &&
    one.userId === other.userId &&
    one.accessToken === other.accessToken &&
    one.deviceId === other.deviceId &&
    one.refreshToken === other.refreshToken &&
    one.expiresAt === other.expiresAt &&
    one.isGuest === other.isGuest
  );
}
