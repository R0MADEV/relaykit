import type { ConversationId, UserId } from "./ids.js";

/**
 * A call going on now among the people of a conversation. Matrix says who may be on it and who is; the
 * picture and the sound are carried by a server that cannot read them, because every frame leaves each
 * browser encrypted with keys that travel over Matrix. Two people on a call are a call with two on it: there
 * is one shape, however many there are.
 */
export interface Call {
  readonly id: string;
  readonly conversationId: ConversationId;
  /** Who placed it. The account itself when it was placed from here. */
  readonly callerId: UserId;
  readonly isVideo: boolean;
  readonly state: CallState;
  readonly startedAt: number;
  /**
   * When it stopped, set only on a call that is over. What a screen draws afterwards is how long it lasted,
   * and the start on its own cannot be subtracted from anything: this is the other half of that sum.
   */
  readonly endedAt?: number;
  /**
   * Everybody on the call, this side included. A call between two people is a conference with two in it, so
   * there is one list and not a special case: whoever draws a grid draws this, however many there are.
   */
  readonly participants: readonly CallParticipant[];
  /** Silenced here: the other side stops hearing, and the call carries on. */
  readonly isMicrophoneMuted: boolean;
  readonly isCameraMuted: boolean;
  /** What went wrong, when something did. A call that ends for a reason should be able to say which. */
  readonly wentWrong?: string;
  readonly isSharingScreen: boolean;
  /**
   * Whether what is said can be read only by the people on the call: every frame leaves each browser
   * encrypted with keys that travel over Matrix, and the server in the middle carries what it cannot read.
   * Absent while it is not known, which is before joining.
   */
  readonly isEncrypted?: boolean;
  /**
   * What to play, handed over rather than described: a screen cannot play a boolean. They go straight into an
   * `<audio>` or a `<video>` through `srcObject`, which is what the browser is waiting for.
   *
   * The browser's own `MediaStream`, because a call is a browser thing: they are absent where there is no
   * WebRTC, and absent until there is something to play.
   */
  readonly ownMedia?: MediaStream;
  readonly remoteMedia?: MediaStream;
  /**
   * A shared screen is a second thing to show, not a swap of the camera: both travel at once, so they are
   * handed over apart and a screen can draw the face small and the screen large, as any client does.
   *
   * `remoteMedia` and `remoteScreen` are the other person's when there is exactly one: the shortcut for the
   * call between two that most calls are. With more, `participants` is where everybody's is.
   */
  readonly ownScreen?: MediaStream;
  readonly remoteScreen?: MediaStream;
}

/**
 * `ringing` covers both waiting for an answer and being rung, because a screen draws the same thing either
 * way and knowing which side placed it is what `callerId` is for.
 */
export type CallState = "ringing" | "connected" | "ended";

/**
 * Somebody on a call. The device and not only the person, because the same account can be in from the laptop
 * and from the phone, and each one is a box on the screen with its own camera.
 */
export interface CallParticipant {
  readonly userId: UserId;
  readonly deviceId: string;
  /** Handed over rather than described, as with the call itself: it goes straight into a `<video>`. */
  readonly media?: MediaStream;
  /** A shared screen travels alongside the camera, so it is a second thing to draw and not a swap. */
  readonly screen?: MediaStream;
  readonly isMicrophoneMuted: boolean;
  readonly isCameraMuted: boolean;
  readonly joinedAt: number;
}

/**
 * Who is talking right now. Apart from `call.changed` on purpose: this changes several times a second, and
 * sending the whole call with it would have a screen repaint every face to light up one border.
 */
export interface CallSpeaking {
  readonly callId: string;
  readonly userIds: readonly UserId[];
}

/** How a call is going, as the browser reports it. Absent where there is nothing to say. */
export interface CallQuality {
  readonly packetsLost?: number;
  readonly jitterMs?: number;
  readonly roundTripMs?: number;
}

export const callStates: readonly CallState[] = ["ringing", "connected", "ended"];

export interface PlaceCallOptions {
  /** A call with video needs room on the screen, so whoever draws it has to be told beforehand. */
  readonly video?: boolean;
}

/**
 * A call that is over.
 *
 * Read from the conversation rather than remembered by whoever was watching: joining a call is written into
 * the room and leaving takes it back out, and both stay there. So the same history is had from any device,
 * including one that was not running while the call happened.
 */
export interface PastCall {
  readonly id: string;
  readonly conversationId: ConversationId;
  readonly startedAt: number;
  readonly endedAt: number;
  /** Everybody who was on it at any point, in the order they arrived. One alone means nobody else came. */
  readonly participantIds: readonly UserId[];
}
