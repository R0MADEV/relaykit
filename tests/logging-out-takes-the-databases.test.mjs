import assert from "node:assert/strict";
import test from "node:test";

/**
 * Signing out has to take the databases with it, not only empty them.
 *
 * Each session gets three of its own in a browser: the sync copy, the crypto store and the local copy — all
 * named after the device, because two devices of the same person must never share keys. Nothing ever deleted
 * them, so a browser used for a few days held thirty-five databases, every one of them the leftovers of a
 * session that no longer exists and every one still holding the keys it had.
 *
 * `clearStores` is the SDK's own, and it takes the crypto prefix because the rust store is not the sdk's to
 * find otherwise.
 */
function aClientThatRemembersWhatItWasAskedToClear() {
  const asked = [];
  let running = true;
  return {
    asked,
    client: {
      logout: async () => asked.push("logout"),
      stopClient: () => {
        running = false;
        asked.push("stopClient");
      },
      // What the real one does, so asking in the wrong order fails here as well.
      clearStores: async args => {
        if (running) throw new Error("Cannot clear stores while client is running");
        asked.push(`clearStores:${args?.cryptoDatabasePrefix ?? "none"}`);
      }
    }
  };
}

test("the databases of a session are deleted, and only once it has stopped", async () => {
  const { takeTheDatabasesAway } = await import("../packages/matrix-js/dist/matrix-sync.js");
  const { client, asked } = aClientThatRemembersWhatItWasAskedToClear();

  await takeTheDatabasesAway(client, "relaykit-crypto-@alice:localhost-DEVICE");

  assert.deepEqual(asked, ["stopClient", "clearStores:relaykit-crypto-@alice:localhost-DEVICE"]);
});

test("a store that will not go is not a reason to fail signing out", async () => {
  const { takeTheDatabasesAway } = await import("../packages/matrix-js/dist/matrix-sync.js");
  const client = {
    stopClient: () => {},
    clearStores: async () => {
      throw new Error("the browser would not let go of it");
    }
  };

  // The session is over either way. A browser refusing to delete a database is worth saying, never worth
  // leaving somebody signed in over.
  await takeTheDatabasesAway(client, "prefijo");
});
