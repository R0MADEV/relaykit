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
  /** The account's choice, remembered: a microphone picked before a call is the one the call goes out on. */
  private chosenMicrophone: { deviceId: string } | undefined;
  private chosenCamera: { deviceId: string } | undefined;

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
        ownUserId: client.getSafeUserId(),
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
  async join(
    client: MatrixClient,
    conversationId: ConversationId,
    options: PlaceCallOptions,
    { ring }: { ring: boolean }
  ): Promise<Call> {
    const callId = callIdFor(conversationId);
    const already = this.joined.get(callId);
    if (already) return this.describe(callId, already);

    const transport = this.rtc.findTransport(client);
    // Before anything else: a room from before calls lets only admins on one, and this is the one moment
    // somebody who can change that is standing in it with a reason to.
    await this.rtc.openTheDoorToCalls(client, conversationId);
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
    const ownIdentity = `${client.getSafeUserId()}:${client.getDeviceId() ?? ""}`;
    let ownKeyIsIn: () => void = () => undefined;
    const ownKey = new Promise<void>(resolve => {
      ownKeyIsIn = resolve;
    });
    const keyArrived = (key: Uint8Array, keyIndex: number, _member: unknown, identity: string): void => {
      void keys.receive(key, identity, keyIndex).then(() => {
        if (identity === ownIdentity) ownKeyIsIn();
      });
    };
    session.on(MatrixRTCSessionEvent.EncryptionKeyChanged, keyArrived);
    // The SDK writes who is on the call into the room in the background, and a room can refuse: somebody
    // without the right to say so is on the SFU and, to everybody else, not on the call. That is a call that
    // went wrong, and it has to say why rather than sit there connected and unheard.
    const refused = (error: unknown): void => {
      const going = this.joined.get(callId);
      if (!going) return;
      this.joined.delete(callId);
      const why = error instanceof Error ? error.message : String(error);
      const ended = { ...this.describe(callId, going), state: "ended" as const, wentWrong: why };
      void walkOutOf(going).finally(() => this.report?.(ended));
    };
    session.on(MatrixRTCSessionEvent.MembershipManagerError, refused);

    const going: Joined = {
      room: new engine.Room({
        // Off on purpose. Adaptive stream delivers video only to tracks the engine itself has attached to
        // an element it can see, and nothing here attaches anything: the stream is handed over and the
        // application draws it. Left on, everybody else's picture arrives as one frame and then black.
        adaptiveStream: false,
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
      stopListening: () => {
        session.off(MatrixRTCSessionEvent.EncryptionKeyChanged, keyArrived);
        session.off(MatrixRTCSessionEvent.MembershipManagerError, refused);
      }
    };

    this.listen(callId, going, engine.RoomEvent);
    await going.room.connect(ticket.url, ticket.jwt);
    await going.room.setE2EEEnabled(true);
    // Said in the room only once this side is really connected: announcing first would have everybody
    // else's screen show somebody who never arrived, if the connection failed. Asking the SDK to manage the
    // keys is what makes it make one for this side and share it with the rest.
    // Ringing is the SDK's notification, sent along with the membership: starting a call rings the others,
    // walking into one already going on does not.
    session.joinRoomSession([transport], undefined, {
      manageMediaKeys: true,
      // Whether there is a picture, said in the room: whoever is rung has to make room on the screen before
      // any frame arrives, and this is the only place they can learn it from.
      callIntent: options.video === true ? "video" : "audio",
      ...(ring ? { notificationType: "ring" } : {})
    });
    // Keys the SDK already had before anybody was listening — everybody else's, for a call joined late.
    session.reemitEncryptionKeys();
    // Nothing is sent before this side's own key is in: a frame encrypted with no key is a frame dropped, and
    // the first seconds of every call would be silence. Bounded, because a key that never comes should show
    // up as a call nobody can hear, not as a join that never returns.
    await Promise.race([ownKey, new Promise<void>(resolve => setTimeout(resolve, ownKeyPatienceMs))]);
    await going.room.localParticipant.setMicrophoneEnabled(true, this.chosenMicrophone);
    if (options.video === true) await going.room.localParticipant.setCameraEnabled(true, this.chosenCamera);
    this.joined.set(callId, going);
    return this.describe(callId, going);
  }

  /** Picking up what rang: the call the room announced is entered, and it stops being a thing apart. */
  async answer(client: MatrixClient, callId: string, options: PlaceCallOptions): Promise<Call> {
    const ringing = this.announced.get(callId);
    if (!ringing) throw new SdkError("INVALID_INPUT", "That call is not ringing here");
    return this.join(client, ringing.conversationId, options, { ring: false });
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
    // Over for this side the moment it hangs up, and said so at once: taking the connection and the room's
    // account of it down is network work, and a screen must not stay on a call waiting for a write to land.
    this.report?.({ ...this.describe(callId, going), state: "ended" });
    await walkOutOf(going);
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

  /** Which microphone from now on: in every call this side is on, and in the next one. */
  async useMicrophone(deviceId: string): Promise<void> {
    this.chosenMicrophone = { deviceId };
    await Promise.all(
      [...this.joined.values()].map(going => going.room.switchActiveDevice("audioinput", deviceId))
    );
  }

  async useCamera(deviceId: string): Promise<void> {
    this.chosenCamera = { deviceId };
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
    going.room.on(events.TrackPublished, changed);
    going.room.on(events.TrackSubscribed, changed);
    going.room.on(events.TrackUnsubscribed, changed);
    // After the publication is gone, not only after its track is: unsubscribed arrives while the engine still
    // lists it, and a screen that stopped being shared would stay on everybody else's screen.
    going.room.on(events.TrackUnpublished, changed);
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
    const [ownAsAParticipant, ...others] = participants;
    const ownMedia = ownAsAParticipant?.media;
    const ownScreen = ownAsAParticipant?.screen;
    // The shortcut for the call between two that most calls are: the one other person's, when there is one.
    const theOther = others.length === 1 ? others[0] : undefined;
    const somebodyHasACameraOn = participants.some(participant => !participant.isCameraMuted);
    return {
      ...(ownMedia === undefined ? {} : { ownMedia }),
      ...(ownScreen === undefined ? {} : { ownScreen }),
      ...(theOther?.media === undefined ? {} : { remoteMedia: theOther.media }),
      ...(theOther?.screen === undefined ? {} : { remoteScreen: theOther.screen }),
      id: callId,
      conversationId: going.conversationId,
      callerId: going.startedBy,
      // What it is now and not what it was joined as: somebody turning a camera on makes it a video call,
      // and a screen still drawing it as voice hides the picture that is arriving.
      isVideo: somebodyHasACameraOn,
      state: "connected",
      startedAt: going.startedAt,
      participants,
      // What this side sends is encrypted before it leaves the browser; the SFU carries what it cannot read.
      isEncrypted: going.room.isE2EEEnabled,
      isMicrophoneMuted: !own.isMicrophoneEnabled,
      isCameraMuted: !own.isCameraEnabled,
      isSharingScreen: ownScreen !== undefined
    };
  }

  /**
   * A conference known only from what the room says: who is on it, since when, and nothing to play yet.
   * `ringing` is the honest word — it is going on without this side, and there is something to join.
   */
  private describeAnnounced(callId: string, going: Announced): Call {
    const people = peopleOnARingingCall(going.session.memberships, going.ownUserId);
    const participants: CallParticipant[] = people.map(member => ({
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
      // What the people already on it agreed it is, which is what a screen ringing has to make room for.
      isVideo: going.session.getConsensusCallIntent() === "video",
      state: "ringing",
      startedAt: going.startedAt,
      participants,
      isMicrophoneMuted: false,
      isCameraMuted: false,
      isSharingScreen: false
    };
  }
}

/** How long to wait for this side's own key before sending anyway. The SDK makes it at once; the network may not. */
const ownKeyPatienceMs = 5000;

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

/** What a membership says that a ringing screen needs: who, from which device, since when. */
export interface SaidToBeOnTheCall {
  readonly userId: string;
  readonly deviceId: string;
  createdTs(): number;
}

/**
 * The room says one entry per device, and a device that died without leaving stays said for hours. A screen
 * ringing for a call draws people, not the devices they have lost along the way: one per person, from
 * whichever of their devices spoke last, in the order the people arrived. Once inside, who is really
 * connected is known from the SFU and none of this is used.
 */
export function newestPerPerson<T extends SaidToBeOnTheCall>(memberships: readonly T[]): T[] {
  const newest = new Map<string, T>();
  // When each person first turned up, whichever device it was: that is the order a screen lists them in,
  // and it must not change because somebody opened a second device later.
  const arrived = new Map<string, number>();
  for (const member of memberships) {
    const known = newest.get(member.userId);
    if (!known || member.createdTs() > known.createdTs()) newest.set(member.userId, member);
    arrived.set(member.userId, Math.min(arrived.get(member.userId) ?? Infinity, member.createdTs()));
  }
  return [...newest.values()].sort(
    (one, other) => (arrived.get(one.userId) ?? 0) - (arrived.get(other.userId) ?? 0)
  );
}

/**
 * Who a screen ringing for a call shows: everybody but this account. What an older device of yours left
 * behind is not you, and while it rings you are not on it — and if your phone really is, you know.
 */
export function peopleOnARingingCall<T extends SaidToBeOnTheCall>(
  memberships: readonly T[],
  ownUserId: string
): T[] {
  return newestPerPerson(memberships.filter(member => member.userId !== ownUserId));
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
  // A session the room refused, or one already left, has nothing to take down; asking it to warns and does
  // nothing, and a log full of that hides the warning that matters. Bounded: a homeserver that will not take
  // the leave should not keep a client hanging for it, and the membership expires on its own.
  if (going.session.isJoined()) await going.session.leaveRoomSession(leavePatienceMs);
  await going.session.stop();
}

/** How long to wait for the room to take this side's leave before moving on without it. */
const leavePatienceMs = 5000;

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
  readonly ownUserId: UserId;
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
