import type {
  ConversationId,
  GeoLocation,
  LiveLocation,
  LocationAdapter,
  Poll,
  PollsAdapter,
  ShareLocationInput,
  StartPollInput
} from "@relaykit/core";
import { withTranslatedErrors } from "./matrix-errors.js";
import {
  listMatrixLiveLocations,
  startMatrixLiveLocation,
  stopMatrixLiveLocation,
  updateMatrixLiveLocation
} from "./matrix-location.js";
import { closeMatrixPoll, listMatrixPolls, startMatrixPoll, voteInMatrixPoll } from "./matrix-polls.js";
import type { MatrixRuntime } from "./matrix-runtime.js";

/**
 * What is shared in a conversation without being a message: a poll, and where somebody is while they say so.
 *
 * Everything here is done to a conversation, so the conversation is reached for first — one outside the
 * synced window is not held locally, and anything waiting for it would wait for ever.
 */
export class MatrixShares implements PollsAdapter, LocationAdapter {
  constructor(private readonly runtime: MatrixRuntime) {}

  private reaching<Result>(conversationId: ConversationId, work: () => Promise<Result>): Promise<Result> {
    return withTranslatedErrors(async () => {
      await this.runtime.reachFor(conversationId);
      return work();
    });
  }

  startLiveLocation(conversationId: ConversationId, input: ShareLocationInput): Promise<LiveLocation> {
    return this.reaching(conversationId, () =>
      startMatrixLiveLocation(this.runtime.getClient(), conversationId, input)
    );
  }

  updateLiveLocation(sharingId: string, position: GeoLocation): Promise<void> {
    return withTranslatedErrors(() =>
      updateMatrixLiveLocation(this.runtime.getClient(), sharingId, position)
    );
  }

  stopLiveLocation(sharingId: string): Promise<void> {
    return withTranslatedErrors(() => stopMatrixLiveLocation(this.runtime.getClient(), sharingId));
  }

  listLiveLocations(conversationId: ConversationId): Promise<readonly LiveLocation[]> {
    return this.reaching(conversationId, () =>
      listMatrixLiveLocations(this.runtime.getClient(), conversationId)
    );
  }

  startPoll(conversationId: ConversationId, input: StartPollInput): Promise<Poll> {
    return this.reaching(conversationId, () =>
      startMatrixPoll(this.runtime.getClient(), conversationId, input)
    );
  }

  voteInPoll(conversationId: ConversationId, pollId: string, answerId: string): Promise<void> {
    return this.reaching(conversationId, () =>
      voteInMatrixPoll(this.runtime.getClient(), conversationId, pollId, answerId)
    );
  }

  closePoll(conversationId: ConversationId, pollId: string): Promise<void> {
    return this.reaching(conversationId, () =>
      closeMatrixPoll(this.runtime.getClient(), conversationId, pollId)
    );
  }

  listPolls(conversationId: ConversationId): Promise<readonly Poll[]> {
    return this.reaching(conversationId, () => listMatrixPolls(this.runtime.getClient(), conversationId));
  }
}
