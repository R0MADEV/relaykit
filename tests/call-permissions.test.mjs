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

const { MatrixRtc } = await import("../packages/matrix-js/dist/matrix-rtc.js");

/**
 * A room made before this, or by another client, still has the defaults: only admins may say they are on a
 * call. Whoever starts a call in it and may change the room's power levels opens the two names a membership
 * is written under to everybody, once, and the room is a room anybody can be called in from then on. Whoever
 * may not leaves it as it is, and their own join says why when the room refuses them.
 *
 * The levels are asked of the homeserver, never read off local state: a window over the conversations
 * brings only the state it asked for, and levels worked out from a missing event once replaced a room's
 * whole list with two entries and locked its own admin out.
 */
function roomWhosePowerLevelsSay(content) {
  const written = [];
  const client = {
    getSafeUserId: () => "@alice:localhost",
    getStateEvent: async (roomId, type, key) => {
      const asked = type === "m.room.power_levels" && key === "";
      if (!asked || content === undefined) throw new Error("M_NOT_FOUND");
      return content;
    },
    sendStateEvent: async (roomId, type, newContent, key) => {
      written.push({ roomId, type, newContent, key });
      return { event_id: "$pl" };
    }
  };
  return { client, written };
}

test("an admin starting a call in an old room opens it to everybody, and touches nothing else", async () => {
  const defaults = {
    users: { "@alice:localhost": 100 },
    users_default: 0,
    state_default: 50,
    events: { "m.room.name": 50, "m.room.power_levels": 100 }
  };
  const { client, written } = roomWhosePowerLevelsSay(defaults);

  await new MatrixRtc("http://jwt").openTheDoorToCalls(client, "!old:localhost");

  assert.equal(written.length, 1);
  assert.equal(written[0].type, "m.room.power_levels");
  assert.equal(written[0].key, "");
  assert.equal(written[0].newContent.events[EventType.GroupCallMemberPrefix], 0);
  assert.equal(written[0].newContent.events[EventType.RTCMembership], 0);
  // What was there stays there: this opens one door, it does not rebuild the house.
  assert.equal(written[0].newContent.events["m.room.name"], 50);
  assert.equal(written[0].newContent.events["m.room.power_levels"], 100);
  assert.equal(written[0].newContent.state_default, 50);
  // And above all who is who: the admin who opened the door is still the admin afterwards.
  assert.deepEqual(written[0].newContent.users, { "@alice:localhost": 100 });
});

test("a room that is already open is left alone", async () => {
  const open = {
    users: { "@alice:localhost": 100 },
    users_default: 0,
    state_default: 50,
    events: { [EventType.GroupCallMemberPrefix]: 0, [EventType.RTCMembership]: 0 }
  };
  const { client, written } = roomWhosePowerLevelsSay(open);

  await new MatrixRtc("http://jwt").openTheDoorToCalls(client, "!old:localhost");

  assert.deepEqual(written, []);
});

test("somebody who may not change the room's power levels does not try", async () => {
  const defaults = { users: { "@bob:localhost": 100 }, users_default: 0, state_default: 50, events: {} };
  const { client, written } = roomWhosePowerLevelsSay(defaults);

  await new MatrixRtc("http://jwt").openTheDoorToCalls(client, "!old:localhost");

  assert.deepEqual(written, []);
});

test("a room the homeserver has no power levels for is not given some", async () => {
  const { client, written } = roomWhosePowerLevelsSay(undefined);

  await new MatrixRtc("http://jwt").openTheDoorToCalls(client, "!old:localhost");

  assert.deepEqual(written, []);
});
