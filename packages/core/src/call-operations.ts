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

  /**
   * Refusing a call is not hanging it up. Whoever is being rung and does not want to answer has the other side
   * told so, and the call can be shown as refused instead of as one that was answered and cut off.
   */
  async reject(callId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.rejectCall(this.require(callId));
  }

  /** Silenced: the other side stops hearing, and the call carries on. */
  async muteMicrophone(callId: string, muted: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.muteCallMicrophone(this.require(callId), muted);
  }

  async muteCamera(callId: string, muted: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.muteCallCamera(this.require(callId), muted);
  }

  /** On hold the other side is told, and stops hearing and seeing. Not the same as being silenced. */
  async hold(callId: string, onHold: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.holdCall(this.require(callId), onHold);
  }

  async shareScreen(callId: string, sharing: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.shareScreenInCall(this.require(callId), sharing);
  }

  /** Handing the call to somebody else, who then talks to whoever was on the other end. */
  async transfer(callId: string, userId: string): Promise<void> {
    this.context.assertStarted();
    if (!userId.trim()) {
      throw new SdkError("INVALID_INPUT", "A call can only be transferred to somebody");
    }
    await this.context.adapter.transferCall(this.require(callId), userId);
  }

  /** Which microphone and camera to use from now on. It belongs to the account, not to one call. */
  async useMicrophone(deviceId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.useMicrophone(this.requireDevice(deviceId));
  }

  async useCamera(deviceId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.useCamera(this.requireDevice(deviceId));
  }

  /** What is going on now, which is what a screen paints when it is opened in the middle of a call. */
  list(): Promise<readonly Call[]> {
    this.context.assertStarted();
    return this.context.adapter.listCalls();
  }

  private requireDevice(deviceId: string): string {
    if (!deviceId.trim()) {
      throw new SdkError("INVALID_INPUT", "A device is needed to choose one");
    }
    return deviceId;
  }

  private require(callId: string): string {
    if (!callId.trim()) {
      throw new SdkError("INVALID_INPUT", "A call id is required");
    }
    return callId;
  }
}
