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

  place(client: MatrixClient, conversationId: ConversationId, options: PlaceCallOptions): Call {
    const call = client.createCall(conversationId);
    if (!call) {
      throw new Error("This conversation cannot be called");
    }
    this.keep(call);
    // Placing it is asynchronous by nature: the other side has to be rung. What comes back is the call as it
    // is now, and every move after this arrives through `call.changed`.
    void (options.video ? call.placeVideoCall() : call.placeVoiceCall());
    return this.describe(call);
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
    call.on(CallEvent.State, () => {
      this.report?.(this.describe(call));
      // A call that is over stops being one that is going on, so a screen listing them does not keep it.
      if (call.state === MatrixCallState.Ended) this.going.delete(call.callId);
    });
  }

  /** The neutral shape. `ringing` covers waiting for an answer and being rung: a screen draws the same. */
  private describe(call: MatrixCall): Call {
    const placedHere = call.direction === CallDirection.Outbound;
    return {
      id: call.callId,
      conversationId: call.roomId ?? "",
      callerId: placedHere ? this.ownUserId : (call.getOpponentMember()?.userId ?? ""),
      isVideo: call.type === CallType.Video,
      state: mapState(call.state),
      startedAt: Date.now(),
      hasRemoteMedia: call.getFeeds().some(feed => !feed.isLocal())
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
