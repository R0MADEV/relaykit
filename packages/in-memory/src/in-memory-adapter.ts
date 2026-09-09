import type {
  AdapterHandlers,
  MessagingAdapter
} from "@relaykit/core";
import type {
  Attachment,
  ConnectionStatus,
  AvatarImage,
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
  Reaction,
  DeviceVerification,
  CryptoStatus,
  PresenceUpdate,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  LoginCredentials,
  RecoverySetup,
  Message,
  Session,
  UserId,
  VerificationSession
} from "@relaykit/core";
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
  private nextMessageId = 1;
  private nextConversationId = 1;
  private nextAttachmentId = 1;
  private readonly unreadCounts = new Map<ConversationId, number>();
  private readonly profiles = new Map<UserId, { displayName?: string; avatar?: AvatarImage }>();
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
    this.handlers = handlers;
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
    return this.conversations.map(conversation => ({
      ...conversation,
      unreadCount: this.unreadCounts.get(conversation.id) ?? 0
    }));
  }

  /** Test helper: simulates a message arriving from another participant. */
  receiveMessage(conversationId: ConversationId, senderId: UserId, body: string): Message {
    const message: Message = {
      id: `memory-message-${this.nextMessageId++}`,
      conversationId,
      senderId,
      body,
      createdAt: Date.now(),
      status: "sent"
    };
    this.unreadCounts.set(conversationId, (this.unreadCounts.get(conversationId) ?? 0) + 1);
    const appended = this.appendMessage(message);
    const ownUserId = this.currentUserId;
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
    return this.replaceConversation({ ...conversation, participantIds, invitedIds });
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
    this.handlers.onConversationUpdated?.(conversation);
    return conversation;
  }

  async setTyping(conversationId: ConversationId, isTyping: boolean): Promise<void> {
    return this.features.setTyping(conversationId, isTyping);
  }

  async setPresence(_update: PresenceUpdate): Promise<void> {
    return this.features.setPresence(_update);
  }

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.messages.filter(message => message.conversationId === conversationId);
  }

  async loadMoreMessages(conversationId: ConversationId, _limit: number): Promise<MessagePage> {
    // There is no remote history behind this adapter, so the local timeline is always complete.
    return { messages: await this.listMessages(conversationId), hasMore: false };
  }

  async sendMessage(conversationId: ConversationId, body: string, transactionId?: string, replyToId?: MessageId): Promise<Message> {
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
      ...(replyToId ? { replyToId } : {})
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
      ...(transactionId ? { transactionId } : {})
    });
  }

  /** Test helper: gives a user a display name and an avatar. */
  setProfile(userId: UserId, profile: { displayName?: string; avatar?: AvatarImage }): void {
    this.profiles.set(userId, profile);
  }

  async getProfile(userId: UserId): Promise<User> {
    const profile = this.profiles.get(userId);
    return {
      id: userId,
      ...(profile?.displayName ? { displayName: profile.displayName } : {}),
      ...(profile?.avatar ? { avatarId: `memory-avatar-${userId}` } : {})
    };
  }

  async getAvatar(userId: UserId): Promise<AvatarImage | undefined> {
    return this.profiles.get(userId)?.avatar;
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

  async markMessageRead(conversationId: ConversationId, messageId: MessageId): Promise<void> {
    this.unreadCounts.set(conversationId, 0);
    const conversation = this.conversations.find(item => item.id === conversationId);
    if (conversation) this.handlers.onConversationUpdated?.({ ...conversation, unreadCount: 0 });
    return this.features.markMessageRead(conversationId, messageId);
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

  async requestVerification(userId: string, deviceId?: string): Promise<VerificationSession> {
    return this.verification.request(userId, deviceId);
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
