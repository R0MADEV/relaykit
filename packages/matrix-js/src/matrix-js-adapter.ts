import type {
  AvatarImage,
  MediaRef,
  ReadReceipt,
  User,
  FileInput,
  AdapterHandlers,
  MessagingAdapter,
  Conversation,
  ConversationId,
  CreateConversationInput,
  Message,
  Session,
  LoginCredentials,
  Reaction,
  DeviceVerification,
  CryptoStatus,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  MessagePage,
  PresenceUpdate,
  RecoverySetup,
  RecoverySetupOptions,
  VerificationSession
} from "@relaykit/core";
import { loginWithPassword } from "./matrix-auth.js";
import type { MatrixJsAdapterOptions } from "./types.js";
import { deleteMatrixMessage, editMatrixMessage, findMessage } from "./matrix-message-mutations.js";
import { addMatrixReaction, removeMatrixReaction } from "./matrix-reactions.js";
import { listMatrixMessages } from "./matrix-timeline.js";
import {
  getCryptoStatus,
  getDeviceVerification,
  getKeyBackupStatus,
  recoverWithKey,
  setDeviceVerified,
  setupRecovery
} from "./matrix-security.js";
import {
  createConversation,
  joinConversation,
  listMatrixConversations,
  loadMoreMessages,
  sendMessage
} from "./matrix-room-operations.js";
import { MatrixRuntime } from "./matrix-runtime.js";
import {
  inviteToMatrixConversation,
  leaveMatrixConversation,
  renameMatrixConversation
} from "./matrix-conversations.js";
import { downloadMatrixAttachment, sendMatrixAttachment } from "./matrix-media.js";
import { getMatrixAvatar, getMatrixProfile } from "./matrix-profiles.js";
import { withTranslatedErrors } from "./matrix-errors.js";

export class MatrixJsAdapter implements MessagingAdapter {
  private readonly runtime: MatrixRuntime;

  constructor(options: MatrixJsAdapterOptions = {}) {
    this.runtime = new MatrixRuntime(options);
  }

  async login(credentials: LoginCredentials): Promise<Session> {
    return this.run(() => loginWithPassword(credentials));
  }

  async start(session: Session, handlers: AdapterHandlers): Promise<void> {
    await this.run(() => this.runtime.start(session, handlers));
  }

  async stop(): Promise<void> {
    await this.runtime.stop();
  }

  async logout(): Promise<void> {
    await this.run(() => this.runtime.logout());
  }

  async listConversations(): Promise<readonly Conversation[]> {
    return this.run(async () => listMatrixConversations(this.runtime.getClient()));
  }

  async joinConversation(conversationId: ConversationId): Promise<Conversation> {
    return this.run(() => joinConversation(this.runtime.getClient(), conversationId));
  }

  async leaveConversation(conversationId: ConversationId): Promise<void> {
    await this.run(() => leaveMatrixConversation(this.runtime.getClient(), conversationId));
  }

  async inviteToConversation(conversationId: ConversationId, userId: string): Promise<Conversation> {
    return this.run(() => inviteToMatrixConversation(this.runtime.getClient(), conversationId, userId));
  }

  async renameConversation(conversationId: ConversationId, title: string): Promise<Conversation> {
    return this.run(() => renameMatrixConversation(this.runtime.getClient(), conversationId, title));
  }

  async setTyping(conversationId: ConversationId, isTyping: boolean, timeoutMs: number): Promise<void> {
    await this.run(() => this.runtime.getClient().sendTyping(conversationId, isTyping, timeoutMs));
  }

  async setPresence(update: PresenceUpdate): Promise<void> {
    await this.run(() => this.runtime.getClient().setPresence({
      presence: update.presence,
      ...(update.statusMessage ? { status_msg: update.statusMessage } : {})
    }));
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    return this.run(() => createConversation(this.runtime.getClient(), input));
  }

  async listMessages(conversationId: ConversationId): Promise<readonly Message[]> {
    return this.run(() => listMatrixMessages(this.runtime.getClient(), conversationId));
  }

  async loadMoreMessages(conversationId: ConversationId, limit: number): Promise<MessagePage> {
    return this.run(() => loadMoreMessages(this.runtime.getClient(), conversationId, limit));
  }

  async sendMessage(conversationId: ConversationId, body: string, transactionId?: string, replyToId?: string): Promise<Message> {
    return this.run(() => sendMessage(this.runtime.getClient(), conversationId, body, transactionId, replyToId));
  }

  sendAttachment(
    conversationId: ConversationId,
    file: FileInput,
    transactionId?: string,
    onProgress?: (fraction: number) => void
  ): Promise<Message> {
    return this.run(() => sendMatrixAttachment(this.runtime.getClient(), conversationId, file, transactionId, onProgress));
  }

  getProfile(userId: string): Promise<User> {
    return this.run(() => getMatrixProfile(this.runtime.getClient(), userId));
  }

  getAvatar(userId: string): Promise<AvatarImage | undefined> {
    return this.run(() => getMatrixAvatar(this.runtime.getClient(), userId));
  }

  downloadAttachment(media: MediaRef): Promise<Uint8Array> {
    return this.run(() => downloadMatrixAttachment(this.runtime.getClient(), media));
  }

  async editMessage(conversationId: ConversationId, messageId: string, body: string): Promise<Message> {
    const client = this.runtime.getClient();
    const message = findMessage(await this.listMessages(conversationId), messageId);
    return this.run(() => editMatrixMessage(client, conversationId, message, body));
  }

  async deleteMessage(conversationId: ConversationId, messageId: string): Promise<Message> {
    const client = this.runtime.getClient();
    const message = findMessage(await this.listMessages(conversationId), messageId);
    return this.run(() => deleteMatrixMessage(client, conversationId, message));
  }

  async getReadReceipts(conversationId: ConversationId, messageId: string): Promise<readonly ReadReceipt[]> {
    return this.run(async () => {
      const room = this.runtime.getClient().getRoom(conversationId);
      const event = room?.findEventById(messageId);
      if (!room || !event) return [];
      return room.getReceiptsForEvent(event)
        .filter(receipt => receipt.type === "m.read")
        .map(receipt => ({
          conversationId,
          messageId,
          userId: receipt.userId,
          readAt: typeof receipt.data?.ts === "number" ? receipt.data.ts : Date.now()
        }));
    });
  }

  async markMessageRead(conversationId: ConversationId, messageId: string): Promise<void> {
    const event = this.runtime.getClient().getRoom(conversationId)?.findEventById(messageId);
    if (!event) {
      throw new Error("The message does not exist");
    }
    await this.run(() => this.runtime.getClient().sendReadReceipt(event));
  }

  async addReaction(conversationId: ConversationId, messageId: string, key: string): Promise<Reaction> {
    return this.run(() => addMatrixReaction(this.runtime.getClient(), conversationId, messageId, key));
  }

  async removeReaction(conversationId: ConversationId, reactionId: string): Promise<void> {
    await this.run(() => removeMatrixReaction(this.runtime.getClient(), conversationId, reactionId));
  }

  async getDeviceVerification(userId: string, deviceId: string): Promise<DeviceVerification | undefined> {
    return getDeviceVerification(this.runtime.getClient(), userId, deviceId);
  }

  async setDeviceVerified(userId: string, deviceId: string, verified: boolean): Promise<void> {
    await this.run(() => setDeviceVerified(this.runtime.getClient(), userId, deviceId, verified));
  }

  async getCryptoStatus(): Promise<CryptoStatus> {
    return getCryptoStatus(this.runtime.getClient());
  }

  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    return getKeyBackupStatus(this.runtime.getClient());
  }

  async setupRecovery(options: RecoverySetupOptions): Promise<RecoverySetup> {
    return this.run(() => setupRecovery(this.runtime.getClient(), this.runtime.secretStorageKeys, options));
  }

  async recover(recoveryKey: string): Promise<KeyBackupRestoreSummary> {
    return this.run(() => recoverWithKey(this.runtime.getClient(), this.runtime.secretStorageKeys, recoveryKey));
  }

  requestVerification(userId: string, deviceId?: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.request(userId, deviceId));
  }

  acceptVerification(sessionId: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.accept(sessionId));
  }

  cancelVerification(sessionId: string): Promise<VerificationSession> {
    return this.runtime.verification.cancel(sessionId);
  }

  confirmVerification(sessionId: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.confirm(sessionId));
  }

  rejectVerification(sessionId: string): Promise<VerificationSession> {
    return this.run(() => this.runtime.verification.reject(sessionId));
  }

  /** Single exit point for homeserver errors, so Matrix details never reach the public API. */
  private run<Result>(operation: () => Promise<Result>): Promise<Result> {
    return withTranslatedErrors(operation);
  }
}
