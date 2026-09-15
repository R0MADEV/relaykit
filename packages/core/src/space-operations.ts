import { RelayKitError } from "./errors.js";
import type { MessagingAdapter, SpacesAdapter } from "./adapter.js";
import type { Conversation, ConversationId, CreateSpaceInput, Space, SpaceChild } from "./models.js";

export interface SpaceOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

/** Spaces group conversations. They are not conversations themselves and never appear as one. */
export class SpaceOperations {
  constructor(private readonly context: SpaceOperationsContext) {}

  async list(): Promise<readonly Space[]> {
    this.context.assertStarted();
    return this.spaces.listSpaces();
  }

  async create(input: CreateSpaceInput): Promise<Space> {
    this.context.assertStarted();
    if (!input.title.trim()) {
      throw new RelayKitError("INVALID_INPUT", "A space needs a name");
    }
    return this.spaces.createSpace({ title: input.title.trim() });
  }

  async add(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    this.context.assertStarted();
    await this.spaces.addToSpace(spaceId, conversationId);
  }

  async remove(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    this.context.assertStarted();
    await this.spaces.removeFromSpace(spaceId, conversationId);
  }

  /** What is inside a space, down as many levels as it goes. */
  async children(spaceId: ConversationId): Promise<readonly SpaceChild[]> {
    this.context.assertStarted();
    return this.spaces.listSpaceChildren(spaceId);
  }

  async conversations(spaceId: ConversationId): Promise<readonly Conversation[]> {
    this.context.assertStarted();
    return this.spaces.listSpaceConversations(spaceId);
  }

  /** The one place that answers whether this adapter does this at all. */
  private get spaces(): SpacesAdapter {
    const spaces = this.context.adapter.spaces;
    if (!spaces) throw new RelayKitError("NOT_SUPPORTED", "Spaces are not something this homeserver has");
    return spaces;
  }
}
