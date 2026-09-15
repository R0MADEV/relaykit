import assert from "node:assert/strict";
import test from "node:test";
import { MatrixEvent } from "matrix-js-sdk";
import { handleAccountData, handleRoomAccountData } from "../packages/matrix-js/dist/matrix-handlers.js";

/**
 * Not everything about a conversation arrives in its timeline. Whether it is a direct chat, whether it is a
 * favourite, whether it was marked unread — all of that is account data, and a screen that only follows the
 * timeline shows it wrong until something is said. Which is why it looked like it needed a reload.
 */
function aRoom(roomId) {
  return {
    roomId,
    name: roomId,
    getMyMembership: () => "join",
    getDMInviter: () => undefined,
    getJoinRule: () => "invite",
    isSpaceRoom: () => false,
    getUnreadNotificationCount: () => 0,
    getLastActiveTimestamp: () => 0,
    getAccountData: () => undefined,
    getMembers: () => [],
    getMembersWithMembership: () => [],
    getLiveTimeline: () => ({ getEvents: () => [] }),
    hasEncryptionStateEvent: () => false,
    getCanonicalAlias: () => null,
    getAltAliases: () => [],
    getAvatarUrl: () => null,
    getJoinedMemberCount: () => 1,
    getInvitedMemberCount: () => 0,
    currentState: {
      getStateEvents: () => null,
      getHistoryVisibility: () => "shared"
    },
    client: { getAccountData: () => undefined }
  };
}

test("a conversation becoming a direct one repaints it, without waiting for anything to be said", () => {
  const room = aRoom("!direct:localhost");
  const updated = [];
  const event = new MatrixEvent({
    type: "m.direct",
    content: { "@alice:localhost": ["!direct:localhost"] }
  });

  handleAccountData(
    event,
    { getRoom: id => (id === room.roomId ? room : null) },
    {
      onConversationUpdated: conversation => updated.push(conversation.id)
    }
  );

  assert.deepEqual(updated, ["!direct:localhost"]);
});

test("account data about something else repaints nothing", () => {
  const updated = [];
  const event = new MatrixEvent({ type: "m.push_rules", content: {} });

  handleAccountData(
    event,
    { getRoom: () => null },
    {
      onConversationUpdated: conversation => updated.push(conversation.id)
    }
  );

  assert.deepEqual(updated, []);
});

test("marking a conversation a favourite repaints that conversation", () => {
  const room = aRoom("!channel:localhost");
  const updated = [];
  handleRoomAccountData(room, {
    onConversationUpdated: conversation => updated.push(conversation.id)
  });

  assert.deepEqual(updated, ["!channel:localhost"]);
});
