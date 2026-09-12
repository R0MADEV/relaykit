import { CallEvent, type MatrixClient } from "matrix-js-sdk";
import { SDPStreamMetadataPurpose } from "matrix-js-sdk/lib/webrtc/callEventTypes.js";
import type { CallFeed } from "matrix-js-sdk/lib/webrtc/callFeed.js";
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
  /**
   * When each call started. Read from the clock every time it was described, so a call said it had started
   * again every time anybody looked at it, and anything drawing how long it had been going showed nothing.
   */
  private readonly startedAt = new Map<string, number>();
  /** What went wrong, for a call that went wrong. The SDK says so once; it has to be kept to be told. */
  private readonly wentWrong = new Map<string, string>();
  /** What is already being changed on each call, so the next change waits rather than talking over it. */
  private readonly queued = new Map<string, Promise<void>>();
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
  /**
   * What the SDK answers is how the call ended up, not whether it did as it was told, and those differ: with
   * no microphone on the machine, or in the middle of agreeing something with the other side, it leaves
   * things as they were and says so.
   *
   * So what came back is compared with what was asked. Throwing that answer away leaves a button that
   * reports success while the microphone carries on sending, which of all the ways to be wrong about a call
   * is the worst one.
   */
  async muteMicrophone(callId: string, muted: boolean): Promise<void> {
    await this.changing(callId, call => this.settling(
      () => call.setMicrophoneMuted(muted),
      () => call.isMicrophoneMuted() === muted,
      `The call could not be ${muted ? "silenced" : "let speak again"} just now`
    ));
  }

  /**
   * Putting the camera away is not done when the flag says so: the SDK stops the track and lets go of it a
   * moment later. Coming back inside that moment asks for the camera again and then has it taken away, which
   * is why turning it off and straight back on worked most of the time and not always.
   *
   * So each way waits for what really has to be true: gone when it is away, there when it is back.
   */
  async muteCamera(callId: string, muted: boolean): Promise<void> {
    await this.changing(callId, call => this.settling(
      () => call.setLocalVideoMuted(muted),
      () => call.isLocalVideoMuted() === muted && call.hasLocalUserMediaVideoTrack === !muted,
      `The camera could not be ${muted ? "put away" : "brought back"} just now`
    ));
  }

  /**
   * Asked for, and then waited on until the call agrees. The SDK settles these a moment later: it tells the
   * other side and may go and ask for the media again, and what it answers is how things stood when asked,
   * not how they ended up.
   *
   * Coming back early is how a screen draws the opposite of what is true and the next press asks for the
   * wrong thing. The rule is the one the rest of this library follows: if an operation comes back, what it
   * did can already be read.
   */
  private async settling(ask: () => Promise<unknown>, isDone: () => boolean, complaint: string): Promise<void> {
    await ask();
    // Long enough for the slowest of these, which is bringing a camera back: that one goes and asks for the
    // device and agrees a new shape with the other side. Bounded all the same, because waiting for ever is
    // not an answer either.
    for (let attempt = 0; attempt < 150; attempt += 1) {
      if (isDone()) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(complaint);
  }

  /** On hold the other side is told, and stops hearing and seeing, which is not the same as being silenced. */
  async hold(callId: string, onHold: boolean): Promise<void> {
    await this.changing(callId, call => call.setRemoteOnHold(onHold));
  }

  /**
   * Refusing is not hanging up. The other side is told a different thing, and a refused call can be shown as
   * refused rather than as one that was answered and cut off.
   */
  async reject(callId: string): Promise<void> {
    this.require(callId).reject();
  }

  /**
   * A digit pressed during a call. The SDK sends it and says whether the other end can take them at all:
   * pressing into a call that cannot hear digits does nothing, and doing nothing quietly is worse than
   * saying so.
   */
  async pressDigit(callId: string, digit: string): Promise<void> {
    const call = this.require(callId);
    if (!call.opponentSupportsDTMF()) {
      throw new Error("The other end cannot take digits");
    }
    call.sendDtmfDigit(digit);
  }

  async shareScreen(callId: string, sharing: boolean): Promise<void> {
    await this.changing(callId, call => call.setScreensharingEnabled(sharing));
  }

  /**
   * Doing it and then saying so. None of these changes the state of the call, so the SDK says nothing about
   * them: without this a button can be pressed and nothing on the screen moves, which reads as a button that
   * does not work.
   */
  private async changing(callId: string, change: (call: MatrixCall) => unknown): Promise<void> {
    const call = this.require(callId);
    await this.oneAtATime(callId, () => change(call));
    this.report?.(this.describe(call));
  }

  /**
   * Changes to one call queue up behind each other. Holding, silencing and turning a camera on all end in the
   * same place — agreeing a new shape with the other side — and two of those at once tread on one another:
   * the second is asked while the first is still being agreed, and one of them is quietly dropped.
   *
   * Somebody pressing two buttons quickly is not an unusual thing to do.
   */
  private oneAtATime(callId: string, change: () => unknown): Promise<void> {
    const after = (this.queued.get(callId) ?? Promise.resolve())
      .then(() => change())
      .then(() => undefined, error => { throw error; });
    // Kept so the next one waits for this, whether it worked or not: a change that failed still finished.
    this.queued.set(callId, after.catch(() => undefined));
    return after;
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
    if (!this.startedAt.has(call.callId)) this.startedAt.set(call.callId, Date.now());
    // A call that goes wrong says so once and then ends. Without keeping it, all anybody sees is a call that
    // stopped, and "it stopped" is not an answer to why.
    call.on(CallEvent.Error, (problem: Error) => {
      this.wentWrong.set(call.callId, problem.message);
      this.report?.(this.describe(call));
    });
    // Being put on hold by the other side, and being told who is really on the other end after a call has
    // been passed on. Both are the SDK telling us something that otherwise only shows up if somebody asks.
    call.on(CallEvent.LocalHoldUnhold, () => this.report?.(this.describe(call)));
    call.on(CallEvent.AssertedIdentityChanged, () => this.report?.(this.describe(call)));
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
        this.startedAt.delete(call.callId);
        this.wentWrong.delete(call.callId);
      }
    });
  }

  /** The neutral shape. `ringing` covers waiting for an answer and being rung: a screen draws the same. */
  private describe(call: MatrixCall): Call {
    const placedHere = this.placedHere.has(call.callId) || call.direction === CallDirection.Outbound;
    // The SDK keeps one feed per side and the audio and video live in them. Handed over as they are: a
    // component gets something it can give to an element, without reaching into `MatrixCall` to find it.
    const feeds = call.getFeeds();
    // The SDK says what each feed is for, and a shared screen travels alongside the camera rather than
    // instead of it. Told apart here, because whoever draws them draws them differently.
    const isAScreen = (feed: CallFeed) => feed.purpose === SDPStreamMetadataPurpose.Screenshare;
    const find = (mine: boolean, screen: boolean) =>
      feeds.find(feed => feed.isLocal() === mine && isAScreen(feed) === screen)?.stream;
    const reallyTalkingTo = call.getRemoteAssertedIdentity()?.id;
    const ownMedia = find(true, false);
    const remoteMedia = find(false, false);
    const ownScreen = find(true, true);
    const remoteScreen = find(false, true);
    return {
      ...(ownMedia ? { ownMedia } : {}),
      ...(remoteMedia ? { remoteMedia } : {}),
      ...(ownScreen ? { ownScreen } : {}),
      ...(remoteScreen ? { remoteScreen } : {}),
      id: call.callId,
      conversationId: call.roomId ?? "",
      callerId: placedHere ? this.ownUserId : (call.getOpponentMember()?.userId ?? ""),
      // What the call is now, not what it was placed as. A voice call somebody turns the camera on in becomes
      // a video call without ending, and a screen that keeps drawing it as voice hides the picture that is
      // arriving. The SDK says whether there is a picture on either side.
      isVideo: call.type === CallType.Video
        || call.hasLocalUserMediaVideoTrack
        || call.hasRemoteUserMediaVideoTrack,
      isMicrophoneMuted: call.isMicrophoneMuted(),
      isCameraMuted: call.isLocalVideoMuted(),
      isOnHold: call.isRemoteOnHold(),
      isSharingScreen: call.isScreensharing(),
      state: mapState(call.state),
      startedAt: this.startedAt.get(call.callId) ?? Date.now(),
      isOnHoldByThem: call.isLocalOnHold(),
      ...(this.wentWrong.has(call.callId) ? { wentWrong: this.wentWrong.get(call.callId) as string } : {}),
      ...(reallyTalkingTo ? { talkingTo: reallyTalkingTo } : {}),
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
