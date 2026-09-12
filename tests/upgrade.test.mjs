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

test("a conversation that has not been replaced does not point anywhere else", async () => {
  const { client, conversation } = await startClient();

  assert.equal(conversation.replacedBy, undefined);
  assert.equal(conversation.replaces, undefined);
  await client.stop();
});

test("replacing a conversation leaves a way to reach the new one", async () => {
  const { client, conversation } = await startClient();

  const replacement = await client.conversations.upgrade(conversation.id);

  assert.notEqual(replacement.id, conversation.id);
  assert.equal(replacement.replaces, conversation.id);
  const listed = await client.conversations.list();
  assert.equal(listed.find(item => item.id === conversation.id)?.replacedBy, replacement.id);
  await client.stop();
});

test("the replacement keeps the name and the people of the one it replaces", async () => {
  const { client, conversation } = await startClient();

  const replacement = await client.conversations.upgrade(conversation.id);

  assert.equal(replacement.title, "Equipo");
  assert.ok(replacement.participantIds.includes("bob"));
  await client.stop();
});

test("following a conversation that was replaced lands on the one that replaced it", async () => {
  const { client, conversation } = await startClient();
  const replacement = await client.conversations.upgrade(conversation.id);

  const current = await client.conversations.current(conversation.id);

  assert.equal(current.id, replacement.id);
  await client.stop();
});

test("a conversation nobody replaced is its own current one", async () => {
  const { client, conversation } = await startClient();

  const current = await client.conversations.current(conversation.id);

  assert.equal(current.id, conversation.id);
  await client.stop();
});

test("following a chain of replacements lands on the last one", async () => {
  const { client, conversation } = await startClient();
  const second = await client.conversations.upgrade(conversation.id);
  const third = await client.conversations.upgrade(second.id);

  const current = await client.conversations.current(conversation.id);

  assert.equal(current.id, third.id);
  await client.stop();
});
