import assert from "node:assert/strict";
import test from "node:test";

const { newestPerPerson } = await import("../packages/matrix-js/dist/matrix-conference.js");

/**
 * What the room says about a call is one entry per device, and a device that died without leaving stays
 * said for hours. A screen ringing for a call draws people, not the devices they have lost along the way:
 * one box per person, from whichever of their devices spoke last. Once inside, who is really connected is
 * known and this is not used.
 */
test("a call that rings shows each person once, from their newest device", () => {
  const said = [
    { userId: "@alice:localhost", deviceId: "OLD", createdTs: () => 1000 },
    { userId: "@alice:localhost", deviceId: "NEW", createdTs: () => 3000 },
    { userId: "@alice:localhost", deviceId: "OLDER", createdTs: () => 500 },
    { userId: "@carol:localhost", deviceId: "C", createdTs: () => 2000 }
  ];

  const people = newestPerPerson(said);

  assert.deepEqual(
    people.map(one => [one.userId, one.deviceId]),
    [
      ["@alice:localhost", "NEW"],
      ["@carol:localhost", "C"]
    ]
  );
});

test("two people keep their order of arrival, by the device that counts", () => {
  const said = [
    { userId: "@bob:localhost", deviceId: "B", createdTs: () => 4000 },
    { userId: "@alice:localhost", deviceId: "A", createdTs: () => 1000 }
  ];

  assert.deepEqual(
    newestPerPerson(said).map(one => one.userId),
    ["@alice:localhost", "@bob:localhost"]
  );
});

const { peopleOnARingingCall } = await import("../packages/matrix-js/dist/matrix-conference.js");

/**
 * While a call rings you are not on it, whatever an older device of yours left behind says. The people a
 * ringing screen shows are everybody but this account: one each, newest device, in order of arrival.
 */
test("a ringing call never shows this account, even when an old device of it is still said to be on", () => {
  const said = [
    { userId: "@alice:localhost", deviceId: "DEAD-TAB", createdTs: () => 1000 },
    { userId: "@carol:localhost", deviceId: "C", createdTs: () => 2000 },
    { userId: "@alice:localhost", deviceId: "OLDER-TAB", createdTs: () => 500 }
  ];

  const people = peopleOnARingingCall(said, "@alice:localhost");

  assert.deepEqual(
    people.map(one => one.userId),
    ["@carol:localhost"]
  );
});

test("everybody else still comes out one per person, in the order they arrived", () => {
  const said = [
    { userId: "@bob:localhost", deviceId: "B2", createdTs: () => 5000 },
    { userId: "@carol:localhost", deviceId: "C", createdTs: () => 2000 },
    { userId: "@bob:localhost", deviceId: "B1", createdTs: () => 1000 },
    { userId: "@alice:localhost", deviceId: "ME", createdTs: () => 1500 }
  ];

  const people = peopleOnARingingCall(said, "@alice:localhost");

  assert.deepEqual(
    people.map(one => [one.userId, one.deviceId]),
    [
      ["@bob:localhost", "B2"],
      ["@carol:localhost", "C"]
    ]
  );
});
