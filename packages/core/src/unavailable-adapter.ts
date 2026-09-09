import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type {
  Conversation,
  MediaRef,
  ConversationId,
  CreateConversationInput,
  CryptoStatus,
  DeviceVerification,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  MessagePage,
  Message,
  MessageId,
  Reaction,
  ReadReceipt,
  AvatarImage,
  RecoverySetup,
  Session,
  User,
  VerificationSession
} from "./models.js";

export class UnavailableAdapter implements MessagingAdapter {
  async login(): Promise<Session> {
    throw new SdkError("NOT_CONFIGURED", "A messaging adapter is required");
  }

  async start(): Promise<void> {}
  async stop(): Promise<void> {}
  async logout(): Promise<void> {}

  async listConversations(): Promise<readonly Conversation[]> {
    return [];
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", `Cannot create conversation for ${input.participantIds.length} participants`);
  }

  async joinConversation(conversationId: ConversationId): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", `Cannot join conversation ${conversationId}`);
  }

  async setTyping(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot update typing state");
  }

  async setPresence(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot update presence");
  }

  async listMessages(): Promise<readonly Message[]> {
    return [];
  }

  async loadMoreMessages(): Promise<MessagePage> {
    return { messages: [], hasMore: false };
  }

  async sendMessage(): Promise<Message> {
    throw new SdkError("NOT_CONFIGURED", "A messaging adapter is required");
  }

  async editMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message> {
    throw new SdkError("NOT_CONFIGURED", `Cannot edit ${messageId} in ${conversationId}`);
  }

  async deleteMessage(conversationId: ConversationId, messageId: MessageId): Promise<Message> {
    throw new SdkError("NOT_CONFIGURED", `Cannot delete ${messageId} in ${conversationId}`);
  }

  async markMessageRead(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot mark message as read");
  }

  async addReaction(): Promise<Reaction> {
    throw new SdkError("NOT_CONFIGURED", "Cannot add a reaction");
  }

  async removeReaction(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot remove a reaction");
  }

  async getDeviceVerification(): Promise<DeviceVerification | undefined> {
    throw new SdkError("NOT_CONFIGURED", "Cannot inspect device verification");
  }

  async setDeviceVerified(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot verify device");
  }

  async getCryptoStatus(): Promise<CryptoStatus> {
    throw new SdkError("NOT_CONFIGURED", "Cannot inspect crypto status");
  }

  async getKeyBackupStatus(): Promise<KeyBackupStatus> {
    throw new SdkError("NOT_CONFIGURED", "Cannot inspect key backup status");
  }

  async setupRecovery(): Promise<RecoverySetup> {
    throw new SdkError("NOT_CONFIGURED", "Cannot set up recovery");
  }

  async recover(): Promise<KeyBackupRestoreSummary> {
    throw new SdkError("NOT_CONFIGURED", "Cannot recover keys");
  }

  async sendAttachment(): Promise<Message> {
    throw new SdkError("NOT_CONFIGURED", "Cannot send attachment");
  }

  async downloadAttachment(_media: MediaRef): Promise<Uint8Array> {
    throw new SdkError("NOT_CONFIGURED", "Cannot download attachment");
  }

  async getReadReceipts(): Promise<readonly ReadReceipt[]> {
    return [];
  }

  async leaveConversation(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot leave a conversation");
  }

  async inviteToConversation(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot invite to a conversation");
  }

  async renameConversation(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot rename a conversation");
  }

  async getProfile(): Promise<User> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read a profile");
  }

  async getAvatar(): Promise<AvatarImage | undefined> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read an avatar");
  }

  async requestVerification(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot request verification");
  }

  async acceptVerification(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot accept verification");
  }

  async cancelVerification(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot cancel verification");
  }

  async confirmVerification(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot confirm verification");
  }

  async rejectVerification(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot reject verification");
  }
}
