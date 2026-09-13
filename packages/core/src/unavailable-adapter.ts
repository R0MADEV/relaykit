import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type {
  Conversation,
  ConversationPermissions,
  ConversationId,
  CreateConversationInput,
  MessagePage,
  Message,
  MessageId,
  PublicConversation,
  ReadReceipt,
  AvatarImage,
  Session,
  User,
  Notification,
  ThreadSummary,
  NotificationLevel,
  UserId
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
    throw new SdkError(
      "NOT_CONFIGURED",
      `Cannot create conversation for ${input.participantIds.length} participants`
    );
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

  async getProfile(): Promise<User> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read a profile");
  }

  async getAvatar(): Promise<AvatarImage | undefined> {
    throw new SdkError("NOT_CONFIGURED", "Cannot read an avatar");
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
}
