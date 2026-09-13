import { SdkError } from "@relaykit/core";
import type { ConversationId } from "@relaykit/core";
import { EventType, type MatrixClient, type Room } from "matrix-js-sdk";
import type { RoomPowerLevelsEventContent } from "matrix-js-sdk/lib/@types/state_events.js";
import { isLivekitTransportConfig, type MatrixRTCSession } from "matrix-js-sdk/lib/matrixrtc/index.js";
import type { LivekitTransportConfig } from "matrix-js-sdk/lib/matrixrtc/LivekitTransport.js";

/**
 * The Matrix half of a conference, and only that half: where the media is to be carried, and the leave that
 * gets this device in. Not a frame of picture or sound goes through here.
 *
 * Saying in the room who is on the call is the SDK's own work — `MatrixRTCSession` writes the memberships,
 * keeps them alive and hands out the encryption keys — so none of that is written here. What the SDK does
 * not do is turn a Matrix identity into something the SFU will accept, because the SFU is not Matrix. That
 * exchange is the whole of this file.
 */

/** Leave to get in, good for one room. The SFU checks this and knows nothing else about anybody. */
export interface ConferenceTicket {
  readonly url: string;
  readonly jwt: string;
}

/** The two names a call membership is written under: the one the SDK writes today, and the settled one. */
const membershipEventTypes = [EventType.GroupCallMemberPrefix, EventType.RTCMembership];

/** The homeserver advertises where its conferences are carried under this name, alongside its own address. */
const rtcFociWellKnownKey = "org.matrix.msc4143.rtc_foci";

export class MatrixRtc {
  /** Given by the application when there is no `.well-known` to ask, which is every development machine. */
  constructor(private readonly configuredServiceUrl?: string) {}

  /**
   * Where conferences are carried, as the homeserver says in the same `.well-known` a client reads to find
   * the homeserver itself. One that says nothing cannot hold conferences, and saying so plainly beats a call
   * that connects to nowhere and waits.
   */
  findTransport(client: MatrixClient): LivekitTransportConfig {
    if (this.configuredServiceUrl) {
      return { type: "livekit", livekit_service_url: this.configuredServiceUrl };
    }
    const advertised: unknown = client.getClientWellKnown()?.[rtcFociWellKnownKey];
    if (!Array.isArray(advertised)) {
      throw new SdkError(
        "NOT_SUPPORTED",
        "This homeserver does not say where conferences are carried, so there is nowhere to hold one"
      );
    }
    const livekit = advertised.find(isLivekitTransportConfig);
    if (!livekit) {
      throw new SdkError("NOT_SUPPORTED", "This homeserver carries conferences somewhere this cannot reach");
    }
    return livekit;
  }

  /**
   * The way in. The service is not told who this is and asked to believe it: it is handed an OpenID token,
   * which it takes back to the homeserver to be told whose it is. That is why a stolen room id gets nobody
   * in, and why nobody can be let in on somebody else's behalf.
   */
  async ticketFor(
    client: MatrixClient,
    transport: LivekitTransportConfig,
    conversationId: ConversationId
  ): Promise<ConferenceTicket> {
    const openIdToken = await client.getOpenIdToken();
    const service = transport.livekit_service_url.replace(/\/$/, "");
    const response = await fetch(`${service}/sfu/get`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        room: conversationId,
        openid_token: openIdToken,
        device_id: client.getDeviceId() ?? ""
      })
    });
    if (!response.ok) {
      const said = await response.text();
      throw new SdkError(
        "ADAPTER_ERROR",
        `The conference service refused to let this device in: ${response.status} ${said}`
      );
    }
    return readTicket(await response.json());
  }

  /**
   * A room made before calls were, or by another client, still has the defaults: only its admins may say
   * they are on a call, and everybody else is refused with a 403 they never see. Whoever starts a call in
   * it and may change the room's power levels opens the two names a membership is written under to
   * everybody, once, and touches nothing else. Whoever may not leaves it as it is, and their own join says
   * why when the room refuses them.
   *
   * The levels are asked of the homeserver and never read off what this client happens to hold: a window
   * over the conversations brings only the state it was asked for, and writing power levels worked out from
   * a missing event once replaced a room's whole list with two entries — and locked its own admin out.
   */
  async openTheDoorToCalls(client: MatrixClient, conversationId: ConversationId): Promise<void> {
    const levels = await this.powerLevelsOf(client, conversationId);
    // A room the homeserver has no power levels for is not one to invent them for.
    if (!levels) return;
    const everybody = levels.users_default ?? 0;
    const neededFor = (eventType: string): number => levels.events?.[eventType] ?? levels.state_default ?? 50;
    const alreadyOpen = membershipEventTypes.every(eventType => neededFor(eventType) <= everybody);
    if (alreadyOpen) return;
    const mine = levels.users?.[client.getSafeUserId()] ?? everybody;
    const mayOpenIt = mine >= neededFor(EventType.RoomPowerLevels);
    if (!mayOpenIt) return;
    const opened: RoomPowerLevelsEventContent = {
      ...levels,
      events: {
        ...levels.events,
        ...Object.fromEntries(membershipEventTypes.map(eventType => [eventType, everybody]))
      }
    };
    await client.sendStateEvent(conversationId, EventType.RoomPowerLevels, opened, "");
  }

  /**
   * Waiting for the first admin to call is a dead end when the first to try is not one: the room refuses
   * them, nothing gets written, and no admin ever learns that anybody wanted to call. So an admin's client
   * opens the rooms it can, once, when it starts. What it already holds says which look closed — one read
   * of memory per room, no network — and only those are asked of the homeserver and, if it agrees, opened.
   * Rooms whose levels it does not hold are left to the moment somebody with the right calls in them.
   */
  async openTheDoorsToCallsEverywhere(client: MatrixClient): Promise<void> {
    for (const room of client.getRooms()) {
      // One room not opening must not stop the rest: it is left as it is and says why when somebody calls.
      await this.openTheDoorToCallsIfClosed(client, room).catch(() => undefined);
    }
  }

  /**
   * The same for one room, as it arrives: created here, or joined, or made by another client and only now
   * seen. Decided from what is already held, so a room that is open or not this account's to open costs no
   * request; the homeserver is asked only when memory says there is something to do.
   */
  async openTheDoorToCallsIfClosed(client: MatrixClient, room: Room): Promise<void> {
    if (room.getMyMembership() !== "join") return;
    const held = room.currentState
      .getStateEvents(EventType.RoomPowerLevels, "")
      ?.getContent<RoomPowerLevelsEventContent>();
    if (!held) return;
    const everybody = held.users_default ?? 0;
    const neededFor = (eventType: string): number => held.events?.[eventType] ?? held.state_default ?? 50;
    const looksClosed = membershipEventTypes.some(eventType => neededFor(eventType) > everybody);
    const mine = held.users?.[client.getSafeUserId()] ?? everybody;
    const looksLikeICan = mine >= neededFor(EventType.RoomPowerLevels);
    if (!looksClosed || !looksLikeICan) return;
    await this.openTheDoorToCalls(client, room.roomId);
  }

  /** What the homeserver says the room's power levels are, or nothing when it says there are none. */
  private async powerLevelsOf(
    client: MatrixClient,
    conversationId: ConversationId
  ): Promise<RoomPowerLevelsEventContent | undefined> {
    try {
      return await client.getStateEvent(conversationId, EventType.RoomPowerLevels, "");
    } catch {
      return undefined;
    }
  }

  /**
   * Who is on the call and who this device tells the room it is. The SDK owns all of it: joining writes the
   * membership and keeps it from going stale, and leaving takes it back down.
   */
  sessionFor(client: MatrixClient, conversationId: ConversationId): MatrixRTCSession {
    const room = client.getRoom(conversationId);
    if (!room) {
      throw new SdkError("CONVERSATION_NOT_FOUND", "That conversation is not here to hold a conference in");
    }
    // The SDK's own manager keeps one session per room. Asking it, and not making another, is what makes the
    // conference that rang and the conference that is joined the same object with the same memberships.
    return client.matrixRTC.getRoomSession(room);
  }
}

/**
 * What came back over the network, believed only once it has been looked at. An answer without somewhere to
 * connect to is not a ticket, and finding that out here beats finding it out as a connection to `undefined`.
 */
function readTicket(answer: unknown): ConferenceTicket {
  const saysWhereAndHow = typeof answer === "object" && answer !== null && "url" in answer && "jwt" in answer;
  if (!saysWhereAndHow) {
    throw new SdkError("ADAPTER_ERROR", "The conference service answered without somewhere to connect to");
  }
  const { url, jwt } = answer;
  if (typeof url !== "string" || typeof jwt !== "string") {
    throw new SdkError(
      "ADAPTER_ERROR",
      "The conference service answered with something that is not a way in"
    );
  }
  return { url, jwt };
}
