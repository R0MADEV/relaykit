import { SdkError } from "@relaykit/core";
import { qualityFrom, statsIn } from "./call-quality.js";
import { keysFor } from "./conference-keys.js";
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
import {
  MatrixRTCSessionEvent,
  MatrixRTCSessionManagerEvents,
  type MatrixRTCSession
} from "matrix-js-sdk/lib/matrixrtc/index.js";
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
  /** Going on without this side: the room says so, nobody here has entered, and there is no media yet. */
  private readonly announced = new Map<string, Announced>();
  private report: ((call: Call) => void) | undefined;
  private speaking: ((speaking: CallSpeaking) => void) | undefined;
  private announce: ((call: Call) => void) | undefined;
  private stopFollowing: (() => void) | undefined;

  constructor(private readonly rtc: MatrixRtc) {}

  watch(
    report: (call: Call) => void,
    speaking: (speaking: CallSpeaking) => void,
    announce: (call: Call) => void
  ): void {
    this.report = report;
    this.speaking = speaking;
    this.announce = announce;
  }

  /**
   * Told by the SDK when a conference starts or ends in any room this account is in. That is what makes a
   * screen ring for a room: nobody is called, but something has begun that can be joined.
   */
  follow(client: MatrixClient): void {
    const started = (roomId: string, session: MatrixRTCSession): void => {
      const callId = callIdFor(roomId);
      const alreadyKnown = this.joined.has(callId) || this.announced.has(callId);
      if (alreadyKnown) return;
      // This side's own membership arriving is not somebody else's call. Only other people ring.
      const somebodyElse = session.memberships.some(member => !isThisDevice(client, member));
      if (!somebodyElse) return;
      const changed = (): void => {
        const going = this.announced.get(callId);
        if (going) this.report?.(this.describeAnnounced(callId, going));
      };
      session.on(MatrixRTCSessionEvent.MembershipsChanged, changed);
      const going: Announced = {
        session,
        conversationId: roomId,
        startedAt: Math.min(...session.memberships.map(member => member.createdTs())),
        stopListening: () => session.off(MatrixRTCSessionEvent.MembershipsChanged, changed)
      };
      this.announced.set(callId, going);
      this.announce?.(this.describeAnnounced(callId, going));
    };
    const ended = (roomId: string): void => {
      const callId = callIdFor(roomId);
      const going = this.announced.get(callId);
      if (!going) return;
      this.announced.delete(callId);
      going.stopListening();
      this.report?.({ ...this.describeAnnounced(callId, going), participants: [], state: "ended" });
    };
    client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionStarted, started);
    client.matrixRTC.on(MatrixRTCSessionManagerEvents.SessionEnded, ended);
    this.stopFollowing = () => {
      client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionStarted, started);
      client.matrixRTC.off(MatrixRTCSessionManagerEvents.SessionEnded, ended);
    };
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
    const engine = await loadTheMediaEngine();
    const session = this.rtc.sessionFor(client, conversationId);
    // What was ringing is what is being entered, so it stops being a thing apart.
    const wasAnnounced = this.announced.get(callId);
    wasAnnounced?.stopListening();
    this.announced.delete(callId);

    // The keys come from Matrix and the engine encrypts with them. Listened for before joining, because the
    // SDK hands over this side's own key the moment it makes one, and a key nobody caught is a call nobody
    // can hear.
    const keys = keysFor(engine);
    const keyArrived = (key: Uint8Array, keyIndex: number, _member: unknown, identity: string): void => {
      void keys.receive(key, identity, keyIndex);
    };
    session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, keyArrived);

    const going: Joined = {
      room: new engine.Room({
        adaptiveStream: true,
        dynacast: true,
        e2ee: { keyProvider: keys, worker: encryptionWorker() }
      }),
      session,
      conversationId,
      startedAt: wasAnnounced?.startedAt ?? Date.now(),
      // Whoever was on the call first, which for a conference is nearer the truth than whoever just walked in.
      startedBy: session.memberships[0]?.userId ?? client.getSafeUserId(),
      microphone: engine.Track.Source.Microphone,
      cameraAndMicrophone: [engine.Track.Source.Camera, engine.Track.Source.Microphone],
      screenShare: [engine.Track.Source.ScreenShare],
      stopListening: () => session.off(MatrixRTCSessionEvent.EncryptionKeyChanged, keyArrived)
    };

    this.listen(callId, going, engine.RoomEvent);
    await going.room.connect(ticket.url, ticket.jwt);
    await going.room.setE2EEEnabled(true);
    await going.room.localParticipant.setMicrophoneEnabled(true);
    if (options.video === true) await going.room.localParticipant.setCameraEnabled(true);
    // Said in the room only once this side is really on the call: announcing first would have everybody
    // else's screen show somebody who never arrived, if the connection failed. Asking the SDK to manage the
    // keys is what makes it make one for this side and share it with the rest.
    session.joinRoomSession([transport], undefined, { manageMediaKeys: true });
    // Keys the SDK already had before anybody was listening — everybody else's, for a call joined late.
    session.reemitEncryptionKeys();
    this.joined.set(callId, going);
    return this.describe(callId, going);
  }

  /**
   * Leaving. The conference carries on without this side, so this walks out and takes down what the room
   * says about this device. It ends nothing for anybody else. Leaving what was only ringing is dismissing
   * it: it goes on without this side, and this side simply stops being told.
   */
  async leave(callId: string): Promise<void> {
    const ringing = this.announced.get(callId);
    if (ringing) {
      this.announced.delete(callId);
      ringing.stopListening();
      this.report?.({ ...this.describeAnnounced(callId, ringing), state: "ended" });
      return;
    }
    const going = this.joined.get(callId);
    if (!going) return;
    this.joined.delete(callId);
    const ended = { ...this.describe(callId, going), state: "ended" as const };
    await walkOutOf(going);
    this.report?.(ended);
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

  /** Which microphone from now on, in every conference this side is in: it is the account's choice. */
  async useMicrophone(deviceId: string): Promise<void> {
    await Promise.all(
      [...this.joined.values()].map(going => going.room.switchActiveDevice("audioinput", deviceId))
    );
  }

  async useCamera(deviceId: string): Promise<void> {
    await Promise.all(
      [...this.joined.values()].map(going => going.room.switchActiveDevice("videoinput", deviceId))
    );
  }

  /** How it is going, read from the browser as it is for a direct call, so a screen can say why. */
  async quality(callId: string): Promise<CallQuality> {
    const going = this.require(callId);
    const heardFrom = [...going.room.remoteParticipants.values()]
      .map(participant => participant.getTrackPublication(going.microphone)?.track)
      .find(track => track !== undefined);
    return qualityFrom(statsIn(await heardFrom?.getRTCStatsReport()));
  }

  /** What is going on: what this side is in, and what is ringing. A screen opened mid-call paints both. */
  list(): readonly Call[] {
    return [
      ...[...this.joined].map(([callId, going]) => this.describe(callId, going)),
      ...[...this.announced].map(([callId, going]) => this.describeAnnounced(callId, going))
    ];
  }

  isGoingOn(callId: string): boolean {
    return this.joined.has(callId) || this.announced.has(callId);
  }

  /** Walking out of everything, for a client that is stopping and must leave nothing behind it. */
  async forget(): Promise<void> {
    this.stopFollowing?.();
    this.stopFollowing = undefined;
    for (const ringing of this.announced.values()) ringing.stopListening();
    this.announced.clear();
    const going = [...this.joined.values()];
    this.joined.clear();
    await Promise.all(going.map(walkOutOf));
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
      going.stopListening();
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

  /**
   * A conference known only from what the room says: who is on it, since when, and nothing to play yet.
   * `ringing` is the honest word — it is going on without this side, and there is something to join.
   */
  private describeAnnounced(callId: string, going: Announced): Call {
    const participants: CallParticipant[] = going.session.memberships.map(member => ({
      userId: member.userId,
      deviceId: member.deviceId,
      isMicrophoneMuted: false,
      isCameraMuted: false,
      joinedAt: member.createdTs()
    }));
    return {
      id: callId,
      conversationId: going.conversationId,
      callerId: participants[0]?.userId ?? "",
      isVideo: false,
      state: "ringing",
      startedAt: going.startedAt,
      kind: "conference",
      participants,
      isMicrophoneMuted: false,
      isCameraMuted: false,
      isOnHold: false,
      isOnHoldByThem: false,
      isSharingScreen: false
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

/**
 * Where the engine encrypts and decrypts every frame, off the thread that draws the screen. The bundler
 * resolves the engine's own worker from this, which is the one way to name a worker that every bundler
 * understands.
 */
function encryptionWorker(): Worker {
  return new Worker(new URL("livekit-client/e2ee-worker", import.meta.url), { type: "module" });
}

/** Whether a membership is this very device's, which is the one that must not ring for itself. */
function isThisDevice(client: MatrixClient, member: { userId: string; deviceId: string }): boolean {
  return member.userId === client.getSafeUserId() && member.deviceId === client.getDeviceId();
}

/**
 * Leaving, in all the ways a conference has to be left. Dropping the connection is the easy half: what the
 * room says about this device has to come down too, or somebody who walked out is still drawn on the call
 * until their membership runs out hours later. Stopping the session is what stops it being kept alive.
 */
async function walkOutOf(going: Joined): Promise<void> {
  going.stopListening();
  await going.room.disconnect();
  await going.session.leaveRoomSession();
  await going.session.stop();
}

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
  /** Stops taking keys from the session, for when this side is no longer on the call they are for. */
  readonly stopListening: () => void;
}

/** A conference the room says is going on, that this side has not entered. */
interface Announced {
  readonly session: MatrixRTCSession;
  readonly conversationId: ConversationId;
  readonly startedAt: number;
  readonly stopListening: () => void;
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
