import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("a conversation nobody has read yet does not say where anyone left off", async () => {
  const { client } = await startClient();

  assert.equal((await client.conversations.list())[0].lastReadMessageId, undefined);
  await client.stop();
});

test("marking a message as read remembers where the conversation was left", async () => {
  const { adapter, client, conversation } = await startClient();
  const first = adapter.receiveMessage(conversation.id, "bob", "uno");
  const second = adapter.receiveMessage(conversation.id, "bob", "dos");

  await client.messages.markRead(conversation.id, first.id);

  assert.equal((await client.conversations.list())[0].lastReadMessageId, first.id);
  assert.notEqual(second.id, first.id);
  await client.stop();
});

test("where somebody left off belongs to the person, so it moves on with them", async () => {
  const { adapter, client, conversation } = await startClient();
  const first = adapter.receiveMessage(conversation.id, "bob", "uno");
  const second = adapter.receiveMessage(conversation.id, "bob", "dos");
  await client.messages.markRead(conversation.id, first.id);

  await client.messages.markRead(conversation.id, second.id);

  assert.equal((await client.conversations.list())[0].lastReadMessageId, second.id);
  await client.stop();
});

test("what has not been read yet can be counted from where the person left off", async () => {
  const { adapter, client, conversation } = await startClient();
  const first = adapter.receiveMessage(conversation.id, "bob", "uno");
  adapter.receiveMessage(conversation.id, "bob", "dos");
  adapter.receiveMessage(conversation.id, "bob", "tres");
  await client.messages.markRead(conversation.id, first.id);

  const unread = await client.messages.unreadSince(conversation.id);

  assert.deepEqual(unread.map(message => message.body), ["dos", "tres"]);
  await client.stop();
});

test("with nothing read yet everything counts as unread", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.receiveMessage(conversation.id, "bob", "uno");
  adapter.receiveMessage(conversation.id, "bob", "dos");

  const unread = await client.messages.unreadSince(conversation.id);

  assert.deepEqual(unread.map(message => message.body), ["uno", "dos"]);
  await client.stop();
});
