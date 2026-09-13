import { SdkError } from "./errors.js";
import { fewestPollAnswers } from "./models.js";
import type { MessagingAdapter, PollsAdapter } from "./adapter.js";
import type { ConversationId, MessageId, Poll, StartPollInput } from "./models.js";

export interface PollOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class PollOperations {
  constructor(private readonly context: PollOperationsContext) {}

  async start(conversationId: ConversationId, input: StartPollInput): Promise<Poll> {
    this.context.assertStarted();
    const question = input.question.trim();
    if (!question) {
      throw new SdkError("INVALID_INPUT", "A poll needs something to ask");
    }
    const answers = input.answers.map(answer => answer.trim()).filter(answer => answer.length > 0);
    if (answers.length < fewestPollAnswers) {
      throw new SdkError(
        "INVALID_INPUT",
        `A poll needs at least ${fewestPollAnswers} answers to choose from`
      );
    }
    const maxSelections = input.maxSelections ?? 1;
    if (maxSelections < 1 || maxSelections > answers.length) {
      throw new SdkError("INVALID_INPUT", "How many answers can be chosen has to fit the answers there are");
    }
    return this.polls.startPoll(conversationId, { ...input, question, answers, maxSelections });
  }

  /**
   * Changing your mind is normal, so voting again replaces the previous vote rather than adding to it. What
   * cannot be done is voting in a closed poll: whoever closed it took the result as final.
   */
  async vote(conversationId: ConversationId, pollId: MessageId, answerId: string): Promise<void> {
    this.context.assertStarted();
    if (!answerId.trim()) {
      throw new SdkError("INVALID_INPUT", "A vote needs an answer to choose");
    }
    const poll = (await this.polls.listPolls(conversationId)).find(item => item.id === pollId);
    if (!poll) {
      throw new SdkError("MESSAGE_NOT_FOUND", "That poll is not in this conversation");
    }
    if (poll.isClosed) {
      throw new SdkError("INVALID_INPUT", "That poll is closed, so there is nothing left to vote on");
    }
    if (!poll.answers.some(answer => answer.id === answerId)) {
      throw new SdkError("INVALID_INPUT", "That answer is not one of the answers of this poll");
    }
    await this.polls.voteInPoll(conversationId, pollId, answerId);
  }

  /** Closing is final: the result stays as it stood at that moment. */
  async close(conversationId: ConversationId, pollId: MessageId): Promise<void> {
    this.context.assertStarted();
    await this.polls.closePoll(conversationId, pollId);
  }

  async list(conversationId: ConversationId): Promise<readonly Poll[]> {
    this.context.assertStarted();
    return this.polls.listPolls(conversationId);
  }

  /** The one place that answers whether this adapter does this at all. */
  private get polls(): PollsAdapter {
    const polls = this.context.adapter.polls;
    if (!polls) throw new SdkError("NOT_SUPPORTED", "Polls are not something this homeserver holds");
    return polls;
  }
}
