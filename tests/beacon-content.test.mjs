import assert from "node:assert/strict";
import test from "node:test";
import { ContentHelpers } from "matrix-js-sdk";

const { startMatrixLiveLocation } = await import("../packages/matrix-js/dist/matrix-location.js");

/**
 * Sharing where somebody is sends a shape with several names in it, and the SDK builds that shape itself.
 * Typing it out here means keeping it in step with a proposal that is still moving, by hand, for ever — and
 * nothing would notice if it drifted, because both sides of every check are this same code.
 */
test("what is sent to start sharing is what the SDK builds", async () => {
  let written;
  const client = {
    getSafeUserId: () => "@alice:localhost",
    sendStateEvent: async (_room, _type, content) => {
      written = content;
      return { event_id: "$1" };
    },
    getRoom: () => ({
      currentState: { getStateEvents: () => ({ getContent: () => ({ live: true }), getId: () => "$1" }) }
    })
  };

  await startMatrixLiveLocation(client, "!room:localhost", {
    durationMs: 600000,
    description: "En camino"
  }).catch(() => undefined);

  const theirs = ContentHelpers.makeBeaconInfoContent(
    600000,
    true,
    "En camino",
    "m.self",
    written?.["org.matrix.msc3488.ts"]
  );
  assert.deepEqual(written, theirs, "the shape sent is not the one the SDK builds");
});

const { sendMessage } = await import("../packages/matrix-js/dist/matrix-sending.js");

/**
 * A place sent in a conversation is the SDK's shape too. Ours said less than the SDK's does: no timestamp, no
 * asset, and none of the plain text a client that knows nothing of places falls back to. A place that
 * travels with less than it should is a place some clients cannot draw.
 */
test("a place is sent as the SDK builds it", async () => {
  let written;
  // An ordinary message goes out through `sendMessage`, which is where the shape can be seen.
  const client = {
    sendMessage: async (_room, content) => {
      written = content;
      return { event_id: "$1" };
    },
    getRoom: () => undefined,
    getSafeUserId: () => "@alice:localhost"
  };

  await sendMessage(client, "!room:localhost", "Estoy aquí", {
    location: { latitude: 43.26, longitude: -2.93, description: "Bilbao" }
  }).catch(() => undefined);

  const theirs = ContentHelpers.makeLocationContent(
    "Estoy aquí",
    "geo:43.26,-2.93",
    written?.["org.matrix.msc3488.ts"],
    "Bilbao",
    "m.self"
  );
  for (const [name, value] of Object.entries(theirs)) {
    assert.deepEqual(written?.[name], value, `the place is missing what the SDK puts in ${name}`);
  }
});
