import assert from "node:assert/strict";
import test from "node:test";

const { MatrixCalls } = await import("../packages/matrix-js/dist/matrix-calls.js");

/**
 * What an audit of the calls against the SDK turned up: things it already knows and says that were never
 * asked for, and one that was answered wrongly.
 */
function callThat(extras = {}) {
  const listeners = new Map();
  return {
    callId: "call-1",
    roomId: "!room:localhost",
    direction: "outbound",
    type: "voice",
    state: "connected",
    getFeeds: () => [],
    getOpponentMember: () => ({ userId: "@bob:localhost" }),
    on: (event, handler) => listeners.set(event, handler),
    fire: (event, ...args) => listeners.get(event)?.(...args),
    placeVoiceCall: async () => undefined,
    placeVideoCall: async () => undefined,
    isMicrophoneMuted: () => false,
    isLocalVideoMuted: () => false,
    isRemoteOnHold: () => false,
    isLocalOnHold: () => false,
    isScreensharing: () => false,
    hasLocalUserMediaVideoTrack: false,
    hasRemoteUserMediaVideoTrack: false,
    opponentSupportsDTMF: () => true,
    sendDtmfDigit: () => undefined,
    getRemoteAssertedIdentity: () => undefined,
    ...extras
  };
}

async function placed(call, report = () => undefined) {
  const client = {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    getMediaHandler: () => ({ setAudioInput: () => undefined, setVideoInput: () => undefined }),
    on: () => undefined
  };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, report);
  const placedCall = await calls.place(client, "!room:localhost", { video: false });
  return { calls, placedCall };
}

test("a call remembers when it started, rather than starting again every time it is read", async () => {
  const { calls, placedCall } = await placed(callThat());

  await new Promise(resolve => setTimeout(resolve, 30));
  const laterOn = calls.list()[0];

  assert.equal(laterOn.startedAt, placedCall.startedAt, "the call says it started again when it was read");
});

test("being put on hold by the other side is something the call says", async () => {
  let heldByThem = false;
  const call = callThat({ isLocalOnHold: () => heldByThem });
  const { calls } = await placed(call);
  assert.equal(calls.list()[0].isOnHoldByThem, false);

  heldByThem = true;

  assert.equal(calls.list()[0].isOnHoldByThem, true, "the other side held the call and it does not say so");
});

test("a call going wrong is told, not left to end without a word", async () => {
  const told = [];
  const call = callThat();
  const { calls } = await placed(call, reported => told.push(reported));
  told.length = 0;

  call.fire("error", new Error("no_user_media"));

  assert.equal(told.length, 1, "a call went wrong and nobody was told");
  assert.equal(told[0].wentWrong, "no_user_media");
});

test("digits can be sent, which is how anybody answers a menu", async () => {
  const pressed = [];
  const call = callThat({ sendDtmfDigit: digit => pressed.push(digit) });
  const { calls } = await placed(call);

  await calls.pressDigit("call-1", "4");

  assert.deepEqual(pressed, ["4"]);
});

test("a digit nobody can hear is refused rather than swallowed", async () => {
  const call = callThat({ opponentSupportsDTMF: () => false });
  const { calls } = await placed(call);

  await assert.rejects(() => calls.pressDigit("call-1", "4"), /cannot take/i);
});

/**
 * Two changes asked for at once wait for each other. Holding, silencing and turning a camera on all end in
 * the same place — agreeing a new shape with the other side — and two of those at once tread on one another:
 * the second is asked while the first is still being agreed, and one of them is quietly dropped.
 *
 * Somebody pressing two buttons quickly is not an unusual thing to do.
 */
test("two changes to the same call happen one after the other, not at once", async () => {
  const order = [];
  let going = false;
  const slowly = (name, apply) => async () => {
    if (going) order.push(`${name} while another was still going`);
    going = true;
    await new Promise(resolve => setTimeout(resolve, 40));
    apply();
    going = false;
    return true;
  };
  let muted = false;
  let held = false;
  const call = callThat({
    setMicrophoneMuted: slowly("silence", () => { muted = true; }),
    isMicrophoneMuted: () => muted,
    setRemoteOnHold: slowly("hold", () => { held = true; }),
    isRemoteOnHold: () => held
  });
  const { calls } = await placed(call);

  await Promise.all([calls.muteMicrophone("call-1", true), calls.hold("call-1", true)]);

  assert.deepEqual(order, [], order.join("; "));
  assert.equal(muted, true);
  assert.equal(held, true);
});
