import assert from "node:assert/strict";
import test from "node:test";

const { MatrixCalls } = await import("../packages/matrix-js/dist/matrix-calls.js");

/**
 * Placing a call is not writing a message down: it needs the microphone or the camera before anything can be
 * sent, and either of those can be refused. So a call that comes back has to have really gone out, and one
 * that could not be placed has to say so instead of sitting there looking like it is ringing.
 *
 * The same rule the rest of the library follows: if an operation comes back, what it did can already be read.
 */
function fakeClient(call) {
  return {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    on: () => undefined
  };
}

function fakeCall(placing) {
  return {
    callId: "call-1",
    roomId: "!room:localhost",
    direction: "outbound",
    type: "voice",
    state: "create_offer",
    getFeeds: () => [],
    isMicrophoneMuted: () => false,
    isLocalVideoMuted: () => false,
    isRemoteOnHold: () => false,
    isScreensharing: () => false,
    isLocalOnHold: () => false,
    getRemoteAssertedIdentity: () => undefined,
    opponentSupportsDTMF: () => true,
    sendDtmfDigit: () => undefined,
    getOpponentMember: () => undefined,
    on: () => undefined,
    placeVoiceCall: placing,
    placeVideoCall: placing
  };
}

test("a call that comes back has really been sent, because placing it needs the microphone first", async () => {
  let sent = false;
  const calls = new MatrixCalls();
  const client = fakeClient(fakeCall(async () => {
    await new Promise(resolve => setTimeout(resolve, 20));
    sent = true;
  }));
  calls.watch(client, () => undefined, () => undefined);

  await calls.place(client, "!room:localhost", { video: false });

  assert.equal(sent, true, "it came back before the call had gone out");
});

test("a call that could not be placed says so, instead of looking like it is ringing", async () => {
  const calls = new MatrixCalls();
  const client = fakeClient(fakeCall(async () => {
    throw new Error("Permission denied");
  }));
  calls.watch(client, () => undefined, () => undefined);

  await assert.rejects(
    () => calls.place(client, "!room:localhost", { video: false }),
    /Permission denied/
  );
  assert.deepEqual(calls.list(), [], "a call that never went out was left going on");
});
