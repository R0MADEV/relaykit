import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type {
  Conversation,
  ConversationPermissions,
  MediaRef,
  Space,
  ConversationId,
  CreateConversationInput,
  CryptoStatus,
  Device,
  DeviceVerification,
  KeyBackupRestoreSummary,
  KeyBackupStatus,
  MessagePage,
  Message,
  MessageId,
  PublicConversation,
  Reaction,
  PushRegistration,
  ReadReceipt,
  AvatarImage,
  RecoverySetup,
  Session,
  User,
  VerificationSession,
  Notification,
  ThreadSummary,
  NotificationLevel,
  UserId,
  LinkPreview,
  Poll,
  LiveLocation
} from "./models.js";

export class UnavailableAdapter implements MessagingAdapter {
  async register(): Promise<Session> {
    throw new SdkError("NOT_CONFIGURED", "Cannot register without an adapter");
  }

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

  async setConversationTopic(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot set a description");
  }

  async setConversationAvatar(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot set a picture");
  }

  async setConversationNotifications(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot change notifications");
  }

  async pinMessage(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot pin a message");
  }

  async unpinMessage(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot unpin a message");
  }

  async listPinnedMessages(): Promise<readonly Message[]> {
    return [];
  }

  async listSpaces(): Promise<readonly Space[]> {
    return [];
  }

  async createSpace(): Promise<Space> {
    throw new SdkError("NOT_CONFIGURED", "Cannot create a space");
  }

  async addToSpace(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot add to a space");
  }

  async removeFromSpace(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot take anything out of a space");
  }

  async listSpaceConversations(): Promise<readonly Conversation[]> {
    return [];
  }

  async listThread(): Promise<readonly Message[]> {
    return [];
  }

  async searchMessages(): Promise<readonly Message[]> {
    return [];
  }

  async getPermissions(): Promise<ConversationPermissions> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read permissions");
  }

  async setRole(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot change a role");
  }

  async removeFromConversation(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot remove anybody");
  }

  async banFromConversation(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot ban anybody");
  }

  async unbanFromConversation(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot lift a ban");
  }

  async setConversationFavourite(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot mark a conversation");
  }

  async listIgnoredUsers(): Promise<readonly string[]> {
    return [];
  }

  async setIgnoredUsers(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot ignore anybody");
  }

  async setDisplayName(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot change the display name");
  }

  async setAvatar(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot change the avatar");
  }

  async rotateConversationKeys(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot change the key of a conversation");
  }

  async upgradeConversation(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot replace a conversation");
  }

  async setConversationAlias(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot name a conversation");
  }

  async publishConversation(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot list a conversation");
  }

  async discoverConversations(): Promise<readonly PublicConversation[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot look for conversations");
  }

  async reportMessage(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot report a message");
  }

  async setJoinRule(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot decide who may come in");
  }

  async setHistoryVisibility(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot decide how far back people can read");
  }

  async knockConversation(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot ask to come in");
  }

  async watchForKeyword(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot watch for a word");
  }

  async stopWatchingForKeyword(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot stop watching for a word");
  }

  async listKeywords(): Promise<readonly string[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read the words being watched for");
  }

  async registerPush(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot ask to be notified");
  }

  async listPushRegistrations(): Promise<readonly PushRegistration[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read the push registrations");
  }

  async unregisterPush(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot stop being notified");
  }

  async listDevices(): Promise<readonly Device[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot list devices");
  }

  async renameDevice(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot rename a device");
  }

  async signOutDevices(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot sign devices out");
  }

  async getProfile(): Promise<User> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read a profile");
  }

  async getAvatar(): Promise<AvatarImage | undefined> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read an avatar");
  }

  async startLiveLocation(): Promise<LiveLocation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot share where somebody is");
  }

  async updateLiveLocation(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot update where somebody is");
  }

  async stopLiveLocation(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot stop sharing where somebody is");
  }

  async listLiveLocations(): Promise<readonly LiveLocation[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot list who is sharing where they are");
  }

  async startPoll(): Promise<Poll> {
    throw new SdkError("NOT_CONFIGURED", "Cannot start a poll");
  }

  async voteInPoll(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot vote in a poll");
  }

  async closePoll(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot close a poll");
  }

  async listPolls(): Promise<readonly Poll[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot list polls");
  }

  async previewLink(): Promise<LinkPreview> {
    throw new SdkError("NOT_CONFIGURED", "Cannot preview a link");
  }

  async searchUsers(): Promise<readonly User[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot look for people");
  }

  async setConversationUnread(): Promise<Conversation> {
    throw new SdkError("NOT_CONFIGURED", "Cannot mark a conversation as unread");
  }

  async listPendingNotifications(): Promise<readonly Notification[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot ask what is waiting");
  }

  async listThreads(): Promise<readonly ThreadSummary[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot list threads");
  }

  async listMutedUsers(): Promise<readonly UserId[]> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read who is silenced");
  }

  async setUserMuted(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot silence anybody");
  }

  async getNotificationLevel(): Promise<NotificationLevel> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read how much anything interrupts");
  }

  async setNotificationLevel(): Promise<void> {
    throw new SdkError("NOT_CONFIGURED", "Cannot change how much anything interrupts");
  }

  async requestVerification(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot request verification");
  }

  async getVerificationQrCode(): Promise<Uint8Array | undefined> {
    throw new SdkError("NOT_CONFIGURED", "Cannot show a verification code");
  }

  async scanVerificationQrCode(): Promise<VerificationSession> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read a verification code");
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
