import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingStorage extends InMemoryStorage {
  written = 0;
  deleted = 0;

  async saveMessages(messages) {
    this.written += messages.length;
    return super.saveMessages(messages);
  }

  async saveMessage(message) {
    this.written += 1;
    return super.saveMessage(message);
  }

  async deleteMessage(messageId) {
    this.deleted += 1;
    return super.deleteMessage(messageId);
  }

  async deleteMessages(messageIds) {
    this.deleted += messageIds.length;
    return super.deleteMessages(messageIds);
  }
}

async function startClient(cache = { messagesPerConversation: 20 }) {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session, cache });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, storage, conversation };
}

function fill(adapter, conversationId, howMany) {
  for (let index = 0; index < howMany; index += 1) {
    adapter.receiveMessage(conversationId, "bob", `mensaje ${index}`, { createdAt: 1000 + index });
  }
}

test("reading a long conversation does not write the whole timeline to delete most of it again", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  fill(adapter, conversation.id, 100);
  // What each message cost to keep as it arrived is not what is being measured here.
  storage.written = 0;
  storage.deleted = 0;

  await client.messages.list(conversation.id);

  assert.ok(storage.written <= 20, `reading it wrote ${storage.written} messages for a cache of twenty`);
  assert.ok(storage.deleted <= 80, `reading it deleted ${storage.deleted}`);
  await client.stop();
});

test("opening the same conversation again writes and deletes nothing", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  fill(adapter, conversation.id, 100);
  await client.messages.list(conversation.id);
  storage.written = 0;
  storage.deleted = 0;

  await client.messages.list(conversation.id);

  assert.equal(storage.written, 0, "nothing changed, so nothing should be written");
  assert.equal(storage.deleted, 0, "nothing should be deleted and fetched again");
  await client.stop();
});

test("messages stamped at the same moment do not flip in and out of the cache", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  // A backfill stamps many messages with the same moment, and the cache boundary has to be steady anyway.
  for (let index = 0; index < 100; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `mensaje ${index}`, { createdAt: 1000 });
  }
  await client.messages.list(conversation.id);
  storage.written = 0;
  storage.deleted = 0;

  await client.messages.list(conversation.id);
  await client.messages.list(conversation.id);

  assert.equal(storage.written, 0, `it wrote ${storage.written} messages again`);
  assert.equal(storage.deleted, 0, `it deleted ${storage.deleted} messages again`);
  await client.stop();
});

test("the messages kept are the newest ones", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  fill(adapter, conversation.id, 100);

  await client.messages.list(conversation.id);

  const kept = await storage.getMessages(conversation.id);
  assert.equal(kept.length, 20);
  assert.equal(kept.at(-1)?.body, "mensaje 99");
  await client.stop();
});

test("a message still waiting to be sent is kept however full the cache is", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  const failing = new Error("the homeserver is not answering");
  const original = adapter.sendMessage.bind(adapter);
  adapter.sendMessage = () => Promise.reject(failing);
  await client.messages.send(conversation.id, "esto no ha salido").catch(() => undefined);
  adapter.sendMessage = original;
  fill(adapter, conversation.id, 100);

  await client.messages.list(conversation.id);

  const kept = await storage.getMessages(conversation.id);
  assert.ok(kept.some(message => message.body === "esto no ha salido"), "the queued message must survive");
  await client.stop();
});

test("what the conversation still has can be read back even when the cache keeps less", async () => {
  const { adapter, client, conversation } = await startClient();
  fill(adapter, conversation.id, 100);

  const listed = await client.messages.list(conversation.id);

  assert.equal(listed.length, 100, "what the conversation has is shown, whatever the cache keeps");
  await client.stop();
});
