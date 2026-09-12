import assert from "node:assert/strict";
import test from "node:test";
import { EventType } from "matrix-js-sdk";

const { createMatrixConversation } = await import("../packages/matrix-js/dist/matrix-conversations.js");

/**
 * Being on a call is written into the room as state, and by default a room lets only its admins write state.
 * So whoever created a conversation could join its conference and nobody else could: the room refused them
 * with a 403, the SDK gave up in the background, and to everybody else they were simply never there. Found
 * by three browsers, not by any test: the one writing the membership in every other check was the creator.
 */
function clientThatRecords(asked) {
  const room = {
    roomId: "!room:localhost",
    name: "room",
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
      return { room_id: "!room:localhost" };
    },
    getRoom: () => room,
    getSafeUserId: () => "@alice:localhost",
    getStateEvent: async () => {
      throw new Error("M_NOT_FOUND");
    }
  };
}

test("everybody in a conversation may say they are on its call, not only whoever made it", async () => {
  const asked = [];

  await createMatrixConversation(clientThatRecords(asked), { participantIds: ["@bob:localhost"] });

  const events = asked[0].power_level_content_override?.events ?? {};
  assert.equal(events[EventType.GroupCallMemberPrefix], 0, "the name the SDK writes today");
  assert.equal(events[EventType.RTCMembership], 0, "the name it already declares for tomorrow");
});

test("letting people join a call does not let them run the room", async () => {
  const asked = [];

  await createMatrixConversation(clientThatRecords(asked), { participantIds: ["@bob:localhost"] });

  // Saying which events are open replaces the whole list, so what the defaults protected has to be said
  // again or it is lost: a room where anybody can hand out power is not a room.
  const events = asked[0].power_level_content_override.events;
  assert.equal(events[EventType.RoomPowerLevels], 100);
  assert.equal(events[EventType.RoomEncryption], 100);
  assert.equal(events[EventType.RoomHistoryVisibility], 100);
  assert.equal(events[EventType.RoomTombstone], 100);
  assert.equal(events[EventType.RoomServerAcl], 100);
  assert.equal(events[EventType.RoomName], 50);
  assert.equal(events[EventType.RoomAvatar], 50);
  assert.equal(events[EventType.RoomCanonicalAlias], 50);
});
