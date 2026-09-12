import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const { MatrixCalls } = await import("../packages/matrix-js/dist/matrix-calls.js");

/**
 * Everything a person does during a call besides starting it and ending it: silencing themselves, putting the
 * camera away, holding, refusing, showing their screen, handing the call to somebody else, and choosing which
 * microphone to use.
 *
 * The SDK does all of it. What is checked here is twofold: that the call behaves as somebody would expect,
 * and that underneath it is the SDK's own method being used and not something written here.
 */
function fakeCall(asked) {
  const state = { microphone: false, camera: false, held: false, sharing: false };
  return {
    callId: "call-1",
    roomId: "!room:localhost",
    direction: "outbound",
    type: "voice",
    state: "connected",
    getFeeds: () => [],
    getOpponentMember: () => ({ userId: "@bob:localhost" }),
    on: () => undefined,
    placeVoiceCall: async () => undefined,
    placeVideoCall: async () => undefined,
    setMicrophoneMuted: muted => { asked.push(`setMicrophoneMuted(${muted})`); state.microphone = muted; return muted; },
    isMicrophoneMuted: () => state.microphone,
    setLocalVideoMuted: muted => { asked.push(`setLocalVideoMuted(${muted})`); state.camera = muted; return muted; },
    isLocalVideoMuted: () => state.camera,
    // The SDK lets go of the track when the camera is put away, so this follows it.
    get hasLocalUserMediaVideoTrack() { return !state.camera; },
    setRemoteOnHold: held => { asked.push(`setRemoteOnHold(${held})`); state.held = held; },
    isRemoteOnHold: () => state.held,
    reject: () => asked.push("reject()"),
    hangup: () => asked.push("hangup()"),
    setScreensharingEnabled: async sharing => { asked.push(`setScreensharingEnabled(${sharing})`); state.sharing = sharing; return sharing; },
    isScreensharing: () => state.sharing,
    transfer: async userId => asked.push(`transfer(${userId})`)
  };
}

async function placed(asked) {
  const call = fakeCall(asked);
  const mediaHandler = {
    setAudioInput: id => asked.push(`setAudioInput(${id})`),
    setVideoInput: id => asked.push(`setVideoInput(${id})`)
  };
  const client = {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    getMediaHandler: () => mediaHandler,
    on: () => undefined
  };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, () => undefined);
  await calls.place(client, "!room:localhost", { video: false });
  return { calls, client, call };
}

test("silencing the microphone is the SDK's, and the call says it is silenced", async () => {
  const asked = [];
  const { calls } = await placed(asked);

  await calls.muteMicrophone("call-1", true);

  assert.deepEqual(asked, ["setMicrophoneMuted(true)"]);
  assert.equal(calls.list()[0].isMicrophoneMuted, true);
});

test("putting the camera away is the SDK's, and the call says it is away", async () => {
  const asked = [];
  const { calls } = await placed(asked);

  await calls.muteCamera("call-1", true);

  assert.deepEqual(asked, ["setLocalVideoMuted(true)"]);
  assert.equal(calls.list()[0].isCameraMuted, true);
});

test("holding is the SDK's, and the call says it is held", async () => {
  const asked = [];
  const { calls } = await placed(asked);

  await calls.hold("call-1", true);

  assert.deepEqual(asked, ["setRemoteOnHold(true)"]);
  assert.equal(calls.list()[0].isOnHold, true);
});

test("refusing a call is refusing it, not hanging it up: the other side is told a different thing", async () => {
  const asked = [];
  const { calls } = await placed(asked);

  await calls.reject("call-1");

  assert.deepEqual(asked, ["reject()"], "a refused call was hung up instead of refused");
});

test("showing the screen is the SDK's, and the call says it is being shown", async () => {
  const asked = [];
  const { calls } = await placed(asked);

  await calls.shareScreen("call-1", true);

  assert.deepEqual(asked, ["setScreensharingEnabled(true)"]);
  assert.equal(calls.list()[0].isSharingScreen, true);
});

test("handing the call to somebody else is the SDK's", async () => {
  const asked = [];
  const { calls } = await placed(asked);

  await calls.transfer("call-1", "@carol:localhost");

  assert.deepEqual(asked, ["transfer(@carol:localhost)"]);
});

test("choosing a microphone and a camera is the SDK's media handler, not ours", async () => {
  const asked = [];
  const { calls, client } = await placed(asked);

  await calls.useMicrophone(client, "mic-2");
  await calls.useCamera(client, "cam-2");

  assert.deepEqual(asked, ["setAudioInput(mic-2)", "setVideoInput(cam-2)"]);
});

/** The same, asked of the contract rather than of the adapter: the double has to do it too. */
test("what somebody does during a call works the same on a double", async () => {
  const client = new MessagingClient({
    adapter: new InMemoryAdapter(),
    storage: new InMemoryStorage(),
    session: { homeserver: "memory://test", userId: "alice", accessToken: "token" }
  });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "controls" });
  const call = await client.calls.place(conversation.id, { video: true });

  await client.calls.muteMicrophone(call.id, true);
  await client.calls.muteCamera(call.id, true);
  await client.calls.hold(call.id, true);

  const going = (await client.calls.list())[0];
  assert.equal(going.isMicrophoneMuted, true);
  assert.equal(going.isCameraMuted, true);
  assert.equal(going.isOnHold, true);

  await client.calls.hold(call.id, false);
  assert.equal((await client.calls.list())[0].isOnHold, false);

  await client.stop();
});

/**
 * Silencing changes the call, so whoever is drawing it has to be told. Without this a button can be pressed
 * and nothing on the screen moves until something else happens to the call, which reads as a button that does
 * not work.
 *
 * The double already announces it. An adapter that does not is an adapter that behaves differently.
 */
test("silencing, holding and the rest are announced, or the screen never finds out", async () => {
  const asked = [];
  const told = [];
  const call = fakeCall(asked);
  const client = {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    getMediaHandler: () => ({ setAudioInput: () => undefined, setVideoInput: () => undefined }),
    on: () => undefined
  };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, reported => told.push(reported));
  await calls.place(client, "!room:localhost", { video: true });
  told.length = 0;

  await calls.muteMicrophone("call-1", true);
  await calls.hold("call-1", true);

  assert.equal(told.length, 2, "pressing silence and hold told nobody");
  assert.equal(told[0].isMicrophoneMuted, true);
  assert.equal(told[1].isOnHold, true);
});

/**
 * What the SDK answers is how the call ended up, not whether it did as it was told. With no microphone on the
 * machine it leaves things as they were and says so, and a call that stayed unsilenced answers `false` to
 * having been silenced.
 *
 * Reading that as success leaves a button that reports done while the microphone carries on sending, which of
 * all the ways to be wrong about a call is the worst one.
 */
test("being refused a silence is said out loud, not reported as done", async () => {
  const asked = [];
  // Whatever it is asked, it stays as it was: nothing was silenced and nothing was put away.
  const call = { ...fakeCall(asked), setMicrophoneMuted: () => false, setLocalVideoMuted: () => false };
  const client = {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    getMediaHandler: () => ({ setAudioInput: () => undefined, setVideoInput: () => undefined }),
    on: () => undefined
  };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, () => undefined);
  await calls.place(client, "!room:localhost", { video: true });

  await assert.rejects(() => calls.muteMicrophone("call-1", true), /could not be silenced/i);
  await assert.rejects(() => calls.muteCamera("call-1", true), /camera could not be put away/i);

  // And the other way round: asked to let it speak again, a call that is not silenced answers `false`, and
  // that is the call doing exactly as it was told.
  await calls.muteMicrophone("call-1", false);
  await calls.muteCamera("call-1", false);
});

/**
 * Asking for a silence and coming back before the call agrees to it is how a screen ends up drawing the
 * opposite of what is true, and how the next press asks for the wrong thing. The rule the rest of this
 * library follows applies here too: if an operation comes back, what it did can already be read.
 *
 * The SDK settles these a moment later — it tells the other side and reads back what stuck — so what is
 * asked for is waited on rather than assumed.
 */
test("silencing comes back only once the call says it is silenced", async () => {
  const asked = [];
  const call = fakeCall(asked);
  let muted = false;
  call.setMicrophoneMuted = wanted => {
    // Settles a moment later, as the real one does.
    setTimeout(() => { muted = wanted; }, 30);
    return muted;
  };
  call.isMicrophoneMuted = () => muted;
  const client = {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    getMediaHandler: () => ({ setAudioInput: () => undefined, setVideoInput: () => undefined }),
    on: () => undefined
  };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, () => undefined);
  await calls.place(client, "!room:localhost", { video: false });

  await calls.muteMicrophone("call-1", true);

  assert.equal(calls.list()[0].isMicrophoneMuted, true, "it came back before the call was silenced");
});

/**
 * Putting the camera away is not done when the flag says so: the SDK stops and lets go of the track a moment
 * afterwards. Coming back inside that moment asks for the camera again and then has it taken away, which is
 * why turning it off and straight back on worked most of the time and not always.
 *
 * So putting it away comes back when the camera is really gone, which is what the SDK's own reading says.
 */
test("putting the camera away comes back once the camera is really gone", async () => {
  const asked = [];
  const call = fakeCall(asked);
  let away = false;
  let stillHasTheTrack = true;
  call.setLocalVideoMuted = wanted => {
    away = wanted;
    // The track goes a moment later, as the real one does.
    setTimeout(() => { stillHasTheTrack = !wanted; }, 40);
    return away;
  };
  call.isLocalVideoMuted = () => away;
  Object.defineProperty(call, "hasLocalUserMediaVideoTrack", { get: () => stillHasTheTrack });
  const client = {
    createCall: () => call,
    getSafeUserId: () => "@alice:localhost",
    getMediaHandler: () => ({ setAudioInput: () => undefined, setVideoInput: () => undefined }),
    on: () => undefined
  };
  const calls = new MatrixCalls();
  calls.watch(client, () => undefined, () => undefined);
  await calls.place(client, "!room:localhost", { video: true });

  await calls.muteCamera("call-1", true);

  assert.equal(stillHasTheTrack, false, "it came back while the camera was still being let go of");
});
