import type {
  AvatarImage,
  MediaRef,
  FileInput,
  MessagePage,
  Notification,
  User,
  UserId,
  Conversation,
  ConversationId,
  CreateConversationInput,
  Message,
  MessageId,
  Reaction,
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
  VerificationSession,
  Session,
  LoginCredentials,
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
  readonly onVerificationRequested?: (session: VerificationSession) => void;
  readonly onVerificationChanged?: (session: VerificationSession) => void;
  readonly onError?: (error: Error) => void;
}

export interface MessagingAdapter {
  login(credentials: LoginCredentials): Promise<Session>;
  start(session: Session, handlers: AdapterHandlers): Promise<void>;
  stop(): Promise<void>;
  logout(): Promise<void>;
  listConversations(): Promise<readonly Conversation[]>;
  createConversation(input: CreateConversationInput): Promise<Conversation>;
  joinConversation(conversationId: ConversationId, via?: readonly string[]): Promise<Conversation>;
  leaveConversation(conversationId: ConversationId): Promise<void>;
  inviteToConversation(conversationId: ConversationId, userId: UserId): Promise<Conversation>;
  renameConversation(conversationId: ConversationId, title: string): Promise<Conversation>;
  setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void>;
  setPresence(update: PresenceUpdate): Promise<void>;
  listMessages(conversationId: ConversationId): Promise<readonly Message[]>;
  loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage>;
  sendMessage(conversationId: ConversationId, body: string, transactionId?: string, replyToId?: MessageId): Promise<Message>;
  sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message>;
  downloadAttachment(media: MediaRef): Promise<Uint8Array>;
  getProfile(userId: UserId): Promise<User>;
  getAvatar(userId: UserId): Promise<AvatarImage | undefined>;
  editMessage(conversationId: ConversationId, messageId: MessageId, body: string): Promise<Message>;
  deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message>;
  markMessageRead(conversationId: ConversationId, messageId: MessageId): Promise<void>;
  getReadReceipts(conversationId: ConversationId, messageId: MessageId): Promise<readonly ReadReceipt[]>;
  addReaction(conversationId: ConversationId, messageId: MessageId, key: string): Promise<Reaction>;
  removeReaction(conversationId: ConversationId, reactionId: string): Promise<void>;
  getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification | undefined>;
  setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void>;
  getCryptoStatus(): Promise<CryptoStatus>;
  getKeyBackupStatus(): Promise<KeyBackupStatus>;
  setupRecovery(options: RecoverySetupOptions): Promise<RecoverySetup>;
  recover(recoveryKey: string): Promise<KeyBackupRestoreSummary>;
  requestVerification(userId: string, deviceId?: string): Promise<VerificationSession>;
  acceptVerification(sessionId: string): Promise<VerificationSession>;
  cancelVerification(sessionId: string): Promise<VerificationSession>;
  confirmVerification(sessionId: string): Promise<VerificationSession>;
  rejectVerification(sessionId: string): Promise<VerificationSession>;
}
