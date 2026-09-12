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

test("a conversation says which of its messages are pinned", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "esto hay que tenerlo a mano");

  await client.conversations.pin(conversation.id, sent.id);

  const listed = (await client.conversations.list()).find(item => item.id === conversation.id);
  assert.deepEqual(listed?.pinnedIds, [sent.id]);
  await client.stop();
});

test("what was pinned is still there when the homeserver is not", async () => {
  const { adapter, client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "esto hay que tenerlo a mano");
  await client.conversations.pin(conversation.id, sent.id);
  await client.conversations.list();
  await client.messages.list(conversation.id);

  adapter.listPinnedMessages = () => Promise.reject(new Error("the homeserver is not answering"));
  const seenOffline = await client.conversations.pinned(conversation.id);

  assert.deepEqual(seenOffline.map(message => message.body), ["esto hay que tenerlo a mano"]);
  await client.stop();
});

test("unpinning takes it off the list", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "esto hay que tenerlo a mano");
  await client.conversations.pin(conversation.id, sent.id);

  await client.conversations.unpin(conversation.id, sent.id);

  const listed = (await client.conversations.list()).find(item => item.id === conversation.id);
  assert.deepEqual(listed?.pinnedIds ?? [], []);
  await client.stop();
});

test("a conversation nobody ever asked about says so instead of pretending", async () => {
  const { adapter, client, conversation } = await startClient();
  adapter.listPinnedMessages = () => Promise.reject(new Error("the homeserver is not answering"));

  await assert.rejects(client.conversations.pinned(conversation.id), /not answering/i);
  await client.stop();
});
