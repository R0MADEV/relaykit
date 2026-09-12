import { SdkError } from "@relaykit/core";
import type { ConversationId } from "@relaykit/core";
import type { MatrixClient } from "matrix-js-sdk";
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
