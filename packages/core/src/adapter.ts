import type {
  AvatarImage,
  SendContent,
  MessagePage,
  Call,
  CallSpeaking,
  Notification,
  User,
  UserId,
  Conversation,
  ConversationId,
  CreateConversationInput,
  Message,
  Reaction,
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
  SpacesAdapter,
  ConversationSettingsAdapter,
  EditingAdapter,
  IgnoringAdapter,
  ModerationAdapter,
  PinsAdapter,
  PresenceAdapter,
  ReceiptsAdapter,
  SearchAdapter,
  SsoAdapter,
  ThreadsAdapter
} from "./capabilities.js";

export interface MessagingAdapter {
  /** Deciding who may be in a conversation and what they may do in it. Absent when this adapter cannot. */
  /** Signing in somewhere else and coming back. Absent when this adapter cannot. */
  readonly sso?: SsoAdapter;
  readonly moderation?: ModerationAdapter;

  /** What a conversation is called, what it looks like, who may come in and how far back they can read. Absent when this adapter cannot. */
  readonly conversationSettings?: ConversationSettingsAdapter;

  /** Answers that hang from a message instead of filling the conversation. Absent when this adapter cannot. */
  readonly threads?: ThreadsAdapter;

  /** Messages kept to hand in a conversation. Absent when this adapter cannot. */
  readonly pins?: PinsAdapter;

  /** Who has read how far. Absent when this adapter cannot. */
  readonly receipts?: ReceiptsAdapter;

  /** Looking for something that was said, somebody, or somewhere to join. Absent when this adapter cannot. */
  readonly search?: SearchAdapter;

  /** Whether somebody is about, and whether they are writing. Absent when this adapter cannot. */
  readonly presence?: PresenceAdapter;

  /** Changing or taking back something already said. Absent when this adapter cannot. */
  readonly editing?: EditingAdapter;

  /** Not hearing from somebody any more. Absent when this adapter cannot. */
  readonly ignoring?: IgnoringAdapter;

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
  listMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage>;
  sendMessage(conversationId: ConversationId, body: string, options: SendContent): Promise<Message>;
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
  setDisplayName(displayName: string): Promise<void>;
  setAvatar(image: AvatarImage): Promise<void>;
}

// The optional halves are handed on from here: a backend is one thing to whoever writes one, however many
// files it is written in.
export type {
  CallingAdapter,
  ConversationSettingsAdapter,
  EditingAdapter,
  IgnoringAdapter,
  ModerationAdapter,
  PinsAdapter,
  PresenceAdapter,
  ReceiptsAdapter,
  SearchAdapter,
  SsoAdapter,
  ThreadsAdapter,
  CryptoAdapter,
  DevicesAdapter,
  LocationAdapter,
  MediaAdapter,
  PollsAdapter,
  PushAdapter,
  ReactionsAdapter,
  SpacesAdapter
} from "./capabilities.js";
