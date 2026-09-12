import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "lectura" });
  return { adapter, client, conversation };
}

test("reading quietly does not tell the other side", async () => {
  class WatchfulAdapter extends InMemoryAdapter {
    told;
    async markMessageRead(conversationId, messageId, options) {
      this.told = options;
      return super.markMessageRead(conversationId, messageId, options);
    }
  }
  const { adapter, client, conversation } = await startClient(new WatchfulAdapter());
  const sent = await client.messages.send(conversation.id, "hola");

  await client.messages.markRead(conversation.id, sent.id, { private: true });

  assert.deepEqual(adapter.told, { private: true });
  await client.stop();
});

test("reading quietly still moves the marker for this person", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "hola");

  await client.messages.markRead(conversation.id, sent.id, { private: true });

  const current = (await client.conversations.list()).find(item => item.id === conversation.id);
  assert.equal(current.lastReadMessageId, sent.id);
  await client.stop();
});

test("a conversation can be put back to unread on purpose", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "hola");
  await client.messages.markRead(conversation.id, sent.id);

  const marked = await client.conversations.setUnread(conversation.id, true);

  assert.equal(marked.isUnread, true);
  const listed = (await client.conversations.list()).find(item => item.id === conversation.id);
  assert.equal(listed.isUnread, true);
  await client.stop();
});

test("reading a conversation takes the unread mark off again", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "hola");
  await client.conversations.setUnread(conversation.id, true);

  await client.messages.markRead(conversation.id, sent.id);

  const listed = (await client.conversations.list()).find(item => item.id === conversation.id);
  assert.equal(listed.isUnread, false);
  await client.stop();
});

test("what is waiting can be asked for, which is what a cold start shows", async () => {
  const { client, conversation } = await startClient();
  await client.messages.send(conversation.id, "te espera esto");

  const waiting = await client.push.pending();

  assert.ok(Array.isArray(waiting));
  assert.ok(waiting.every(item => typeof item.conversationId === "string" && typeof item.body === "string"));
  await client.stop();
});

test("asking for nothing waiting is not a request", async () => {
  const { client } = await startClient();

  await assert.rejects(client.push.pending({ limit: 0 }), { code: "INVALID_INPUT" });
  await client.stop();
});
