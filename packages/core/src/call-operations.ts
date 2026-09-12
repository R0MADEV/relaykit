import { SdkError } from "./errors.js";
import type { MessagingAdapter } from "./adapter.js";
import type { Call, CallQuality, ConversationId, PlaceCallOptions } from "./models.js";

export interface CallOperationsContext {
  readonly adapter: MessagingAdapter;
  readonly assertStarted: () => void;
}

export class CallOperations {
  constructor(private readonly context: CallOperationsContext) {}

  /**
   * Starting a call in a conversation and ringing the people in it. Matrix is what says who they are and who
   * may pick up, which is why a conversation is needed at all.
   */
  async place(conversationId: ConversationId, options: PlaceCallOptions = {}): Promise<Call> {
    this.context.assertStarted();
    return this.context.adapter.placeCall(this.requireConversation(conversationId), options);
  }

  /**
   * Entering the call of a conversation that is already going on, without ringing anybody. Two people on a
   * call are a call with two on it, so what comes back is the same `Call` either way.
   */
  async join(conversationId: ConversationId, options: PlaceCallOptions = {}): Promise<Call> {
    this.context.assertStarted();
    return this.context.adapter.joinCall(this.requireConversation(conversationId), options);
  }

  /**
   * Picking up what rang. Answering with video when the call was placed without it is not the same call:
   * the others were never told to make room on the screen. Whoever answers decides only about their own
   * camera.
   */
  async answer(callId: string, options: PlaceCallOptions = {}): Promise<Call> {
    this.context.assertStarted();
    return this.context.adapter.answerCall(this.require(callId), options);
  }

  /**
   * Leaving. The call carries on for whoever is still on it, and hanging up one that is already over is not a
   * failure: it is what somebody pressing twice does.
   */
  async hangUp(callId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.hangUpCall(this.require(callId));
  }

  /** Not picking up what rang. The call goes on without this side, which simply stops being told about it. */
  async reject(callId: string): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.rejectCall(this.require(callId));
  }

  /** Silenced: the others stop hearing this side, and the call carries on. */
  async muteMicrophone(callId: string, muted: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.muteCallMicrophone(this.require(callId), muted);
  }

  async muteCamera(callId: string, muted: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.muteCallCamera(this.require(callId), muted);
  }

  async shareScreen(callId: string, sharing: boolean): Promise<void> {
    this.context.assertStarted();
    await this.context.adapter.shareScreenInCall(this.require(callId), sharing);
  }

  /** How a call is going, for a screen that wants to say why somebody cannot be heard. */
  async quality(callId: string): Promise<CallQuality> {
    this.context.assertStarted();
    return this.context.adapter.callQuality(this.require(callId));
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

  private requireConversation(conversationId: ConversationId): ConversationId {
    if (!conversationId.trim()) {
      throw new SdkError("INVALID_INPUT", "A call needs a conversation to happen in");
    }
    return conversationId;
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
