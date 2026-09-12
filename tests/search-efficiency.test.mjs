import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class CountingStorage extends InMemoryStorage {
  conversationsRead = [];

  async getMessages(conversationId) {
    this.conversationsRead.push(conversationId);
    return super.getMessages(conversationId);
  }
}

async function startClient() {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  return { adapter, client, storage };
}

async function fill(client, adapter, howManyConversations, messagesEach) {
  const made = [];
  for (let index = 0; index < howManyConversations; index += 1) {
    const conversation = await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` });
    for (let message = 0; message < messagesEach; message += 1) {
      adapter.receiveMessage(conversation.id, "bob", `aguja ${index}-${message}`);
    }
    await client.messages.list(conversation.id);
    made.push(conversation);
  }
  return made;
}

test("a search brings back at most what was asked for", async () => {
  const { adapter, client } = await startClient();
  await fill(client, adapter, 3, 10);

  const found = await client.messages.search("aguja", { limit: 5 });

  assert.equal(found.length, 5);
  await client.stop();
});

test("a search stops looking once it has enough", async () => {
  const { adapter, client, storage } = await startClient();
  await fill(client, adapter, 5, 10);
  storage.conversationsRead.length = 0;

  await client.messages.search("aguja", { limit: 3 });

  assert.ok(
    storage.conversationsRead.length < 5,
    `it read ${storage.conversationsRead.length} conversations when three matches were enough`
  );
  await client.stop();
});

test("without a limit a search still does not run away with the whole history", async () => {
  const { adapter, client } = await startClient();
  await fill(client, adapter, 3, 40);

  const found = await client.messages.search("aguja");

  assert.ok(found.length <= 50, `a search with no limit brought back ${found.length}`);
  await client.stop();
});

test("searching one conversation only looks there", async () => {
  const { adapter, client, storage } = await startClient();
  const made = await fill(client, adapter, 3, 5);
  storage.conversationsRead.length = 0;

  await client.messages.search("aguja", { conversationId: made[1].id });

  assert.deepEqual(storage.conversationsRead, [made[1].id]);
  await client.stop();
});

test("the newest matches are the ones that come back", async () => {
  const { adapter, client } = await startClient();
  const [conversation] = await fill(client, adapter, 1, 3);
  // A real conversation does not stamp every message with the same millisecond.
  const newest = adapter.receiveMessage(conversation.id, "bob", "aguja mas nueva", { createdAt: Date.now() + 5000 });
  await client.messages.list(conversation.id);

  const found = await client.messages.search("aguja", { limit: 1 });

  assert.equal(found[0]?.id, newest.id);
  await client.stop();
});

test("a limit that is not a count is refused", async () => {
  const { client } = await startClient();

  await assert.rejects(client.messages.search("aguja", { limit: 0 }), /limit/i);
  await assert.rejects(client.messages.search("aguja", { limit: -3 }), /limit/i);
  await client.stop();
});
