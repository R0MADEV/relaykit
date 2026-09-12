import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingAdapter extends InMemoryAdapter {
  typingCalls = [];

  async setTyping(conversationId, isTyping, timeoutMs) {
    this.typingCalls.push({ conversationId, isTyping });
    return super.setTyping(conversationId, isTyping, timeoutMs);
  }
}

async function startClient() {
  const adapter = new CountingAdapter();
  let now = 0;
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session, now: () => now });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const other = await client.conversations.create({ participantIds: ["carol"], title: "Otra" });
  return { adapter, client, conversation, other, at: value => { now = value; } };
}

test("writing a long message does not send one notice per letter", async () => {
  const { adapter, client, conversation, at } = await startClient();

  for (const moment of [0, 100, 200, 300, 400]) {
    at(moment);
    await client.conversations.typing(conversation.id, true);
  }

  assert.equal(adapter.typingCalls.length, 1);
  await client.stop();
});

test("someone who keeps writing is kept alive before the notice runs out", async () => {
  const { adapter, client, conversation, at } = await startClient();
  await client.conversations.typing(conversation.id, true);

  at(4000);
  await client.conversations.typing(conversation.id, true);

  assert.equal(adapter.typingCalls.length, 2);
  await client.stop();
});

test("stopping is said straight away, because the other side is waiting for it", async () => {
  const { adapter, client, conversation, at } = await startClient();
  await client.conversations.typing(conversation.id, true);

  at(50);
  await client.conversations.typing(conversation.id, false);

  assert.deepEqual(adapter.typingCalls.map(call => call.isTyping), [true, false]);
  await client.stop();
});

test("stopping when nobody was writing says nothing", async () => {
  const { adapter, client, conversation } = await startClient();

  await client.conversations.typing(conversation.id, false);

  assert.deepEqual(adapter.typingCalls, []);
  await client.stop();
});

test("after stopping, writing again is announced", async () => {
  const { adapter, client, conversation, at } = await startClient();
  await client.conversations.typing(conversation.id, true);
  at(50);
  await client.conversations.typing(conversation.id, false);

  at(100);
  await client.conversations.typing(conversation.id, true);

  assert.deepEqual(adapter.typingCalls.map(call => call.isTyping), [true, false, true]);
  await client.stop();
});

test("writing in two conversations is announced in both", async () => {
  const { adapter, client, conversation, other } = await startClient();

  await client.conversations.typing(conversation.id, true);
  await client.conversations.typing(other.id, true);

  assert.deepEqual(adapter.typingCalls.map(call => call.conversationId), [conversation.id, other.id]);
  await client.stop();
});

test("signing out forgets who was writing, so the next session announces it again", async () => {
  const { adapter, client, conversation, at } = await startClient();
  await client.conversations.typing(conversation.id, true);

  await client.stop();
  await client.start();
  at(100);
  await client.conversations.typing(conversation.id, true);

  assert.equal(adapter.typingCalls.length, 2);
  await client.stop();
});
