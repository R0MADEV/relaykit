import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { Conversation, ConversationId, CreateSpaceInput, Space } from "./models.js";

export interface SpaceOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

/** Spaces group conversations. They are not conversations themselves and never appear as one. */
export class SpaceOperations {
  constructor(private readonly context: SpaceOperationsContext) {}

  async list(): Promise<readonly Space[]> {
    this.context.assertStarted();
    return this.context.adapter.listSpaces();
  }

  async create(input: CreateSpaceInput): Promise<Space> {
    this.context.assertStarted();
    if (!input.title.trim()) {
      throw new SdkError("INVALID_INPUT", "A space needs a name");
    }
    return this.context.adapter.createSpace({ title: input.title.trim() });
  }

  async add(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.addToSpace(spaceId, conversationId);
  }

  async remove(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.removeFromSpace(spaceId, conversationId);
  }

  async conversations(spaceId: ConversationId): Promise<readonly Conversation[]> {
    this.context.assertStarted();
    return this.context.adapter.listSpaceConversations(spaceId);
  }
}
