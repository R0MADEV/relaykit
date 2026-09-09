import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

test("logout purges conversations, messages and outbox from local storage", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "hello");
  await storage.saveOutboxOperation({
    id: "local-pending",
    transactionId: "txn-pending",
    conversationId: conversation.id,
    body: "pending",
    status: "pending",
    attempts: 0,
    nextAttemptAt: Number.MAX_SAFE_INTEGER,
    createdAt: 1
  });
  assert.ok((await storage.getMessages(conversation.id)).length > 0);

  await client.logout();

  assert.deepEqual(await storage.getConversations(), []);
  assert.deepEqual(await storage.getMessages(conversation.id), []);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
});

test("stop keeps local storage so the session can resume", async () => {
  const adapter = new InMemoryAdapter();
  const storage = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage, session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  await client.messages.send(conversation.id, "hello");

  await client.stop();

  assert.equal((await storage.getMessages(conversation.id)).length, 1);
});

test("logout reaches the adapter while it is still started so the server session is revoked", async () => {
  const calls = [];
  class RecordingAdapter extends InMemoryAdapter {
    async stop() { calls.push("stop"); return super.stop(); }
    async logout() { calls.push("logout"); return super.logout(); }
  }
  const client = new MessagingClient({ adapter: new RecordingAdapter(), storage: new InMemoryStorage(), session });
  await client.start();

  await client.logout();

  assert.deepEqual(calls, ["logout", "stop"]);
  assert.equal(client.getConnectionStatus(), "disconnected");
  await assert.rejects(client.conversations.list(), { code: "NOT_STARTED" });
});
