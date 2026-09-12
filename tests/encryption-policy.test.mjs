import assert from "node:assert/strict";
import test from "node:test";

const { createMatrixConversation } = await import("../packages/matrix-js/dist/matrix-conversations.js");

/**
 * In Matrix encryption can only be added, never taken away: the caller can force it by sending the state
 * event, but cannot stop the homeserver adding it by policy. And once on a room, it is there for good. So the
 * library asks when it is told to and says nothing when it is not, leaving the operator to decide.
 */
function fakeClient(asked, { elServidorCifra = false } = {}) {
  const sala = {
    roomId: "!sala:localhost",
    name: "sala",
    tags: {},
    getMyMembership: () => "join",
    getDMInviter: () => undefined,
    getCanonicalAlias: () => null,
    getJoinRule: () => "invite",
    getMembers: () => [],
    getLastLiveEvent: () => undefined,
    getUnreadNotificationCount: () => 0,
    getLiveTimeline: () => ({ getEvents: () => [] }),
    currentState: {
      getStateEvents: type => (type === "m.room.create" ? { getContent: () => ({}) } : null),
      getHistoryVisibility: () => "shared"
    },
    getAccountData: () => undefined,
    hasEncryptionStateEvent: () => false,
    client: { getAccountData: () => undefined }
  };
  return {
    createRoom: async options => {
      asked.push(options);
      return { room_id: "!sala:localhost" };
    },
    getRoom: () => sala,
    getSafeUserId: () => "@alice:localhost",
    // What the server ended up putting there, which is what it is asked at creation.
    getStateEvent: async () => {
      const loPidio = asked.at(-1)?.initial_state?.some(e => e.type === "m.room.encryption");
      if (loPidio || elServidorCifra) return { algorithm: "m.megolm.v1.aes-sha2" };
      throw new Error("M_NOT_FOUND");
    }
  };
}

function encryptionAskedFor(options) {
  return (options.initial_state ?? []).some(event => event.type === "m.room.encryption");
}

test("saying nothing leaves the policy to the homeserver", async () => {
  const asked = [];

  await createMatrixConversation(fakeClient(asked), { participantIds: ["@bob:localhost"] });

  assert.equal(encryptionAskedFor(asked[0]), false, "la librería impuso cifrado y piso al homeserver");
});

test("asking for it expressly encrypts it, whatever the homeserver says", async () => {
  const asked = [];

  await createMatrixConversation(fakeClient(asked), { participantIds: ["@bob:localhost"], encrypted: true });

  assert.equal(encryptionAskedFor(asked[0]), true);
});

test("not asking does not impose it either: the homeserver can still encrypt", async () => {
  const asked = [];

  await createMatrixConversation(fakeClient(asked), { participantIds: ["@bob:localhost"], encrypted: false });

  assert.equal(encryptionAskedFor(asked[0]), false);
});

test("a direct conversation does not impose the policy either", async () => {
  const asked = [];
  const client = fakeClient(asked);
  client.setAccountData = async () => undefined;
  client.getAccountData = () => undefined;

  await createMatrixConversation(client, { participantIds: ["@bob:localhost"], direct: true });

  assert.equal(encryptionAskedFor(asked[0]), false);
});

test("when the homeserver encrypts by policy, the conversation says so even though nobody asked", async () => {
  const asked = [];

  const conversation = await createMatrixConversation(
    fakeClient(asked, { elServidorCifra: true }),
    { participantIds: ["@bob:localhost"] }
  );

  assert.equal(encryptionAskedFor(asked[0]), false, "la librería lo pidio, y no debia");
  assert.equal(conversation.isEncrypted, true, "el servidor cifro y la conversacion no lo cuenta");
});
