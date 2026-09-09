import { EventBus, type ClientEventMap, type EventListener, type EventName } from "./events.js";
import { ClientLifecycle } from "./client-lifecycle.js";
import { ConversationOperations } from "./conversation-operations.js";
import { CryptoOperations } from "./crypto-operations.js";
import { DeviceOperations } from "./device-operations.js";
import { MessageMutations } from "./message-mutations.js";
import { MessageOperations, type MessageOperationsContext } from "./message-operations.js";
import { PresenceOperations } from "./presence-operations.js";
import { VerificationOperations } from "./verification-operations.js";
import { MediaOperations } from "./media-operations.js";
import { UserOperations } from "./user-operations.js";
import { ReactionOperations } from "./reaction-operations.js";
import { UnavailableAdapter } from "./unavailable-adapter.js";
import type { MessagingClientConfig } from "./client-config.js";
import type {
  AvatarImage,
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
  Message,
  MessageId,
  MessagePage,
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

export class MessagingClient {
  readonly conversations = {
    list: (): Promise<readonly Conversation[]> => this.conversationOperations.list(),
    create: (input: CreateConversationInput): Promise<Conversation> => this.conversationOperations.create(input),
    join: (conversationId: ConversationId, options?: JoinConversationOptions): Promise<Conversation> =>
      this.conversationOperations.join(conversationId, options),
    open: (userId: string): Promise<Conversation> => this.conversationOperations.open(userId),
    leave: (conversationId: ConversationId): Promise<void> => this.conversationOperations.leave(conversationId),
    invite: (conversationId: ConversationId, userId: string): Promise<Conversation> =>
      this.conversationOperations.invite(conversationId, userId),
    rename: (conversationId: ConversationId, title: string): Promise<Conversation> =>
      this.conversationOperations.rename(conversationId, title),
    findDirect: (userId: string): Promise<Conversation | undefined> => this.conversationOperations.findDirect(userId),
    search: (query: string): Promise<readonly Conversation[]> => this.conversationOperations.search(query),
    typing: (conversationId: ConversationId, isTyping: boolean, timeoutMs = 5000): Promise<void> =>
      this.conversationOperations.typing(conversationId, isTyping, timeoutMs)
  };

  readonly messages = {
    list: (id: ConversationId): Promise<readonly Message[]> => this.messageOperations.listMessages(id),
    loadMore: (id: ConversationId, limit = 20): Promise<MessagePage> => this.messageOperations.loadMoreMessages(id, limit),
    search: (query: string, options?: MessageSearchOptions): Promise<readonly Message[]> => this.messageOperations.search(query, options),
    send: (id: ConversationId, body: string, options?: SendMessageOptions): Promise<Message> =>
      this.messageOperations.sendMessage(id, body, options),
    sendFile: (id: ConversationId, file: FileInput, options?: SendFileOptions): Promise<Message> =>
      this.messageOperations.sendFile(id, file, options),
    retry: (id: MessageId): Promise<Message> => this.messageOperations.retryMessage(id),
    cancel: (id: MessageId): Promise<Message> => this.messageOperations.cancelMessage(id),
    markRead: (conversationId: ConversationId, messageId: MessageId): Promise<void> => this.messageOperations.markRead(conversationId, messageId),
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
    verify: (userId: string, deviceId: string) => this.deviceOperations.verify(userId, deviceId)
  };
  readonly crypto = {
    status: () => this.cryptoOperations.status(),
    backupStatus: () => this.cryptoOperations.backupStatus(),
    setupRecovery: (options?: RecoverySetupOptions) => this.cryptoOperations.setupRecovery(options),
    recover: (recoveryKey: string) => this.cryptoOperations.recover(recoveryKey)
  };
  readonly presence = { set: (update: PresenceUpdate): Promise<void> => this.presenceOperations.set(update) };
  readonly users = {
    profile: (userId: string): Promise<User> => this.userOperations.profile(userId),
    avatar: (userId: string): Promise<AvatarImage | undefined> => this.userOperations.avatar(userId)
  };
  readonly media = {
    download: (media: MediaRef): Promise<Uint8Array> => this.mediaOperations.download(media)
  };
  readonly verification = {
    request: (userId: string, deviceId?: string) => this.verificationOperations.request(userId, deviceId),
    accept: (sessionId: string) => this.verificationOperations.accept(sessionId),
    cancel: (sessionId: string) => this.verificationOperations.cancel(sessionId),
    confirm: (sessionId: string) => this.verificationOperations.confirm(sessionId),
    reject: (sessionId: string) => this.verificationOperations.reject(sessionId)
  };

  private readonly events = new EventBus();
  private readonly messageOperations: MessageOperations;
  private readonly messageMutations: MessageMutations;
  private readonly conversationOperations: ConversationOperations;
  private readonly reactionOperations: ReactionOperations;
  private readonly deviceOperations: DeviceOperations;
  private readonly cryptoOperations: CryptoOperations;
  private readonly presenceOperations: PresenceOperations;
  private readonly verificationOperations: VerificationOperations;
  private readonly mediaOperations: MediaOperations;
  private readonly userOperations: UserOperations;
  private readonly lifecycle: ClientLifecycle;
  private session: Session | undefined;

  constructor(config: MessagingClientConfig) {
    const adapter = config.adapter ?? new UnavailableAdapter();
    const base = {
      adapter,
      assertStarted: () => this.lifecycle.assertStarted(),
      emitError: (error: unknown) => this.emitError(error)
    };
    const messageContext: MessageOperationsContext = {
      ...base,
      getSession: () => this.session,
      emitMessageUpdated: message => this.events.emit("message.updated", message),
      cachedMessagesPerConversation: config.cache?.messagesPerConversation ?? defaultCachedMessages,
      ...(config.storage ? { storage: config.storage } : {})
    };
    this.messageOperations = new MessageOperations(messageContext);
    const storageContext = config.storage ? { storage: config.storage } : {};
    this.messageMutations = new MessageMutations({ ...base, ...storageContext, emitUpdated: message => this.events.emit("message.updated", message) });
    this.conversationOperations = new ConversationOperations({
      ...base,
      ...storageContext,
      getSession: () => this.session,
      emitUpdated: conversation => this.events.emit("conversation.updated", conversation)
    });
    this.reactionOperations = new ReactionOperations(base);
    this.deviceOperations = new DeviceOperations(base);
    this.cryptoOperations = new CryptoOperations(base);
    this.presenceOperations = new PresenceOperations(base);
    this.verificationOperations = new VerificationOperations(base);
    this.mediaOperations = new MediaOperations(base);
    this.userOperations = new UserOperations(base);
    this.session = config.session;
    this.lifecycle = new ClientLifecycle({
      adapter,
      getSession: () => this.session,
      setSession: session => { this.session = session; },
      flushPending: () => this.messageOperations.flushPending(),
      purgeStorage: async () => { await config.storage?.clear(); },
      handlers: {
        onConversationUpdated: conversation => this.events.emit("conversation.updated", conversation),
        onMessageReceived: message => this.messageOperations.receiveMessage(message),
        onMessageUpdated: message => this.messageOperations.updateMessage(message),
        onReactionAdded: reaction => this.events.emit("reaction.added", reaction),
        onReactionRemoved: reaction => this.events.emit("reaction.removed", reaction),
        onTypingChanged: update => this.events.emit("typing.changed", update),
        onReceiptReceived: receipt => this.events.emit("receipt.received", receipt),
        onPresenceChanged: presence => this.events.emit("presence.changed", presence),
        onNotification: notification => this.events.emit("notification", notification),
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
  start(): Promise<void> { return this.lifecycle.start(); }
  stop(): Promise<void> { this.messageOperations.clear(); return this.lifecycle.stop(); }
  logout(): Promise<void> { this.messageOperations.clear(); return this.lifecycle.logout(); }
  on<Name extends EventName>(name: Name, listener: EventListener<Name>): () => void { return this.events.on(name, listener); }
  getConnectionStatus(): ConnectionStatus { return this.lifecycle.getConnectionStatus(); }
  getSyncStatus(): SyncStatus { return this.lifecycle.getSyncStatus(); }

  private emitError(error: unknown): void {
    this.events.emit("error", error instanceof Error ? error : new Error(String(error)));
  }
}

export type ClientEvents = ClientEventMap;
