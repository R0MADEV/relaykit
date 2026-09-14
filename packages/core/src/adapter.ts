import type {
  AvatarImage,
  ConversationPermissions,
  SendContent,
  ConversationRole,
  Participant,
  NotificationLevel,
  MessagePage,
  Call,
  CallSpeaking,
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
  PresenceUpdate,
  ReadReceipt,
  TypingUpdate,
  UserPresence,
  VerificationSession,
  Session,
  LoginCredentials,
  RegisterCredentials,
  ConnectionStatus,
  SyncStatus
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
  readonly onCallIncoming?: (call: Call) => void;
  readonly onCallChanged?: (call: Call) => void;
  readonly onCallSpeaking?: (speaking: CallSpeaking) => void;
  readonly onVerificationRequested?: (session: VerificationSession) => void;
  readonly onVerificationChanged?: (session: VerificationSession) => void;
  readonly onError?: (error: Error) => void;
}

import type {
  CallingAdapter,
  CryptoAdapter,
  DevicesAdapter,
  LocationAdapter,
  MediaAdapter,
  PollsAdapter,
  PushAdapter,
  ReactionsAdapter,
  SpacesAdapter
} from "./capabilities.js";

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
  removeFromConversation(
    conversationId: ConversationId,
    userId: UserId,
    reason?: string
  ): Promise<Conversation>;
  banFromConversation(conversationId: ConversationId, userId: UserId, reason?: string): Promise<Conversation>;
  unbanFromConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation>;
  setConversationFavourite(conversationId: ConversationId, favourite: boolean): Promise<Conversation>;
  listIgnoredUsers(): Promise<readonly UserId[]>;
  setIgnoredUsers(userIds: readonly UserId[]): Promise<void>;
  setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void>;
  setPresence(update: PresenceUpdate): Promise<void>;
  /** What somebody is doing, asked for. Nothing when the homeserver has never heard anything about them. */
  getPresence(userId: UserId): Promise<UserPresence | undefined>;
  listMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage>;
  sendMessage(conversationId: ConversationId, body: string, options: SendContent): Promise<Message>;
  listThread(conversationId: ConversationId, rootId: MessageId): Promise<readonly Message[]>;
  searchMessages(query: string): Promise<readonly Message[]>;
  getPermissions(conversationId: ConversationId): Promise<ConversationPermissions>;
  setRole(conversationId: ConversationId, userId: UserId, role: ConversationRole): Promise<void>;
  /** Everybody the conversation knows about and what each of them is in it, for moderating it. */
  listParticipants(conversationId: ConversationId): Promise<readonly Participant[]>;
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
  setConversationNotifications(
    conversationId: ConversationId,
    level: NotificationLevel
  ): Promise<Conversation>;
  pinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  unpinMessage(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  listPinnedMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  /**
   * Conferences, when there are any. Absent when the protocol or the homeserver cannot hold one, which is
   * a thing an application has to be able to find out without asking and being refused.
   */
  readonly calling?: CallingAdapter;
  /** Polls: the question, its answers and the votes. Closing one is final. Absent when this adapter cannot. */
  readonly polls?: PollsAdapter;
  /** Telling where somebody is while they say so, which always ends on its own. Absent when this adapter cannot. */
  readonly location?: LocationAdapter;
  /** Grouping conversations, for organising them by team or by project. Absent when this adapter cannot. */
  readonly spaces?: SpacesAdapter;
  /** Carrying files: sending them, fetching them back, and what the homeserver will take. Absent when this adapter cannot. */
  readonly media?: MediaAdapter;
  /** Being told while the application is not running, and the words worth being told about. Absent when this adapter cannot. */
  readonly push?: PushAdapter;
  /** The other devices this account is signed in on. Absent when this adapter cannot. */
  readonly devices?: DevicesAdapter;
  /** A small answer to a message that is not a message of its own. Absent when this adapter cannot. */
  readonly reactions?: ReactionsAdapter;
  /** Keys, backups and proving a device is who it says it is. Absent when this adapter cannot. */
  readonly crypto?: CryptoAdapter;
  getProfile(userId: UserId, conversationId?: ConversationId): Promise<User>;
  /** A size in pixels asks the server for a picture already that big, instead of the original. */
  getAvatar(userId: UserId, conversationId?: ConversationId, size?: number): Promise<AvatarImage | undefined>;
  /** Finds people by the name they go by, for whoever does not know their identifier. */
  searchUsers(query: string, limit: number): Promise<readonly User[]>;
  setDisplayName(displayName: string): Promise<void>;
  setAvatar(image: AvatarImage): Promise<void>;
  editMessage(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message>;
  deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message>;
  markMessageRead(
    conversationId: ConversationId,
    messageId: MessageId,
    options?: MarkReadOptions
  ): Promise<void>;
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
}

// The optional halves are handed on from here: a backend is one thing to whoever writes one, however many
// files it is written in.
export type {
  CallingAdapter,
  CryptoAdapter,
  DevicesAdapter,
  LocationAdapter,
  MediaAdapter,
  PollsAdapter,
  PushAdapter,
  ReactionsAdapter,
  SpacesAdapter
} from "./capabilities.js";
