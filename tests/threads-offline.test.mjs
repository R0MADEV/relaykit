import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, storage, conversation };
}

test("what hangs from a message is still there when the homeserver is not", async () => {
  const { adapter, client, conversation } = await startClient();
  const root = await client.messages.send(conversation.id, "la pregunta");
  await client.messages.send(conversation.id, "la respuesta", { threadId: root.id });
  const seenBefore = await client.messages.thread(conversation.id, root.id);
  assert.equal(seenBefore.length, 1);

  adapter.listThread = () => Promise.reject(new Error("the homeserver is not answering"));
  const seenOffline = await client.messages.thread(conversation.id, root.id);

  assert.deepEqual(seenOffline.map(message => message.body), ["la respuesta"]);
  await client.stop();
});

test("a thread nobody has ever opened says so instead of pretending", async () => {
  const { adapter, client, conversation } = await startClient();
  const root = await client.messages.send(conversation.id, "la pregunta");
  adapter.listThread = () => Promise.reject(new Error("the homeserver is not answering"));

  await assert.rejects(client.messages.thread(conversation.id, root.id), /not answering/i);
  await client.stop();
});

test("what the homeserver says about a thread is what is shown", async () => {
  const { adapter, client, conversation } = await startClient();
  const root = await client.messages.send(conversation.id, "la pregunta");
  await client.messages.send(conversation.id, "la primera", { threadId: root.id });
  await client.messages.thread(conversation.id, root.id);

  await client.messages.send(conversation.id, "la segunda", { threadId: root.id });
  const seen = await client.messages.thread(conversation.id, root.id);

  assert.deepEqual(seen.map(message => message.body), ["la primera", "la segunda"]);
  assert.equal(adapter.listThread === undefined, false);
  await client.stop();
});

test("reading the conversation does not throw away what was kept of its threads", async () => {
  const { adapter, client, conversation } = await startClient();
  const root = await client.messages.send(conversation.id, "la pregunta");
  await client.messages.send(conversation.id, "la respuesta", { threadId: root.id });
  await client.messages.thread(conversation.id, root.id);

  // Reading the conversation is about the main timeline, and a thread is not part of it.
  await client.messages.list(conversation.id);

  adapter.listThread = () => Promise.reject(new Error("the homeserver is not answering"));
  const seenOffline = await client.messages.thread(conversation.id, root.id);
  assert.deepEqual(seenOffline.map(message => message.body), ["la respuesta"]);
  await client.stop();
});

test("a thread does not push the conversation out of the cache either", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session, cache: { messagesPerConversation: 5 } });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const root = await client.messages.send(conversation.id, "la pregunta");
  for (let index = 0; index < 4; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `respuesta ${index}`, { createdAt: 2000 + index, threadId: root.id });
  }
  await client.messages.thread(conversation.id, root.id);

  const shown = await client.messages.list(conversation.id);

  assert.ok(shown.some(message => message.body === "la pregunta"), "the question is part of the conversation");
  assert.ok(!shown.some(message => message.body.startsWith("respuesta")), "its answers are not");
  await client.stop();
});
