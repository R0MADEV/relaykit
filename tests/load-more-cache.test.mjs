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

  async deleteMessages(messageIds) {
    this.deleted += messageIds.length;
    return super.deleteMessages(messageIds);
  }

  async deleteMessage(messageId) {
    this.deleted += 1;
    return super.deleteMessage(messageId);
  }
}

async function startClient() {
  const adapter = new InMemoryAdapter();
  const storage = new CountingStorage();
  const client = new MessagingClient({ adapter, storage, session, cache: { messagesPerConversation: 20 } });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, storage, conversation };
}

function fill(adapter, conversationId, howMany) {
  for (let index = 0; index < howMany; index += 1) {
    adapter.receiveMessage(conversationId, "bob", `mensaje ${index}`, { createdAt: 1000 + index });
  }
}

test("looking further back does not write history the cache is not going to keep", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  fill(adapter, conversation.id, 100);
  await client.messages.list(conversation.id);
  storage.written = 0;
  storage.deleted = 0;

  await client.messages.loadMore(conversation.id, 50);

  assert.ok(storage.written <= 20, `looking back wrote ${storage.written} messages for a cache of twenty`);
  await client.stop();
});

test("looking further back twice writes nothing the second time", async () => {
  const { adapter, client, storage, conversation } = await startClient();
  fill(adapter, conversation.id, 100);
  await client.messages.list(conversation.id);
  await client.messages.loadMore(conversation.id, 50);
  storage.written = 0;
  storage.deleted = 0;

  await client.messages.loadMore(conversation.id, 50);

  assert.equal(storage.written, 0, "nothing changed, so nothing should be written");
  assert.equal(storage.deleted, 0);
  await client.stop();
});

test("what came back from looking further back is still all shown", async () => {
  const { adapter, client, conversation } = await startClient();
  fill(adapter, conversation.id, 100);
  await client.messages.list(conversation.id);

  const page = await client.messages.loadMore(conversation.id, 50);

  assert.equal(page.messages.length, 100, "what the conversation has is shown, whatever the cache keeps");
  await client.stop();
});
