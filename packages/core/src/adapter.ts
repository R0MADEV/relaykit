import type {
  AvatarImage,
  ConversationPermissions,
  SendContent,
  ConversationRole,
  CreateSpaceInput,
  NotificationLevel,
  Space,
  Device,
  MediaRef,
  SignOutOptions,
  FileInput,
  MessagePage,
  LinkPreview,
  LiveLocation,
  ShareLocationInput,
  Poll,
  StartPollInput,
  MarkReadOptions,
  Notification,
  ThreadSummary,
  User,
  UserId,
  Conversation,
  ConversationId,
  CreateConversationInput,
  Message,
  MessageId,
  HistoryVisibility,
  JoinRule,
  KnockOptions,
  PublicConversation,
  Reaction,
  PushRegistration,
  DeviceVerification,
  CryptoStatus,
  KeyBackupStatus,
  KeyBackupRestoreSummary,
  PresenceUpdate,
  RecoverySetup,
  RecoverySetupOptions,
  ReadReceipt,
  TypingUpdate,
  UserPresence,
  VerificationRequestOptions,
  VerificationSession,
  Session,
  LoginCredentials,
  RegisterCredentials,
  ConnectionStatus,
  SyncStatus,
  GeoLocation
} from "./models.js";

export interface AdapterHandlers {
  readonly onConnectionChanged?: (status: ConnectionStatus) => void;
  readonly onSyncChanged?: (status: SyncStatus) => void;
  readonly onConversationUpdated?: (conversation: Conversation) => void;
  readonly onMessageReceived?: (message: Message) => void;
  readonly onMessageUpdated?: (message: Message) => void;
  readonly onReactionAdded?: (reaction: Reaction) => void;
  readonly onReactionRemoved?: (reaction: Reaction) => void;
  readonly onTypingChanged?: (update: TypingUpdate) => void;
  readonly onReceiptReceived?: (receipt: ReadReceipt) => void;
  readonly onPresenceChanged?: (presence: UserPresence) => void;
  readonly onNotification?: (notification: Notification) => void;
  /** Told when the homeserver stops accepting this session, without anybody having asked it to. */
  readonly onSessionEnded?: () => void;
  readonly onVerificationRequested?: (session: VerificationSession) => void;
  readonly onVerificationChanged?: (session: VerificationSession) => void;
  readonly onError?: (error: Error) => void;
}

export interface MessagingAdapter {
  login(credentials: LoginCredentials): Promise<Session>;
  register(credentials: RegisterCredentials): Promise<Session>;
  start(session: Session, handlers: AdapterHandlers): Promise<void>;
  stop(): Promise<void>;
  logout(): Promise<void>;
  /** `upTo` says how many are wanted, for an adapter that asks the homeserver for a window rather than all. */
  listConversations(upTo?: number): Promise<readonly Conversation[]>;
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  joinConversation(conversationId: ConversationId, via?: readonly string[]): Promise<Conversation>;
  leaveConversation(conversationId: ConversationId): Promise<void>;
  inviteToConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation>;
  renameConversation(conversationId: ConversationId, title: string): Promise<Conversation>;
  removeFromConversation(conversationId: ConversationId, userId: UserId, reason?: string): Promise<Conversation>;
  banFromConversation(conversationId: ConversationId, userId: UserId, reason?: string): Promise<Conversation>;
  unbanFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation>;
  setConversationFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation>;
  listIgnoredUsers(): Promise<readonly UserId[]>;
  setIgnoredUsers(userIds: readonly UserId[]): Promise<void>;
  setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void>;
  setPresence(update: PresenceUpdate): Promise<void>;
  listMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage>;
  sendMessage(conversationId: ConversationId, body: string, options: SendContent): Promise<Message>;
  listThread(conversationId: ConversationId, rootId: MessageId): Promise<readonly Message[]>;
  searchMessages(query: string): Promise<readonly Message[]>;
  getPermissions(conversationId: ConversationId): Promise<ConversationPermissions>;
  setRole(conversationId: ConversationId, userId: UserId, role: ConversationRole): Promise<void>;
  rotateConversationKeys(conversationId: ConversationId): Promise<void>;
  upgradeConversation(conversationId: ConversationId): Promise<Conversation>;
  setConversationAlias(conversationId: ConversationId, alias: string): Promise<Conversation>;
  publishConversation(conversationId: ConversationId, listed: boolean): Promise<void>;
  discoverConversations(query: string | undefined): Promise<readonly PublicConversation[]>;
  reportMessage(conversationId: ConversationId, messageId: MessageId, reason: string): Promise<void>;
  setJoinRule(conversationId: ConversationId, rule: JoinRule): Promise<Conversation>;
  setHistoryVisibility(conversationId: ConversationId, visibility: HistoryVisibility): Promise<Conversation>;
  knockConversation(conversationId: ConversationId, options: KnockOptions): Promise<void>;
  setConversationTopic(conversationId: ConversationId, topic: string): Promise<Conversation>;
  setConversationAvatar(conversationId: ConversationId, image: AvatarImage): Promise<Conversation>;
  setConversationNotifications(conversationId: ConversationId, level: NotificationLevel): Promise<Conversation>;
  pinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  unpinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  listSpaces(): Promise<readonly Space[]>;
  createSpace(input: CreateSpaceInput): Promise<Space>;
  addToSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void>;
  removeFromSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void>;
  listSpaceConversations(spaceId: ConversationId): Promise<readonly Conversation[]>;
  sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message>;
  downloadAttachment(media: MediaRef): Promise<Uint8Array>;
  /** The homeserver asks, not this device: that way whoever publishes the link does not know who is looking. */
  previewLink(url: string): Promise<LinkPreview>;
  /** A poll: the question, its answers and the votes. Closing it is final. */
  startPoll(conversationId: ConversationId, input: StartPollInput): Promise<Poll>;
  voteInPoll(conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void>;
  closePoll(conversationId: ConversationId, pollId: MessageId): Promise<void>;
  listPolls(conversationId: ConversationId): Promise<readonly Poll[]>;
  /** Telling where somebody is while they move, for a while that ends on its own. */
  startLiveLocation(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation>;
  updateLiveLocation(sharingId: string, position: GeoLocation): Promise<void>;
  stopLiveLocation(sharingId: string): Promise<void>;
  listLiveLocations(conversationId: ConversationId): Promise<readonly LiveLocation[]>;
  getProfile(userId: UserId, conversationId?: ConversationId): Promise<User>;
  /** A size in pixels asks the server for a picture already that big, instead of the original. */
  getAvatar(userId: UserId, conversationId?: ConversationId, size?: number): Promise<AvatarImage | undefined>;
  /** Finds people by the name they go by, for whoever does not know their identifier. */
  searchUsers(query: string, limit: number): Promise<readonly User[]>;
  setDisplayName(displayName: string): Promise<void>;
  setAvatar(image: AvatarImage): Promise<void>;
  watchForKeyword(word: string): Promise<void>;
  stopWatchingForKeyword(word: string): Promise<void>;
  listKeywords(): Promise<readonly string[]>;
  registerPush(registration: PushRegistration): Promise<void>;
  listPushRegistrations(): Promise<readonly PushRegistration[]>;
  unregisterPush(deviceToken: string): Promise<void>;
  listDevices(): Promise<readonly Device[]>;
  renameDevice(deviceId: string, displayName: string): Promise<void>;
  signOutDevices(deviceIds: readonly string[], options: SignOutOptions): Promise<void>;
  editMessage(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message>;
  deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message>;
  markMessageRead(conversationId: ConversationId, messageId: MessageId, options?: MarkReadOptions): Promise<void>;
  /** Puts a conversation back to unread, or takes that mark off again. */
  setConversationUnread(conversationId: ConversationId, unread: boolean): Promise<Conversation>;
  /** What the homeserver is holding for this account, which is what a cold start has to show. */
  listPendingNotifications(limit: number): Promise<readonly Notification[]>;
  /** The threads of a conversation, so a list of them costs one request instead of one per thread. */
  listThreads(conversationId: ConversationId): Promise<readonly ThreadSummary[]>;
  /** People whose messages arrive but do not interrupt. Silencing is not ignoring. */
  listMutedUsers(): Promise<readonly UserId[]>;
  setUserMuted(userId: UserId, muted: boolean): Promise<void>;
  /** How much anything at all is allowed to interrupt, for the whole account. */
  getNotificationLevel(): Promise<NotificationLevel>;
  setNotificationLevel(level: NotificationLevel): Promise<void>;
  getReadReceipts(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]>;
  addReaction(conversationId: ConversationId, messageId: MessageId, key: string): Promise<Reaction>;
  removeReaction(conversationId: ConversationId, reactionId: string): Promise<void>;
  getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification | undefined>;
  setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void>;
  getCryptoStatus(): Promise<CryptoStatus>;
  getKeyBackupStatus(): Promise<KeyBackupStatus>;
  setupRecovery(options: RecoverySetupOptions): Promise<RecoverySetup>;
  recover(recoveryKey: string): Promise<KeyBackupRestoreSummary>;
  requestVerification(
    userId: string,
    deviceId?: string,
    options?: VerificationRequestOptions
  ): Promise<VerificationSession>;
  acceptVerification(sessionId: string): Promise<VerificationSession>;
  getVerificationQrCode(sessionId: string): Promise<Uint8Array | undefined>;
  scanVerificationQrCode(sessionId: string, code: Uint8Array): Promise<VerificationSession>;
  cancelVerification(sessionId: string): Promise<VerificationSession>;
  confirmVerification(sessionId: string): Promise<VerificationSession>;
  rejectVerification(sessionId: string): Promise<VerificationSession>;
}
