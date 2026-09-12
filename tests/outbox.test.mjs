import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, SdkError } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

class RecordingAdapter extends InMemoryAdapter {
  sentBodies = [];
  failuresLeft = 0;
  releaseSend = undefined;

  async sendMessage(conversationId, body, ...rest) {
    if (this.failuresLeft > 0) {
      this.failuresLeft -= 1;
      throw new Error("temporary failure");
    }
    if (this.releaseSend) {
      await this.releaseSend;
    }
    this.sentBodies.push(body);
    return super.sendMessage(conversationId, body, ...rest);
  }
}

function createClient(adapter, storage) {
  return new MessagingClient({ adapter, storage, session });
}

async function createFailedMessage(client, conversationId, body) {
  await assert.rejects(client.messages.send(conversationId, body));
  const failed = (await client.messages.list(conversationId)).find(message => message.body === body);
  assert.equal(failed?.status, "failed");
  return failed;
}

async function waitUntil(check, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const result = await check();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return undefined;
}

function seedInterruptedOperation(storage, conversationId, body, createdAt) {
  const id = `local-${body}`;
  const base = { id, transactionId: `txn-${body}`, conversationId, body, createdAt };
  return Promise.all([
    storage.saveMessage({ ...base, senderId: "alice", status: "sending" }),
    storage.saveOutboxOperation({ ...base, status: "processing", attempts: 0, nextAttemptAt: 0 })
  ]);
}

test("local message ids stay unique across client restarts", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const first = createClient(adapter, storage);
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"] });
  adapter.failuresLeft = 1;
  await createFailedMessage(first, conversation.id, "first");
  await first.stop();

  const second = createClient(adapter, storage);
  await second.start();
  const sent = await second.messages.send(conversation.id, "second");
  const messages = await second.messages.list(conversation.id);

  assert.equal(sent.status, "sent");
  // Starting again flushes what was queued, and neither message may end up duplicated.
  assert.equal(messages.filter(message => message.body === "first").length, 1);
  assert.equal(messages.filter(message => message.body === "second").length, 1);
  assert.equal(new Set(messages.map(message => message.id)).size, messages.length);
  await second.stop();
});

test("restart recovers an operation interrupted while sending", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const first = createClient(adapter, storage);
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"] });
  await first.stop();
  await seedInterruptedOperation(storage, conversation.id, "interrupted", 1);

  const second = createClient(adapter, storage);
  await second.start();
  const messages = await second.messages.list(conversation.id);

  assert.deepEqual(adapter.sentBodies, ["interrupted"]);
  assert.deepEqual(messages.map(message => [message.body, message.status]), [["interrupted", "sent"]]);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
  await second.stop();
});

test("restart recovers an operation whose message record was lost", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const first = createClient(adapter, storage);
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"] });
  await first.stop();
  await storage.saveOutboxOperation({
    id: "local-orphan",
    transactionId: "txn-orphan",
    conversationId: conversation.id,
    body: "orphan",
    status: "pending",
    attempts: 0,
    nextAttemptAt: 0,
    createdAt: 1
  });

  const second = createClient(adapter, storage);
  await second.start();
  const messages = await second.messages.list(conversation.id);

  assert.deepEqual(messages.map(message => [message.body, message.status]), [["orphan", "sent"]]);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
  await second.stop();
});

test("flush processes recovered operations in creation order", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const first = createClient(adapter, storage);
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"] });
  await first.stop();
  await seedInterruptedOperation(storage, conversation.id, "newer", 2);
  await seedInterruptedOperation(storage, conversation.id, "older", 1);

  const second = createClient(adapter, storage);
  await second.start();

  assert.deepEqual(adapter.sentBodies, ["older", "newer"]);
  await second.stop();
});

test("concurrent retries of the same message send it once", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.failuresLeft = 1;
  const failed = await createFailedMessage(client, conversation.id, "once");

  let release;
  adapter.releaseSend = new Promise(resolve => { release = resolve; });
  const retries = Promise.all([client.messages.retry(failed.id), client.messages.retry(failed.id)]);
  release();
  const [left, right] = await retries;

  assert.equal(left.status, "sent");
  assert.equal(left.id, right.id);
  assert.deepEqual(adapter.sentBodies, ["once"]);
  assert.equal((await client.messages.list(conversation.id)).length, 1);
  await client.stop();
});

test("in-memory adapter returns the existing message for a repeated transaction id", async () => {
  const adapter = new InMemoryAdapter();
  await adapter.start(session, {});
  const conversation = await adapter.createConversation({ participantIds: ["bob"] });

  const first = await adapter.sendMessage(conversation.id, "same", { transactionId: "txn-1" });
  const second = await adapter.sendMessage(conversation.id, "same", { transactionId: "txn-1" });

  assert.equal(second.id, first.id);
  assert.equal((await adapter.listMessages(conversation.id)).length, 1);
});

test("cancel removes a failed message and its outbox operation", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.failuresLeft = 1;
  const failed = await createFailedMessage(client, conversation.id, "never");
  const updates = [];
  client.on("message.updated", message => updates.push(message));

  const cancelled = await client.messages.cancel(failed.id);

  assert.equal(cancelled.status, "cancelled");
  assert.equal(updates.at(-1)?.status, "cancelled");
  assert.deepEqual((await client.messages.list(conversation.id)).filter(message => message.body === "never"), []);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
  assert.deepEqual(adapter.sentBodies, []);
  await client.stop();
});

test("cancel rejects a message that was already sent", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const sent = await client.messages.send(conversation.id, "done");

  await assert.rejects(client.messages.cancel(sent.id), { code: "INVALID_INPUT" });
  await client.stop();
});

test("automatic retries stop after the attempt limit while manual retry still works", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.failuresLeft = 100;
  const failed = await createFailedMessage(client, conversation.id, "stubborn");
  for (let attempt = 2; attempt <= 8; attempt += 1) {
    await assert.rejects(client.messages.retry(failed.id));
  }

  assert.equal((await storage.getOutboxOperation(failed.id))?.attempts, 8);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);

  adapter.failuresLeft = 0;
  const sent = await client.messages.retry(failed.id);
  assert.equal(sent.status, "sent");
  assert.equal(await storage.getOutboxOperation(failed.id), undefined);
  await client.stop();
});

test("a queued reply keeps what it replies to after a restart", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const first = createClient(adapter, storage);
  await first.start();
  const conversation = await first.conversations.create({ participantIds: ["bob"] });
  const original = await first.messages.send(conversation.id, "original");
  adapter.failuresLeft = 1;
  await assert.rejects(first.messages.send(conversation.id, "respuesta", { replyTo: original.id }));
  const failed = (await first.messages.list(conversation.id)).find(message => message.body === "respuesta");
  assert.equal(failed.replyToId, original.id);
  await first.stop();
  const operation = await storage.getOutboxOperation(failed.id);
  assert.equal(operation.replyToId, original.id);
  await storage.saveOutboxOperation({ ...operation, nextAttemptAt: 0 });

  const second = createClient(adapter, storage);
  await second.start();

  const sent = (await second.messages.list(conversation.id)).find(message => message.body === "respuesta");
  assert.equal(sent.status, "sent");
  assert.equal(sent.replyToId, original.id);
  await second.stop();
});

test("what was queued while offline is sent as soon as the connection comes back", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.failuresLeft = 1;
  const failed = await createFailedMessage(client, conversation.id, "pendiente");
  assert.deepEqual(adapter.sentBodies, []);

  adapter.simulateConnection("connected");

  const sent = await waitUntil(async () => {
    const messages = await client.messages.list(conversation.id);
    return messages.find(message => message.body === "pendiente" && message.status === "sent");
  });
  assert.ok(sent, "the queued message should go out without waiting for the backoff");
  assert.deepEqual(adapter.sentBodies, ["pendiente"]);
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
  await client.stop();
});

test("a message that exhausted its attempts is not retried on reconnection", async () => {
  const adapter = new RecordingAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.failuresLeft = 100;
  const failed = await createFailedMessage(client, conversation.id, "imposible");
  for (let attempt = 2; attempt <= 8; attempt += 1) {
    await assert.rejects(client.messages.retry(failed.id));
  }
  const attemptsBefore = adapter.failuresLeft;

  adapter.simulateConnection("connected");
  await new Promise(resolve => setTimeout(resolve, 50));

  assert.equal(adapter.failuresLeft, attemptsBefore, "no further attempt should be made");
  await client.stop();
});

class RateLimitedAdapter extends InMemoryAdapter {
  limitOnce = false;
  sends = 0;

  async sendMessage(conversationId, body, ...rest) {
    this.sends += 1;
    if (this.limitOnce) {
      this.limitOnce = false;
      throw new SdkError("RATE_LIMITED", "El homeserver esta limitando", 60);
    }
    return super.sendMessage(conversationId, body, ...rest);
  }
}

test("a message rejected for going too fast is sent again on its own", async () => {
  const adapter = new RateLimitedAdapter();
  const storage = new InMemoryStorage();
  const client = createClient(adapter, storage);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.limitOnce = true;

  await assert.rejects(client.messages.send(conversation.id, "rapido"), { code: "RATE_LIMITED" });

  const sent = await waitUntil(async () => {
    const messages = await client.messages.list(conversation.id);
    return messages.find(message => message.body === "rapido" && message.status === "sent");
  }, 100);
  assert.ok(sent, "the message should go out once the wait the server asked for is over");
  assert.deepEqual(await storage.getReadyOutbox(Number.MAX_SAFE_INTEGER), []);
  await client.stop();
});

test("stopping the client cancels a retry that was waiting", async () => {
  const adapter = new RateLimitedAdapter();
  const client = createClient(adapter, new InMemoryStorage());
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  adapter.limitOnce = true;
  await assert.rejects(client.messages.send(conversation.id, "adios"));
  const sendsBefore = adapter.sends;

  await client.stop();
  await new Promise(resolve => setTimeout(resolve, 200));

  assert.equal(adapter.sends, sendsBefore, "no retry should happen after stopping");
});
