import { CallEvent, type MatrixClient } from "matrix-js-sdk";
import {
  CallDirection,
  CallState as MatrixCallState,
  CallType,
  type MatrixCall
} from "matrix-js-sdk/lib/webrtc/call.js";
import type { Call, CallState, ConversationId, PlaceCallOptions } from "@relaykit/core";

/**
 * Calls are the SDK's own: it creates them, signals over Matrix and negotiates the media between devices.
 * Nothing of what is said passes through here, and nothing of this is built by hand.
 *
 * What this file does is keep the calls that are going on and turn them into the neutral contract, because a
 * component that draws a call must not depend on `MatrixCall`.
 */
export class MatrixCalls {
  private readonly going = new Map<string, MatrixCall>();
  // The SDK says the state changed while it is still placing the call, before it has written down which way
  // the call goes. Whose call it is was never in doubt, so it is remembered rather than asked for.
  private readonly placedHere = new Set<string>();
  private report: ((call: Call) => void) | undefined;
  private ownUserId = "";

  /** Told about calls somebody else places. The SDK raises one event per incoming call. */
  watch(client: MatrixClient, announce: (call: Call) => void, report: (call: Call) => void): void {
    this.report = report;
    this.ownUserId = client.getSafeUserId();
    client.on("Call.incoming" as never, ((call: MatrixCall) => {
      this.keep(call);
      announce(this.describe(call));
    }) as never);
  }

  async place(client: MatrixClient, conversationId: ConversationId, options: PlaceCallOptions): Promise<Call> {
    const call = client.createCall(conversationId);
    if (!call) {
      throw new Error("This conversation cannot be called");
    }
    this.placedHere.add(call.callId);
    this.keep(call);
    // Waited for, not let go. Placing a call asks for the microphone or the camera before it can send
    // anything, and that can be refused: letting it go would answer with a call that looks like it is ringing
    // and never left this machine. So what comes back has really gone out, and what could not be placed says
    // so and stops being a call that is going on.
    try {
      await (options.video ? call.placeVideoCall() : call.placeVoiceCall());
    } catch (error) {
      this.going.delete(call.callId);
      this.placedHere.delete(call.callId);
      throw error;
    }
    return this.describe(call);
  }

  /**
   * What somebody does during a call. Every one of these is the SDK's own: it is what knows how to stop a
   * track without dropping the call, what to tell the other side, and how to renegotiate afterwards.
   */
  async muteMicrophone(callId: string, muted: boolean): Promise<void> {
    await this.require(callId).setMicrophoneMuted(muted);
  }

  async muteCamera(callId: string, muted: boolean): Promise<void> {
    await this.require(callId).setLocalVideoMuted(muted);
  }

  /** On hold the other side is told, and stops hearing and seeing, which is not the same as being silenced. */
  async hold(callId: string, onHold: boolean): Promise<void> {
    this.require(callId).setRemoteOnHold(onHold);
  }

  /**
   * Refusing is not hanging up. The other side is told a different thing, and a refused call can be shown as
   * refused rather than as one that was answered and cut off.
   */
  async reject(callId: string): Promise<void> {
    this.require(callId).reject();
  }

  async shareScreen(callId: string, sharing: boolean): Promise<void> {
    await this.require(callId).setScreensharingEnabled(sharing);
  }

  /** Handing the call to somebody else, who then talks to whoever was on the other end. */
  async transfer(callId: string, userId: string): Promise<void> {
    await this.require(callId).transfer(userId);
  }

  /**
   * Which microphone and which camera to use. This belongs to the client and not to one call: it is what the
   * next call will be made with, and the SDK keeps it.
   */
  async useMicrophone(client: MatrixClient, deviceId: string): Promise<void> {
    await client.getMediaHandler().setAudioInput(deviceId);
  }

  async useCamera(client: MatrixClient, deviceId: string): Promise<void> {
    await client.getMediaHandler().setVideoInput(deviceId);
  }

  async answer(callId: string, options: PlaceCallOptions): Promise<Call> {
    const call = this.require(callId);
    await call.answer(true, options.video === true);
    return this.describe(call);
  }

  /** Hanging up one that is already over is what somebody pressing twice does, and it is not a failure. */
  hangUp(callId: string): void {
    const call = this.going.get(callId);
    if (!call) return;
    call.hangup("user_hangup" as never, false);
  }

  list(): readonly Call[] {
    return [...this.going.values()].map(call => this.describe(call));
  }

  forget(): void {
    this.going.clear();
  }

  private keep(call: MatrixCall): void {
    this.going.set(call.callId, call);
    // The audio and the picture do not arrive when the state changes: they arrive when they arrive, and for a
    // video call that is usually once it is already connected. Without this the last word on a call is one
    // with nothing to play, and a screen waiting for something to show waits for ever.
    call.on(CallEvent.FeedsChanged, () => this.report?.(this.describe(call)));
    call.on(CallEvent.State, () => {
      this.report?.(this.describe(call));
      // A call that is over stops being one that is going on, so a screen listing them does not keep it.
      if (call.state === MatrixCallState.Ended) {
        this.going.delete(call.callId);
        this.placedHere.delete(call.callId);
      }
    });
  }

  /** The neutral shape. `ringing` covers waiting for an answer and being rung: a screen draws the same. */
  private describe(call: MatrixCall): Call {
    const placedHere = this.placedHere.has(call.callId) || call.direction === CallDirection.Outbound;
    // The SDK keeps one feed per side and the audio and video live in them. Handed over as they are: a
    // component gets something it can give to an element, without reaching into `MatrixCall` to find it.
    const feeds = call.getFeeds();
    const ownMedia = feeds.find(feed => feed.isLocal())?.stream;
    const remoteMedia = feeds.find(feed => !feed.isLocal())?.stream;
    return {
      ...(ownMedia ? { ownMedia } : {}),
      ...(remoteMedia ? { remoteMedia } : {}),
      id: call.callId,
      conversationId: call.roomId ?? "",
      callerId: placedHere ? this.ownUserId : (call.getOpponentMember()?.userId ?? ""),
      isVideo: call.type === CallType.Video,
      isMicrophoneMuted: call.isMicrophoneMuted(),
      isCameraMuted: call.isLocalVideoMuted(),
      isOnHold: call.isRemoteOnHold(),
      isSharingScreen: call.isScreensharing(),
      state: mapState(call.state),
      startedAt: Date.now(),
      hasRemoteMedia: remoteMedia !== undefined
    };
  }

  private require(callId: string): MatrixCall {
    const call = this.going.get(callId);
    if (!call) throw new Error("That call is not going on");
    return call;
  }
}



const states: Partial<Record<MatrixCallState, CallState>> = {
  [MatrixCallState.Fledgling]: "ringing",
  [MatrixCallState.InviteSent]: "ringing",
  [MatrixCallState.Ringing]: "ringing",
  [MatrixCallState.WaitLocalMedia]: "connecting",
  [MatrixCallState.CreateOffer]: "connecting",
  [MatrixCallState.CreateAnswer]: "connecting",
  [MatrixCallState.Connecting]: "connecting",
  [MatrixCallState.Connected]: "connected",
  [MatrixCallState.Ended]: "ended"
};

function mapState(state: MatrixCallState): CallState {
  return states[state] ?? "connecting";
}
