import { SdkError } from "@relaykit/core";
import { qualityFrom, statsIn } from "./call-quality.js";
import type {
  Call,
  CallParticipant,
  CallQuality,
  CallSpeaking,
  ConversationId,
  PlaceCallOptions,
  UserId
} from "@relaykit/core";
import type { MatrixClient } from "matrix-js-sdk";
import type { MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc/index.js";
import type { Participant, Room as LiveKitRoom, Track } from "livekit-client";
import type { MatrixRtc } from "./matrix-rtc.js";

/**
 * The other half of a conference: the one that carries the picture and the sound. Everything here is the
 * SFU's own doing — publishing, subscribing, simulcast, working out what each line can take, reconnecting
 * when it drops. None of that is written here, and none of it should be.
 *
 * What this file does is translate. A `Room` of the SFU becomes a `Call` and its participants become
 * `CallParticipant`, so no word of the SFU's own vocabulary reaches whoever draws the screen. That is not
 * paperwork: it is what keeps the SFU replaceable, the same way a `room_id` never reaches an application.
 */
export class MatrixConference {
  private readonly joined = new Map<string, Joined>();
  private report: ((call: Call) => void) | undefined;
  private speaking: ((speaking: CallSpeaking) => void) | undefined;

  constructor(private readonly rtc: MatrixRtc) {}

  watch(report: (call: Call) => void, speaking: (speaking: CallSpeaking) => void): void {
    this.report = report;
    this.speaking = speaking;
  }

  /**
   * Entering the conference of a conversation. Joining what is already joined gives back the same call: a
   * screen opened twice must not put the same person in the room twice.
   */
  async join(client: MatrixClient, conversationId: ConversationId, options: PlaceCallOptions): Promise<Call> {
    const callId = callIdFor(conversationId);
    const already = this.joined.get(callId);
    if (already) return this.describe(callId, already);

    const transport = this.rtc.findTransport(client);
    const ticket = await this.rtc.ticketFor(client, transport, conversationId);
    // Loaded only now: an application that does chat and never opens a conference should not carry the whole
    // media engine in its bundle for a thing it does not use.
    const { Room, RoomEvent, Track: trackSources } = await loadTheMediaEngine();
    const session = this.rtc.sessionFor(client, conversationId);
    const going: Joined = {
      room: new Room({ adaptiveStream: true, dynacast: true }),
      session,
      conversationId,
      startedAt: Date.now(),
      // Whoever was on the call first, which for a conference is nearer the truth than whoever just walked in.
      startedBy: session.memberships[0]?.userId ?? client.getSafeUserId(),
      microphone: trackSources.Source.Microphone,
      cameraAndMicrophone: [trackSources.Source.Camera, trackSources.Source.Microphone],
      screenShare: [trackSources.Source.ScreenShare]
    };

    this.listen(callId, going, RoomEvent);
    await going.room.connect(ticket.url, ticket.jwt);
    await going.room.localParticipant.setMicrophoneEnabled(true);
    if (options.video === true) await going.room.localParticipant.setCameraEnabled(true);
    // Said in the room only once this side is really on the call: announcing first would have everybody
    // else's screen show somebody who never arrived, if the connection failed.
    session.joinRoomSession([transport]);
    this.joined.set(callId, going);
    return this.describe(callId, going);
  }

  /**
   * Leaving. The conference carries on without this side, so this walks out and takes down what the room
   * says about this device. It ends nothing for anybody else.
   */
  async leave(callId: string): Promise<void> {
    const going = this.joined.get(callId);
    if (!going) return;
    this.joined.delete(callId);
    await going.room.disconnect();
    await going.session.leaveRoomSession();
    this.report?.({ ...this.describe(callId, going), state: "ended" });
  }

  /** Silencing is not leaving: this stops publishing, and the rest carry on hearing each other. */
  async setMicrophone(callId: string, on: boolean): Promise<void> {
    await this.require(callId).room.localParticipant.setMicrophoneEnabled(on);
  }

  async setCamera(callId: string, on: boolean): Promise<void> {
    await this.require(callId).room.localParticipant.setCameraEnabled(on);
  }

  /** A shared screen travels alongside the camera rather than instead of it, so both can be drawn. */
  async setScreenShare(callId: string, on: boolean): Promise<void> {
    await this.require(callId).room.localParticipant.setScreenShareEnabled(on);
  }

  /** How it is going, read from the browser as it is for a direct call, so a screen can say why. */
  async quality(callId: string): Promise<CallQuality> {
    const going = this.require(callId);
    const heardFrom = [...going.room.remoteParticipants.values()]
      .map(participant => participant.getTrackPublication(going.microphone)?.track)
      .find(track => track !== undefined);
    return qualityFrom(statsIn(await heardFrom?.getRTCStatsReport()));
  }

  /** What this side is in, which is what a screen opened in the middle of a call paints. */
  list(): readonly Call[] {
    return [...this.joined].map(([callId, going]) => this.describe(callId, going));
  }

  isGoingOn(callId: string): boolean {
    return this.joined.has(callId);
  }

  /** Walking out of everything, for a client that is stopping and must leave nothing connected behind. */
  async forget(): Promise<void> {
    const going = [...this.joined.values()];
    this.joined.clear();
    await Promise.all(going.map(one => one.room.disconnect()));
  }

  /**
   * What the room says, as it says it. Everything structural is one event — somebody arrives, a camera goes
   * on, a microphone is silenced — and it redraws the call.
   */
  private listen(callId: string, going: Joined, events: MediaEngine["RoomEvent"]): void {
    const changed = (): void => this.report?.(this.describe(callId, going));
    going.room.on(events.ParticipantConnected, changed);
    going.room.on(events.ParticipantDisconnected, changed);
    going.room.on(events.TrackSubscribed, changed);
    going.room.on(events.TrackUnsubscribed, changed);
    going.room.on(events.TrackMuted, changed);
    going.room.on(events.TrackUnmuted, changed);
    going.room.on(events.LocalTrackPublished, changed);
    going.room.on(events.LocalTrackUnpublished, changed);
    // Told apart from the call changing on purpose: this fires several times a second, and a grid that
    // repainted every face to light up one border would be unusable with a dozen people in it.
    going.room.on(events.ActiveSpeakersChanged, speakers => {
      this.speaking?.({ callId, userIds: speakers.map(speaker => whoIs(speaker.identity).userId) });
    });
    // Dropped by the server, or the network gone for good: the call is over whether anybody asked or not.
    going.room.on(events.Disconnected, () => {
      if (!this.joined.has(callId)) return;
      this.joined.delete(callId);
      this.report?.({ ...this.describe(callId, going), state: "ended" });
    });
  }

  private require(callId: string): Joined {
    const going = this.joined.get(callId);
    if (!going) throw new SdkError("INVALID_INPUT", "That call is not going on");
    return going;
  }

  private describe(callId: string, going: Joined): Call {
    const own = going.room.localParticipant;
    const everybody = [own, ...going.room.remoteParticipants.values()];
    const participants = everybody.map(participant => describeParticipant(participant, going));
    // This side is the first of them by construction, so what it is showing is read from there rather than
    // worked out a second time from the same tracks.
    const [ownAsAParticipant] = participants;
    const ownMedia = ownAsAParticipant?.media;
    const ownScreen = ownAsAParticipant?.screen;
    const somebodyHasACameraOn = participants.some(participant => !participant.isCameraMuted);
    return {
      ...(ownMedia === undefined ? {} : { ownMedia }),
      ...(ownScreen === undefined ? {} : { ownScreen }),
      id: callId,
      conversationId: going.conversationId,
      callerId: going.startedBy,
      // What it is now and not what it was joined as: somebody turning a camera on makes it a video call,
      // and a screen still drawing it as voice hides the picture that is arriving.
      isVideo: somebodyHasACameraOn,
      state: "connected",
      startedAt: going.startedAt,
      kind: "conference",
      participants,
      isMicrophoneMuted: !own.isMicrophoneEnabled,
      isCameraMuted: !own.isCameraEnabled,
      // A room has no other end to make wait, which is why holding is refused before it ever reaches here.
      isOnHold: false,
      isOnHoldByThem: false,
      isSharingScreen: ownScreen !== undefined
    };
  }
}

/**
 * The media engine, fetched only when a conference is actually opened. An application that does chat and
 * never opens one should not carry it in its bundle for a thing it does not use.
 */
function loadTheMediaEngine() {
  return import("livekit-client");
}

/** What that import gives back, named so the rest of the file can be typed against it without repeating it. */

type MediaEngine = Awaited<ReturnType<typeof loadTheMediaEngine>>;

/** What is kept about a conference this side is in. The SFU and the SDK keep everything else. */
interface Joined {
  readonly room: LiveKitRoom;
  /** The SDK's own: it writes who is on the call into the room and takes it back down on the way out. */
  readonly session: MatrixRTCSession;
  readonly conversationId: ConversationId;
  readonly startedAt: number;
  readonly startedBy: UserId;
  /**
   * The names the SFU gives the kinds of track, kept from when it was loaded. The module arrives late
   * because it is loaded late, and nothing that draws a call should have to wait for it again.
   */
  readonly microphone: Track.Source;
  readonly cameraAndMicrophone: readonly Track.Source[];
  readonly screenShare: readonly Track.Source[];
}

/**
 * One conference per conversation, named after it. Deliberately not a random id: a second screen joining
 * has to arrive at the same call, and this is what makes rejoining find what is already going on.
 */
function callIdFor(conversationId: ConversationId): string {
  return `conference:${conversationId}`;
}

/**
 * The SFU knows one string per participant and nothing else about them. The service that admits people puts
 * the Matrix user and their device in it, joined by a colon — and a Matrix user id has colons of its own,
 * so it is the last one that separates them.
 */
function whoIs(identity: string): { userId: UserId; deviceId: string } {
  const separator = identity.lastIndexOf(":");
  const looksLikeAUserWithADevice = identity.startsWith("@") && separator > 0;
  if (!looksLikeAUserWithADevice) return { userId: identity, deviceId: "" };
  return { userId: identity.slice(0, separator), deviceId: identity.slice(separator + 1) };
}

function describeParticipant(participant: Participant, going: Joined): CallParticipant {
  const media = streamOf(participant, going.cameraAndMicrophone);
  const screen = streamOf(participant, going.screenShare);
  return {
    ...(media === undefined ? {} : { media }),
    ...(screen === undefined ? {} : { screen }),
    ...whoIs(participant.identity),
    isMicrophoneMuted: !participant.isMicrophoneEnabled,
    isCameraMuted: !participant.isCameraEnabled,
    joinedAt: participant.joinedAt?.getTime() ?? going.startedAt
  };
}

/**
 * Handed over as a `MediaStream` rather than described, as everywhere else: a screen cannot play a boolean,
 * and this goes straight into the `srcObject` of an element.
 */
function streamOf(participant: Participant, sources: readonly Track.Source[]): MediaStream | undefined {
  const tracks = participant
    .getTrackPublications()
    .filter(publication => sources.includes(publication.source))
    .map(publication => publication.track?.mediaStreamTrack)
    .filter(track => track !== undefined);
  if (tracks.length === 0) return undefined;
  return new MediaStream(tracks);
}
