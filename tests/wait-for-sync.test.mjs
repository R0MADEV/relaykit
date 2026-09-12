import assert from "node:assert/strict";
import test from "node:test";
import { EventEmitter } from "node:events";

const { waitForInitialSync } = await import("../packages/matrix-js/dist/matrix-sync.js");

/** Just enough of a client to emit sync states, which is all this waits on. */
function fakeClient() {
  const emitter = new EventEmitter();
  return {
    on: (event, listener) => emitter.on(event, listener),
    removeListener: (event, listener) => emitter.removeListener(event, listener),
    startClient: () => {},
    say: state => emitter.emit("sync", state)
  };
}

test("catching up is done once the first sync is in", async () => {
  const client = fakeClient();
  const waiting = waitForInitialSync(client, 20);

  client.say("PREPARED");

  await waiting;
});

test("a sync that goes wrong says so instead of hanging", async () => {
  const client = fakeClient();
  const waiting = waitForInitialSync(client, 20);

  client.say("ERROR");

  await assert.rejects(waiting, /sync/i);
});

test("a client stopped while catching up settles instead of hanging for ever", async () => {
  const client = fakeClient();
  const waiting = waitForInitialSync(client, 20);

  client.say("STOPPED");

  await assert.rejects(waiting, /stopped/i);
});
