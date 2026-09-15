import assert from "node:assert/strict";
import test from "node:test";
import { joinMatrixConversation } from "../packages/matrix-js/dist/matrix-conversations.js";

/**
 * Matrix keeps who your direct chats are with in your own account data, one copy per person. The one who
 * starts a direct chat writes theirs when they start it; the one who accepts has to write theirs when they
 * accept, and nobody writes it for them. Without it their screen files the chat as a channel the moment it
 * paints from what was kept rather than from what just happened.
 */
function aClientInvitedToADirectBy(inviter) {
  const written = [];
  const room = {
    roomId: "!direct:localhost",
    name: "!direct:localhost",
    getMyMembership: () => "join",
    getDMInviter: () => inviter,
    getJoinRule: () => "invite",
    isSpaceRoom: () => false,
    getUnreadNotificationCount: () => 0,
    getLastActiveTimestamp: () => 0,
    getAccountData: () => undefined,
    getMembers: () => [{ userId: inviter }, { userId: "@bob:localhost" }],
    getMembersWithMembership: () => [],
    getLiveTimeline: () => ({ getEvents: () => [] }),
    hasEncryptionStateEvent: () => false,
    getCanonicalAlias: () => null,
    getAltAliases: () => [],
    getAvatarUrl: () => null,
    getJoinedMemberCount: () => 2,
    getInvitedMemberCount: () => 0,
    currentState: {
      getStateEvents: type => (type === "m.room.create" ? { getContent: () => ({}) } : null),
      getHistoryVisibility: () => "shared"
    }
  };
  const client = {
    joinRoom: async () => room,
    getRoom: () => room,
    getAccountData: () => undefined,
    setAccountData: async (type, content) => written.push({ type, content })
  };
  room.client = client;
  return { written, client };
}

test("the one who accepts a direct invitation writes it down as a direct of their own", async () => {
  const { client, written } = aClientInvitedToADirectBy("@alice:localhost");

  await joinMatrixConversation(client, "!direct:localhost");

  const direct = written.find(each => each.type === "m.direct");
  assert.ok(direct, "accepting a direct invitation left nothing in m.direct");
  assert.deepEqual(direct.content["@alice:localhost"], ["!direct:localhost"]);
});

test("accepting an ordinary invitation writes nothing", async () => {
  const { client, written } = aClientInvitedToADirectBy(undefined);

  await joinMatrixConversation(client, "!direct:localhost");

  assert.equal(written.length, 0);
});
