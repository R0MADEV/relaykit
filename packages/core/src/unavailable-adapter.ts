import { RelayKitError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type {
  Conversation,
  ConversationId,
  CreateConversationInput,
  MessagePage,
  Message,
  AvatarImage,
  Session,
  User
} from "./models.js";

export class UnavailableAdapter implements MessagingAdapter {
  async register(): Promise<Session> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot register without an adapter");
  }

  async login(): Promise<Session> {
    throw new RelayKitError("NOT_CONFIGURED", "A messaging adapter is required");
  }

  /**
   * Refuses, rather than starting nothing.
   *
   * Succeeding here is worse than failing: everything afterwards answers emptily, and an account with no
   * conversations looks exactly like a client with no backend. Somebody would ship that.
   */
  async start(): Promise<void> {
    throw nothingUnderneath();
  }

  /** Stopping something that never started is not a failure, and neither is signing out of nothing. */
  async stop(): Promise<void> {}
  async logout(): Promise<void> {}

  async listConversations(): Promise<readonly Conversation[]> {
    throw nothingUnderneath();
  }

  async createConversation(input: CreateConversationInput): Promise<Conversation> {
    throw new RelayKitError(
      "NOT_CONFIGURED",
      `Cannot create conversation for ${input.participantIds.length} participants`
    );
  }

  async joinConversation(conversationId: ConversationId): Promise<Conversation> {
    throw new RelayKitError("NOT_CONFIGURED", `Cannot join conversation ${conversationId}`);
  }

  async listMessages(): Promise<readonly Message[]> {
    return [];
  }

  async loadMoreMessages(): Promise<MessagePage> {
    return { messages: [], hasMore: false };
  }

  async sendMessage(): Promise<Message> {
    throw new RelayKitError("NOT_CONFIGURED", "A messaging adapter is required");
  }

  async leaveConversation(): Promise<void> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot leave a conversation");
  }

  async inviteToConversation(): Promise<Conversation> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot invite to a conversation");
  }

  async setDisplayName(): Promise<void> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot change the display name");
  }

  async setAvatar(): Promise<void> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot change the avatar");
  }

  async getProfile(): Promise<User> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot read a profile");
  }

  async getAvatar(): Promise<AvatarImage | undefined> {
    throw new RelayKitError("NOT_CONFIGURED", "Cannot read an avatar");
  }
}

/** The one thing this adapter has to say, said the same way everywhere. */
function nothingUnderneath(): RelayKitError {
  return new RelayKitError("NOT_CONFIGURED", "A messaging adapter is required");
}
