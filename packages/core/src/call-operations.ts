import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { Call, ConversationId, PlaceCallOptions } from "./models.js";

export interface CallOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class CallOperations {
  constructor(private readonly context: CallOperationsContext) {}

  /**
   * Calling the people of a conversation. The signalling goes over Matrix, which is why a conversation is
   * needed at all: it is what says who is being called and who may answer.
   */
  async place(conversationId: ConversationId, options: PlaceCallOptions = {}): Promise<Call> {
    this.context.assertStarted();
    if (!conversationId.trim()) {
      throw new SdkError("INVALID_INPUT", "A call needs a conversation to place it into");
    }
    return this.context.adapter.placeCall(conversationId, options);
  }

  /**
   * Answering with video when the call was placed without it is not the same call: the other side was never
   * told to make room on the screen. Whoever answers decides only about their own camera.
   */
  async answer(callId: string, options: PlaceCallOptions = {}): Promise<Call> {
    this.context.assertStarted();
    return this.context.adapter.answerCall(this.require(callId), options);
  }

  /** Hanging up a call that is already over is not a failure: it is what somebody pressing twice does. */
  async hangUp(callId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.hangUpCall(this.require(callId));
  }

  /** What is going on now, which is what a screen paints when it is opened in the middle of a call. */
  list(): Promise<readonly Call[]> {
    this.context.assertStarted();
    return this.context.adapter.listCalls();
  }

  private require(callId: string): string {
    if (!callId.trim()) {
      throw new SdkError("INVALID_INPUT", "A call id is required");
    }
    return callId;
  }
}
