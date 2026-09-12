import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { ConversationId, MessageId, Poll, StartPollInput } from "./models.js";

export interface PollOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

/** At least two: a poll with a single answer asks nothing. */
const fewestAnswers = 2;

export class PollOperations {
  constructor(private readonly context: PollOperationsContext) {}

  async start(conversationId: ConversationId, input: StartPollInput): Promise<Poll> {
    this.context.assertStarted();
    const question = input.question.trim();
    if (!question) {
      throw new SdkError("INVALID_INPUT", "A poll needs something to ask");
    }
    const answers = input.answers.map(answer => answer.trim()).filter(answer => answer.length > 0);
    if (answers.length < fewestAnswers) {
      throw new SdkError("INVALID_INPUT", `A poll needs at least ${fewestAnswers} answers to choose from`);
    }
    const maxSelections = input.maxSelections ?? 1;
    if (maxSelections < 1 || maxSelections > answers.length) {
      throw new SdkError("INVALID_INPUT", "How many answers can be chosen has to fit the answers there are");
    }
    return this.context.adapter.startPoll(conversationId, { ...input, question, answers, maxSelections });
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
    const poll = (await this.context.adapter.listPolls(conversationId)).find(item => item.id === pollId);
    if (!poll) {
      throw new SdkError("MESSAGE_NOT_FOUND", "That poll is not in this conversation");
    }
    if (poll.isClosed) {
      throw new SdkError("INVALID_INPUT", "That poll is closed, so there is nothing left to vote on");
    }
    if (!poll.answers.some(answer => answer.id === answerId)) {
      throw new SdkError("INVALID_INPUT", "That answer is not one of the answers of this poll");
    }
    await this.context.adapter.voteInPoll(conversationId, pollId, answerId);
  }

  /** Closing is final: the result stays as it stood at that moment. */
  async close(conversationId: ConversationId, pollId: MessageId): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.closePoll(conversationId, pollId);
  }

  list(conversationId: ConversationId): Promise<readonly Poll[]> {
    this.context.assertStarted();
    return this.context.adapter.listPolls(conversationId);
  }
}
