import "fake-indexeddb/auto";
import assert from "node:assert/strict";
import test from "node:test";
import { IndexedDbStorage } from "@relaykit/browser-storage";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
let databaseCount = 0;

function createStorage() {
  databaseCount += 1;
  return new IndexedDbStorage(`relaykit-batch-${databaseCount}`, { encryptionSecret: "device-secret" });
}

function message(index) {
  return {
    id: `message-${index}`,
    conversationId: "conversation-1",
    senderId: "bob",
    body: `mensaje ${index}`,
    createdAt: 1000 + index,
    status: "sent"
  };
}

test("many messages can be kept in one go", async () => {
  const storage = createStorage();

  await storage.saveMessages([message(1), message(2), message(3)]);

  const kept = await storage.getMessages("conversation-1");
  assert.deepEqual(kept.map(item => item.body), ["mensaje 1", "mensaje 2", "mensaje 3"]);
});

test("keeping nothing does nothing", async () => {
  const storage = createStorage();

  await storage.saveMessages([]);

  assert.deepEqual(await storage.getMessages("conversation-1"), []);
});

test("many conversations can be kept in one go", async () => {
  const storage = createStorage();

  await storage.saveConversations([
    { id: "conversation-1", participantIds: ["bob"] },
    { id: "conversation-2", participantIds: ["carol"] }
  ]);

  assert.equal((await storage.getConversations()).length, 2);
});

class CountingStorage extends InMemoryStorage {
  singleMessageWrites = 0;
  batchedMessageWrites = 0;
  singleConversationWrites = 0;
  batchedConversationWrites = 0;

  async saveMessage(message) {
    this.singleMessageWrites += 1;
    return super.saveMessage(message);
  }

  async saveMessages(messages) {
    this.batchedMessageWrites += 1;
    return super.saveMessages(messages);
  }

  async saveConversation(conversation) {
    this.singleConversationWrites += 1;
    return super.saveConversation(conversation);
  }

  async saveConversations(conversations) {
    this.batchedConversationWrites += 1;
    return super.saveConversations(conversations);
  }
}

test("reading a timeline keeps it in one write, not one per message", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  for (let index = 0; index < 10; index += 1) adapter.receiveMessage(conversation.id, "bob", `hola ${index}`);
  storage.singleMessageWrites = 0;
  storage.batchedMessageWrites = 0;

  await client.messages.list(conversation.id);

  assert.equal(storage.singleMessageWrites, 0, "no message should be written on its own");
  assert.equal(storage.batchedMessageWrites, 1);
  await client.stop();
});

test("reading the conversation list keeps it in one write", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  for (let index = 0; index < 5; index += 1) {
    await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` });
  }
  storage.singleConversationWrites = 0;
  storage.batchedConversationWrites = 0;

  await client.conversations.list();

  assert.equal(storage.singleConversationWrites, 0, "no conversation should be written on its own");
  assert.equal(storage.batchedConversationWrites, 1);
  await client.stop();
});
