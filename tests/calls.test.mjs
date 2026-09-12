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
