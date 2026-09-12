import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * A call is not a message: it is something that is happening now, between the people of a conversation, and
 * it can be answered, refused or hung up. What travels over Matrix is the signalling; the audio and the video
 * go directly between the devices.
 */
async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "calls" });
  return { adapter, client, conversation };
}

test("a call can be placed into a conversation", async () => {
  const { client, conversation } = await startClient();

  const call = await client.calls.place(conversation.id, { video: false });

  assert.equal(call.conversationId, conversation.id);
  assert.equal(call.isVideo, false);
  assert.equal(call.state, "ringing");
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

  adapter.receiveCall(conversation.id, "bob", { video: false });

  const call = await announced;
  assert.equal(call.conversationId, conversation.id);
  assert.equal(call.callerId, "bob");
  assert.equal(call.state, "ringing");
  await client.stop();
});

test("a call can be answered, and then it is connected", async () => {
  const { adapter, client, conversation } = await startClient();
  const incoming = new Promise(resolve => client.on("call.incoming", resolve));
  adapter.receiveCall(conversation.id, "bob", { video: false });
  const call = await incoming;

  const answered = await client.calls.answer(call.id, {});

  assert.equal(answered.state, "connected");
  await client.stop();
});

test("a call can be hung up, and then it is over", async () => {
  const { client, conversation } = await startClient();
  const call = await client.calls.place(conversation.id, {});

  await client.calls.hangUp(call.id);

  const [seen] = await client.calls.list();
  assert.equal(seen, undefined, "a call that is over should not still be going on");
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
