import { createClient, EventType } from "matrix-js-sdk";
import { registerAccount, closeWhatWasMade } from "./fresh-accounts.mjs";

/**
 * The Matrix half of a conference, against a real homeserver and a real service handing out the leave.
 *
 * Not the picture and the sound: those need a browser, and that is what the Electron check is for. What is
 * asked here is everything that happens before anybody is heard, which is where all the guessing is. The
 * names come from proposals that are still being written, the service that admits people is a separate
 * program with its own idea of what a request looks like, and none of it fails loudly — a conference whose
 * membership is written under the wrong name simply happens, and nobody else can tell it is happening.
 */
const homeserver = process.env.MATRIX_HOMESERVER ?? "http://localhost:8008";
const serviceUrl = process.env.RELAYKIT_CONFERENCE_SERVICE ?? "http://localhost:8091";

const { MatrixRtc } = await import("../packages/matrix-js/dist/matrix-rtc.js");

async function waitUntil(what, describe) {
  for (let attempt = 0; attempt < 60; attempt++) {
    const answer = await what();
    if (answer) return answer;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(describe);
}

/**
 * The two names a membership can be written under. The settled one is being written as a proposal and the
 * SDK still writes the older one, so both are asked for and neither is typed out here: the day it moves,
 * this keeps passing and the SDK is what changed.
 */
const membershipNames = [EventType.RTCMembership, EventType.GroupCallMemberPrefix];

/**
 * Everybody the room says is on the call, asked as the other person, over plain HTTP. The whole state and
 * not one key of it: what a membership is keyed by is the SDK's business — it has a device and an
 * application in it today — and a check that guesses at the key is a check on the guess.
 */
async function membershipsAsSeenBy(reader, conversationId) {
  const where = `${homeserver}/_matrix/client/v3/rooms/${encodeURIComponent(conversationId)}/state`;
  const response = await fetch(where, { headers: { Authorization: `Bearer ${reader.accessToken}` } });
  if (!response.ok) return [];
  const state = await response.json();
  // Empty content is somebody who left, which is not somebody on the call.
  return state.filter(
    event => membershipNames.includes(event.type) && Object.keys(event.content ?? {}).length > 0
  );
}

/** A leave is not a password: what it says about who it is for can be read without the key that signs it. */
function claimsIn(jwt) {
  const [, payload] = jwt.split(".");
  if (!payload) throw new Error(`That is not a token: ${jwt.slice(0, 40)}`);
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

async function run() {
  const alice = await registerAccount("conference-a", "alice-device");
  const bob = await registerAccount("conference-b", "bob-device");
  const conversation = await alice.client.conversations.create({
    participantIds: [bob.userId],
    title: "conference",
    encrypted: true
  });
  await bob.client.conversations.join(conversation.id);

  const rtc = new MatrixRtc(serviceUrl);

  // Alice's own client, syncing, because writing who is on a call is writing state into a room and the SDK
  // wants the room in front of it. Without crypto: a membership is not a secret, it is how anybody is told.
  const matrix = createClient({
    baseUrl: homeserver,
    userId: alice.userId,
    accessToken: alice.accessToken,
    deviceId: alice.deviceId
  });
  await matrix.startClient({ initialSyncLimit: 1 });
  await waitUntil(
    () => matrix.getRoom(conversation.id),
    "Alice's own client never saw the conversation she had just made"
  );

  const transport = rtc.findTransport(matrix);
  if (transport.type !== "livekit") {
    throw new Error(`Conferences are carried by something this does not know: ${transport.type}`);
  }

  // The exchange the SDK does not do, which is the whole reason `matrix-rtc.ts` exists. A homeserver token
  // goes out and a leave the SFU accepts comes back, and nothing here is trusted to be right about it.
  const ticket = await rtc.ticketFor(matrix, transport, conversation.id);
  if (!ticket.url.startsWith("ws")) {
    throw new Error(`The way in does not lead to an SFU: ${ticket.url}`);
  }
  const claims = claimsIn(ticket.jwt);
  // The service hands the SFU a hash of the conversation and not its name, so a thing that carries the media
  // is never told which room anybody is in. How it hashes is its business and may change; what has to hold
  // is that the leave is for THIS conference. Asked twice it says the same, and for another it says another
  // — a leave that did neither would let anybody who had one walk into anything.
  const again = await rtc.ticketFor(matrix, transport, conversation.id);
  if (claimsIn(again.jwt).video?.room !== claims.video?.room) {
    throw new Error("Two leaves for the same conference name different rooms, so neither means anything");
  }
  const elsewhere = await alice.client.conversations.create({
    participantIds: [bob.userId],
    title: "another conference"
  });
  const other = await rtc.ticketFor(matrix, transport, elsewhere.id);
  if (claimsIn(other.jwt).video?.room === claims.video?.room) {
    throw new Error("A leave for one conference is a leave for another, so anybody could walk into any");
  }
  if (claims.video?.roomJoin !== true || claims.video?.canPublish !== true) {
    throw new Error(`The leave gets nobody in or lets them say nothing: ${JSON.stringify(claims.video)}`);
  }
  // The SFU knows one string per person. If this is not Alice and her device, two devices of hers collide
  // and nobody drawing the call can tell one box from the other.
  if (!claims.sub?.includes(alice.userId) || !claims.sub?.includes(alice.deviceId)) {
    throw new Error(
      `The leave does not say which device it is for, so two of hers would be one box: ${claims.sub}`
    );
  }

  // Saying it in the room, which is what makes anybody else's screen ring.
  const session = rtc.sessionFor(matrix, conversation.id);
  session.joinRoomSession([transport]);
  const [announced] = await waitUntil(async () => {
    const said = await membershipsAsSeenBy(bob, conversation.id);
    return said.length > 0 ? said : undefined;
  }, "Alice joined the conference and the room never said so, so nobody else can know it is going on");
  if (announced.sender !== alice.userId) {
    throw new Error(`The room says somebody else is on the call: ${announced.sender}`);
  }
  if (announced.content.device_id !== alice.deviceId) {
    throw new Error(
      `The room names another device, so two of hers would be one: ${announced.content.device_id}`
    );
  }
  // Where the media is to be carried travels with it, which is how somebody joining later knows where to go
  // without asking anybody.
  const said = announced.content.foci_preferred?.[0]?.livekit_service_url;
  if (said !== serviceUrl) {
    throw new Error(`The room does not say where the conference is carried: ${said}`);
  }

  // And taking it back. Left behind, Alice shows as being on a call she walked out of until somebody notices.
  await session.leaveRoomSession();
  await waitUntil(async () => {
    const said = await membershipsAsSeenBy(bob, conversation.id);
    return said.length === 0;
  }, "Alice left the conference and the room still says she is on it");

  // And now the point of keeping that trail: what is over is read back out of the room, by somebody who was
  // not even watching while it happened. This is the only way a history is the same on every device.
  const { listMatrixPastCalls } = await import("../packages/matrix-js/dist/matrix-call-history.js");
  const over = await waitUntil(async () => {
    const found = await listMatrixPastCalls(matrix, conversation.id, 10);
    return found.length > 0 ? found : undefined;
  }, "the call that just ended left nothing in the room to read it back from");
  const [lastOne] = over;
  if (lastOne.conversationId !== conversation.id) {
    throw new Error(`The call that came back belongs to another conversation: ${lastOne.conversationId}`);
  }
  if (!(lastOne.endedAt > lastOne.startedAt)) {
    throw new Error(`A call cannot end before it started: ${lastOne.startedAt} to ${lastOne.endedAt}`);
  }
  if (!lastOne.participantIds.includes(alice.userId)) {
    throw new Error(`Whoever was on the call is not in it: ${lastOne.participantIds.join(", ")}`);
  }
  const lasted = lastOne.endedAt - lastOne.startedAt;

  // Stopping the session and not only the client: it keeps itself alive to keep the membership alive,
  // and a check that passes and never exits is a check that hangs whatever runs it.
  await session.stop();
  matrix.stopClient();
  await alice.client.stop();
  await bob.client.stop();
  console.log(
    `RelayKit conference smoke check passed (${ticket.url}, seen by ${bob.userId}, ` +
      `the call read back out of the room as ${lasted} ms with ${lastOne.participantIds.length} on it)`
  );
}

run()
  .finally(closeWhatWasMade)
  .catch(error => {
    console.error(`RelayKit conference smoke check failed: ${error.message}`);
    process.exit(1);
  });
