import assert from "node:assert/strict";
import test from "node:test";

const { MatrixCalls } = await import("../packages/matrix-js/dist/matrix-calls.js");

/**
 * A call that cannot be heard is not a call. Saying that there is something to play is not enough: whoever
 * draws the screen needs the audio and the video themselves, to hand them to an element and let them out.
 *
 * The SDK already keeps them, one feed per side. What is missing is handing them over, because a component
 * must not have to reach into `MatrixCall` to find them.
 */
function callWith(feeds) {
  return {
    callId: "call-1",
    roomId: "!room:localhost",
    direction: "outbound",
    type: "voice",
    state: "connected",
    getFeeds: () => feeds,
    getOpponentMember: () => ({ userId: "@bob:localhost" }),
    on: () => undefined,
    placeVoiceCall: async () => undefined,
    placeVideoCall: async () => undefined
  };
}

function feed(stream, mine) {
  return { stream, isLocal: () => mine };
}

async function placed(feeds) {
  const call = callWith(feeds);
  const client = { createCall: () => call, getSafeUserId: () => "@alice:localhost", on: () => undefined };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, () => undefined);
  return calls.place(client, "!room:localhost", { video: false });
}

test("a call hands over what to play, because a screen cannot play a boolean", async () => {
  const mine = { id: "mine" };
  const theirs = { id: "theirs" };

  const call = await placed([feed(mine, true), feed(theirs, false)]);

  assert.equal(call.ownMedia, mine, "the account's own audio was not handed over");
  assert.equal(call.remoteMedia, theirs, "the other side's audio was not handed over");
});

test("a call with nothing to play yet hands over nothing, rather than something empty", async () => {
  const call = await placed([]);

  assert.equal(call.ownMedia, undefined);
  assert.equal(call.remoteMedia, undefined);
  assert.equal(call.hasRemoteMedia, false);
});
