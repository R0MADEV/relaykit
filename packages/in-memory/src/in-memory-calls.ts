import { SdkError } from "@relaykit/core";
import type {
  AdapterHandlers,
  PastCall,
  CallingAdapter,
  Call,
  CallParticipant,
  CallQuality,
  ConversationId,
  PlaceCallOptions,
  UserId
} from "@relaykit/core";

/** A call that has just started: nobody has silenced anything, held it or shown their screen. */
const nothingTouchedYet = {
  isEncrypted: true,
  isMicrophoneMuted: false,
  isCameraMuted: false,
  isSharingScreen: false
} as const;

/** Nobody is on a call yet: whoever starts it is the first to walk in. */
const nobodyYet: readonly CallParticipant[] = [];

/** What the calls of the double need from the adapter around them, and nothing else of it. */
export interface InMemoryCallsContext {
  readonly handlers: () => AdapterHandlers;
  readonly requireUserId: () => UserId;
  readonly deviceId: () => string | undefined;
  readonly hasConversation: (conversationId: ConversationId) => boolean;
  readonly nextId: () => number;
}

/**
 * The calls of the in-memory double: who is on one, who left, and which devices were picked.
 *
 * Kept apart from the rest of the double because none of it is shared. A call knows the conversation it is
 * in by its identifier and nothing more, so everything here can be read without the eight hundred lines of
 * conversations and messages that surround it.
 */
export class InMemoryCalls implements CallingAdapter {
  private readonly calls = new Map<string, Call>();
  /** Calls this side walked out of, which go on without it and stop being painted here. */
  private readonly left = new Set<string>();
  /** What is over, oldest first. A double keeps them; a homeserver reads them back out of the room. */
  private readonly over: PastCall[] = [];
  private chosenMicrophone: string | undefined;
  private chosenCamera: string | undefined;

  constructor(private readonly context: InMemoryCallsContext) {}

  /**
   * Starting a call is entering it first. Ringing the others is the homeserver's doing and a double has none,
   * so here it is the same as walking in; a test that wants somebody to be rung has `startConferenceAs`.
   */
  async placeCall(conversationId: ConversationId, options: PlaceCallOptions): Promise<Call> {
    return this.joinCall(conversationId, options);
  }

  /**
   * A call is entered, not started: if one is already going on in that conversation this joins that one,
   * because a screen opened twice must not put the same person in twice.
   */
  async joinCall(conversationId: ConversationId, options: PlaceCallOptions): Promise<Call> {
    if (!this.context.hasConversation(conversationId)) {
      throw new SdkError("CONVERSATION_NOT_FOUND", "That conversation is not here to call");
    }
    const going = [...this.calls.values()].find(call => call.conversationId === conversationId);
    if (going) return this.enter(going);
    const started: Call = {
      id: `memory-call-${this.context.nextId()}`,
      conversationId,
      callerId: this.context.requireUserId(),
      isVideo: options.video === true,
      state: "connected",
      startedAt: Date.now(),
      participants: nobodyYet,
      ...nothingTouchedYet
    };
    return this.enter(started);
  }

  /** Picking up what rang is walking into it. */
  async answerCall(callId: string, _options: PlaceCallOptions): Promise<Call> {
    const call = this.calls.get(callId);
    if (!call) throw new SdkError("INVALID_INPUT", "That call is not going on");
    const answered = this.enter(call);
    this.context.handlers().onCallChanged?.(answered);
    return answered;
  }

  /** Walking in, whether the call was already going on or has just been started by walking in. */
  private enter(call: Call): Call {
    this.left.delete(call.id);
    // Ringing was it going on without this side. With this side in it there is nothing left to wait for.
    const joined: Call = {
      ...this.withParticipant(call, this.context.requireUserId()),
      state: "connected"
    };
    this.calls.set(joined.id, joined);
    return joined;
  }

  private withParticipant(call: Call, userId: UserId): Call {
    if (call.participants.some(participant => participant.userId === userId)) return call;
    return {
      ...call,
      participants: [
        ...call.participants,
        {
          userId,
          deviceId: this.context.deviceId() ?? "memory-device",
          isMicrophoneMuted: false,
          isCameraMuted: false,
          joinedAt: Date.now()
        }
      ]
    };
  }

  /**
   * Leaving is not ending it: whoever is still on it carries on, and coming back has to find the same call.
   * Only a call nobody is left on stops going on.
   */
  async hangUpCall(callId: string): Promise<void> {
    const call = this.calls.get(callId);
    if (!call) return;
    const mine = this.context.requireUserId();
    const others = call.participants.filter(participant => participant.userId !== mine);
    if (others.length > 0) {
      this.calls.set(callId, { ...call, participants: others });
      this.left.add(callId);
      this.context.handlers().onCallChanged?.({
        ...call,
        participants: others,
        state: "ended",
        endedAt: Date.now()
      });
      return;
    }
    const endedAt = Date.now();
    this.calls.delete(callId);
    this.remember(call, endedAt);
    this.context.handlers().onCallChanged?.({ ...call, state: "ended", endedAt });
  }

  /** Not picking up: the call goes on without this side, which stops being told about it. */
  async rejectCall(callId: string): Promise<void> {
    await this.hangUpCall(callId);
  }

  async muteCallMicrophone(callId: string, muted: boolean): Promise<void> {
    this.change(callId, { isMicrophoneMuted: muted });
  }

  /** Turning the camera on makes it a video call, and turning it off leaves it one that had video. */
  async muteCallCamera(callId: string, muted: boolean): Promise<void> {
    this.change(callId, { isCameraMuted: muted, ...(muted ? {} : { isVideo: true }) });
  }

  async shareScreenInCall(callId: string, sharing: boolean): Promise<void> {
    this.change(callId, { isSharingScreen: sharing });
  }

  /** A double has no line to measure, so it says nothing rather than making numbers up. */
  async callQuality(callId: string): Promise<CallQuality> {
    if (!this.calls.has(callId)) throw new SdkError("INVALID_INPUT", "That call is not going on");
    return {};
  }

  async useMicrophone(deviceId: string): Promise<void> {
    this.chosenMicrophone = deviceId;
  }

  async useCamera(deviceId: string): Promise<void> {
    this.chosenCamera = deviceId;
  }

  /** Written down the moment it stops, which is the only time everybody who was on it is still known. */
  private remember(call: Call, endedAt: number): void {
    this.over.push({
      id: call.id,
      conversationId: call.conversationId,
      startedAt: call.startedAt,
      endedAt,
      participantIds: call.participants.map(participant => participant.userId)
    });
  }

  async listPastCalls(conversationId: ConversationId, limit: number): Promise<readonly PastCall[]> {
    return this.over
      .filter(call => call.conversationId === conversationId)
      .slice(-limit)
      .reverse();
  }

  private change(callId: string, change: Partial<Call>): void {
    const call = this.calls.get(callId);
    if (!call) throw new SdkError("INVALID_INPUT", "That call is not going on");
    const changed: Call = { ...call, ...change };
    this.calls.set(callId, changed);
    this.context.handlers().onCallChanged?.(changed);
  }

  /** What this side is in or is being rung for, which is what a screen paints. A call left goes on without it. */
  async listCalls(): Promise<readonly Call[]> {
    return [...this.calls.values()].filter(call => !this.left.has(call.id));
  }

  /**
   * Test helper: somebody else starts a call in this conversation. It rings here the way a room rings: not
   * asking to be answered, but there to be joined.
   */
  startAs(conversationId: ConversationId, userId: UserId): Call {
    const started: Call = {
      id: `memory-call-${this.context.nextId()}`,
      conversationId,
      callerId: userId,
      isVideo: false,
      state: "ringing",
      startedAt: Date.now(),
      participants: nobodyYet,
      ...nothingTouchedYet
    };
    const going = this.withParticipant(started, userId);
    this.calls.set(going.id, going);
    this.context.handlers().onCallIncoming?.(going);
    return going;
  }

  /** Test helper: the last of them leaves, and a call nobody is on is not going on any more. */
  end(callId: string): void {
    const call = this.calls.get(callId);
    if (!call) return;
    const endedAt = Date.now();
    this.calls.delete(callId);
    this.left.delete(callId);
    this.remember(call, endedAt);
    this.context.handlers().onCallChanged?.({
      ...call,
      participants: nobodyYet,
      state: "ended",
      endedAt
    });
  }

  /** Test helper: somebody else walks into a call that is already going on. */
  joinAs(callId: string, userId: UserId): void {
    const call = this.calls.get(callId);
    if (!call) throw new SdkError("INVALID_INPUT", "That call is not going on");
    const joined = this.withParticipant(call, userId);
    this.calls.set(callId, joined);
    this.context.handlers().onCallChanged?.(joined);
  }

  /** Test helper: whether a call is still going on at all, which is not the same as this side being on it. */
  isGoingOn(callId: string): boolean {
    return this.calls.has(callId);
  }

  /**
   * Test helper: somebody else starts sharing their screen. One screen at a time is the rule, and the last
   * to start is the one that stays: whoever was sharing stops, and is told so.
   */
  shareScreenAs(callId: string): void {
    const call = this.calls.get(callId);
    if (!call) throw new SdkError("INVALID_INPUT", "That call is not going on");
    if (!call.isSharingScreen) return;
    this.change(callId, { isSharingScreen: false });
  }

  /** Test helper: somebody starts talking, which is told apart from the call changing. */
  startSpeaking(callId: string, userIds: readonly UserId[]): void {
    this.context.handlers().onCallSpeaking?.({ callId, userIds });
  }
}
