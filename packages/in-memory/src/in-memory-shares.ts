import { SdkError } from "@relaykit/core";
import type {
  ConversationId,
  LocationAdapter,
  PollsAdapter,
  GeoLocation,
  LiveLocation,
  MessageId,
  Poll,
  ShareLocationInput,
  StartPollInput,
  UserId
} from "@relaykit/core";

/** What the shares of the double need from the adapter around them, and nothing else of it. */
export interface InMemorySharesContext {
  readonly requireUserId: () => UserId;
  readonly nextId: () => number;
}

/**
 * What is shared in a conversation without being a message: a poll, and where somebody is while they say so.
 *
 * Both are kept by the conversation they belong to and answered from what is held, which is the same answer
 * a homeserver gives from what it holds. Neither has anything to do with the timeline, so neither is here.
 */
export class InMemoryShares implements PollsAdapter, LocationAdapter {
  private readonly locations = new Map<string, LiveLocation>();
  private readonly polls = new Map<MessageId, Poll>();
  private readonly votes = new Map<MessageId, Map<UserId, string>>();

  constructor(private readonly context: InMemorySharesContext) {}

  async startLiveLocation(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation> {
    const id = `memory-location-${this.context.nextId()}`;
    const sharing: LiveLocation = {
      id,
      conversationId,
      sharedBy: this.context.requireUserId(),
      isLive: true,
      startedAt: Date.now(),
      durationMs: input.durationMs,
      ...(input.description ? { description: input.description } : {})
    };
    this.locations.set(id, sharing);
    return sharing;
  }

  async updateLiveLocation(sharingId: string, position: GeoLocation): Promise<void> {
    const sharing = this.requireSharing(sharingId);
    // Stopped or expired takes no more: otherwise somebody who said stop would still be telling where they are.
    if (!sharing.isLive) throw new SdkError("INVALID_INPUT", "That sharing is no longer live");
    this.locations.set(sharingId, { ...sharing, lastPosition: position });
  }

  async stopLiveLocation(sharingId: string): Promise<void> {
    const sharing = this.requireSharing(sharingId);
    this.locations.set(sharingId, { ...sharing, isLive: false });
  }

  async listLiveLocations(conversationId: ConversationId): Promise<readonly LiveLocation[]> {
    return [...this.locations.values()].filter(sharing => sharing.conversationId === conversationId);
  }

  private requireSharing(sharingId: string): LiveLocation {
    const sharing = this.locations.get(sharingId);
    if (!sharing) throw new Error("That sharing does not exist");
    return sharing;
  }

  async startPoll(conversationId: ConversationId, input: StartPollInput): Promise<Poll> {
    const id = `memory-poll-${this.context.nextId()}`;
    const poll: Poll = {
      id,
      conversationId,
      question: input.question,
      answers: input.answers.map((text, index) => ({ id: `${id}-${index}`, text, votes: 0 })),
      startedBy: this.context.requireUserId(),
      startedAt: Date.now(),
      isClosed: false
    };
    this.polls.set(id, poll);
    return poll;
  }

  /** Changing your mind replaces the previous vote, which is what the protocol says: only the last counts. */
  async voteInPoll(_conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void> {
    const poll = this.requirePoll(pollId);
    const votes = this.votes.get(pollId) ?? new Map<UserId, string>();
    votes.set(this.context.requireUserId(), answerId);
    this.votes.set(pollId, votes);
    this.polls.set(pollId, this.withVotes(poll, votes));
  }

  async closePoll(_conversationId: ConversationId, pollId: MessageId): Promise<void> {
    this.polls.set(pollId, { ...this.requirePoll(pollId), isClosed: true });
  }

  async listPolls(conversationId: ConversationId): Promise<readonly Poll[]> {
    return [...this.polls.values()].filter(poll => poll.conversationId === conversationId);
  }

  private requirePoll(pollId: MessageId): Poll {
    const poll = this.polls.get(pollId);
    if (!poll) throw new Error("The poll does not exist");
    return poll;
  }

  private withVotes(poll: Poll, votes: Map<UserId, string>): Poll {
    const chosen = [...votes.values()];
    const mine = votes.get(this.context.requireUserId());
    return {
      ...poll,
      answers: poll.answers.map(answer => ({
        ...answer,
        votes: chosen.filter(answerId => answerId === answer.id).length
      })),
      ...(mine ? { ownAnswerId: mine } : {})
    };
  }
}
