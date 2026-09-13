import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * A call is not a message: it is something happening now among the people of a conversation. Whoever starts
 * it is the first one on it and the others are rung; they pick up by walking in, and it goes on for whoever
 * is left when somebody leaves. Matrix says who may be on it; a server that cannot read the picture carries
 * it.
 */
async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "calls" });
  return { adapter, client, conversation };
}

test("starting a call puts this side on it, with nobody else there yet", async () => {
  const { client, conversation } = await startClient();

  const call = await client.calls.place(conversation.id, { video: false });

  assert.equal(call.conversationId, conversation.id);
  assert.equal(call.isVideo, false);
  assert.equal(call.state, "connected");
  assert.deepEqual(
    call.participants.map(participant => participant.userId),
    ["alice"]
  );
  await client.stop();
});

test("a call with video says so, because a screen has to be made room for", async () => {
  const { client, conversation } = await startClient();

  const call = await client.calls.place(conversation.id, { video: true });

  assert.equal(call.isVideo, true);
  await client.stop();
});

test("calling a conversation that is not there is refused", async () => {
  const { client } = await startClient();

  await assert.rejects(client.calls.place("!nowhere:localhost", {}), { code: "CONVERSATION_NOT_FOUND" });
  await client.stop();
});

test("a call that arrives is announced, so a screen can ring", async () => {
  const { adapter, client, conversation } = await startClient();
  const announced = new Promise(resolve => client.on("call.incoming", resolve));

  adapter.startConferenceAs(conversation.id, "bob");

  const call = await announced;
  assert.equal(call.conversationId, conversation.id);
  assert.equal(call.callerId, "bob");
  assert.equal(call.state, "ringing");
  await client.stop();
});

test("picking up is walking in: the same call, now with this side on it", async () => {
  const { adapter, client, conversation } = await startClient();
  const incoming = new Promise(resolve => client.on("call.incoming", resolve));
  adapter.startConferenceAs(conversation.id, "bob");
  const call = await incoming;

  const answered = await client.calls.answer(call.id, {});

  assert.equal(answered.id, call.id);
  assert.equal(answered.state, "connected");
  assert.deepEqual(
    answered.participants.map(participant => participant.userId),
    ["bob", "alice"]
  );
  await client.stop();
});

test("not picking up leaves the call going without this side", async () => {
  const { adapter, client, conversation } = await startClient();
  const incoming = new Promise(resolve => client.on("call.incoming", resolve));
  adapter.startConferenceAs(conversation.id, "bob");
  const call = await incoming;

  await client.calls.reject(call.id);

  assert.deepEqual(await client.calls.list(), []);
  assert.equal(adapter.callIsGoingOn(call.id), true, "refusing must not end it for whoever is on it");
  await client.stop();
});

test("a call can be hung up, and then it is over for the one who was alone on it", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.place(conversation.id, {});

  await client.calls.hangUp(call.id);

  assert.deepEqual(await client.calls.list(), []);
  await client.stop();
});

test("what is going on can be asked for, which is what a screen paints", async () => {
  const { client, conversation } = await startClient();
  await client.calls.place(conversation.id, {});

  const going = await client.calls.list();

  assert.equal(going.length, 1);
  assert.equal(going[0].conversationId, conversation.id);
  await client.stop();
});

test("what is silenced, shown and chosen on a call travels to the other side", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.place(conversation.id);

  await client.calls.muteMicrophone(call.id, true);
  await client.calls.muteCamera(call.id, true);
  await client.calls.shareScreen(call.id, true);
  await client.calls.useMicrophone("mic-1");
  await client.calls.useCamera("cam-1");

  const [going] = await client.calls.list();
  assert.equal(going.isMicrophoneMuted, true);
  assert.equal(going.isCameraMuted, true);
  assert.equal(going.isSharingScreen, true);
  await client.stop();
});

test("how a call is going can be asked for, so a screen can say why nobody is heard", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.place(conversation.id);

  assert.deepEqual(await client.calls.quality(call.id), {});
  await client.stop();
});

test("a call nobody named, and a device nobody named, are refused before anything is asked of the adapter", async () => {
  const { client } = await startClient();

  for (const blank of ["", "   "]) {
    await assert.rejects(client.calls.muteMicrophone(blank, true), { code: "INVALID_INPUT" });
    await assert.rejects(client.calls.useMicrophone(blank), { code: "INVALID_INPUT" });
    await assert.rejects(client.calls.useCamera(blank), { code: "INVALID_INPUT" });
  }
  await client.stop();
});

/**
 * Not every protocol, and not every homeserver, can hold a conference. An adapter that cannot says so by
 * not offering it at all, and asking anyway has to come back as something an application can act on rather
 * than as whatever the missing method happens to do.
 */
test("an adapter that cannot hold calls refuses them as unsupported", async () => {
  class WithoutCalls extends InMemoryAdapter {
    calling = undefined;
  }
  const { client, conversation } = await startClient(new WithoutCalls());

  await assert.rejects(client.calls.place(conversation.id), { code: "NOT_SUPPORTED" });
  await assert.rejects(client.calls.list(), { code: "NOT_SUPPORTED" });
  await client.stop();
});

/**
 * A call that is over is the only source a screen has for how long it lasted. The timeline draws "14 min 22 s"
 * and a room list draws the same for every past one, so what ends has to say when it ended — the start alone
 * cannot be subtracted from anything.
 */
test("a call that ends says when it ended, so how long it lasted can be worked out", async () => {
  const { client, conversation } = await startClient();
  const ended = [];
  client.on("call.changed", call => {
    if (call.state === "ended") ended.push(call);
  });
  const call = await client.calls.place(conversation.id);

  await client.calls.hangUp(call.id);

  assert.equal(ended.length, 1);
  const [over] = ended;
  assert.equal(typeof over.endedAt, "number");
  assert.ok(over.endedAt >= over.startedAt, "a call cannot end before it started");
  await client.stop();
});

test("a call nobody ever joined still says when it ended", async () => {
  const { adapter, client, conversation } = await startClient();
  const ended = [];
  client.on("call.changed", call => {
    if (call.state === "ended") ended.push(call);
  });
  const rung = adapter.startConferenceAs(conversation.id, "bob");

  adapter.endConference(rung.id);

  assert.equal(ended.length, 1);
  assert.equal(typeof ended[0].endedAt, "number");
  await client.stop();
});
