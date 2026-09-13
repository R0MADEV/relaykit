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
