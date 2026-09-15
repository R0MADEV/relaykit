import type {
  Conversation,
  ConversationId,
  CreateSpaceInput,
  Space,
  SpaceChild,
  SpacesAdapter
} from "@relaykit/core";

/** What the spaces of the double need from the adapter around them, and nothing else of it. */
export interface InMemorySpacesContext {
  /** Every conversation there is. The answer keeps their order, not the order they were added here. */
  readonly conversations: () => readonly Conversation[];
  readonly nextId: () => number;
}

/**
 * Grouping conversations, for organising them by team or by project.
 *
 * A space holds identifiers and nothing else: what a conversation is stays where conversations are kept, and
 * is looked up when somebody asks what is in here. A conversation that has gone is simply not in the answer.
 */
export class InMemorySpaces implements SpacesAdapter {
  private readonly spaces: Space[] = [];
  private readonly children = new Map<ConversationId, Set<ConversationId>>();

  constructor(private readonly context: InMemorySpacesContext) {}

  /** One level deep: this double has no spaces inside spaces, so nothing is ever further down. */
  /**
   * Everything inside, however deep it sits.
   *
   * Breadth first, so anything put in two places at once is reached by the nearer of them, and a space that
   * ends up inside itself is still an answer rather than a loop that never comes back.
   */
  async listSpaceChildren(spaceId: ConversationId): Promise<readonly SpaceChild[]> {
    const known = this.context.conversations();
    const found: SpaceChild[] = [];
    const seen = new Set([spaceId]);
    let level = [spaceId];
    let depth = 1;
    while (level.length > 0) {
      const next: ConversationId[] = [];
      for (const parent of level) {
        for (const conversationId of this.children.get(parent) ?? []) {
          if (seen.has(conversationId)) continue;
          seen.add(conversationId);
          next.push(conversationId);
          const title = known.find(each => each.id === conversationId)?.title;
          found.push({ conversationId, depth, ...(title ? { title } : {}) });
        }
      }
      level = next;
      depth += 1;
    }
    return found;
  }

  async listSpaces(): Promise<readonly Space[]> {
    return this.spaces;
  }

  async createSpace(input: CreateSpaceInput): Promise<Space> {
    const space: Space = { id: `memory-space-${this.context.nextId()}`, title: input.title };
    this.spaces.push(space);
    return space;
  }

  async addToSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    const held = this.children.get(spaceId) ?? new Set<ConversationId>();
    held.add(conversationId);
    this.children.set(spaceId, held);
  }

  async removeFromSpace(spaceId: ConversationId, conversationId: ConversationId): Promise<void> {
    this.children.get(spaceId)?.delete(conversationId);
  }

  async listSpaceConversations(spaceId: ConversationId): Promise<readonly Conversation[]> {
    const held = this.children.get(spaceId) ?? new Set<ConversationId>();
    return this.context.conversations().filter(conversation => held.has(conversation.id));
  }
}
