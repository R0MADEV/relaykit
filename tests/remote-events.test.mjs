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
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  return { adapter, storage, client, conversation };
}

function collect(client, eventName) {
  const received = [];
  client.on(eventName, payload => received.push(payload));
  return received;
}

test("a remote deletion is persisted and emitted as message.updated", async () => {
  const { adapter, storage, client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "to be redacted");
  const updates = collect(client, "message.updated");

  await adapter.deleteMessage(conversation.id, sent.id);

  assert.equal(updates.length, 1);
  assert.equal(updates[0].id, sent.id);
  assert.ok(updates[0].deletedAt);
  assert.ok((await storage.getMessage(sent.id)).deletedAt);
  await client.stop();
});

test("a remote edit is persisted and emitted as message.updated", async () => {
  const { adapter, storage, client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "before");
  const updates = collect(client, "message.updated");

  await adapter.editMessage(conversation.id, sent.id, "after");

  assert.equal(updates.length, 1);
  assert.equal(updates[0].body, "after");
  assert.equal((await storage.getMessage(sent.id)).body, "after");
  await client.stop();
});

test("typing updates are emitted as typing.changed", async () => {
  const { client, conversation } = await startClient();
  const updates = collect(client, "typing.changed");

  await client.conversations.typing(conversation.id, true);
  await client.conversations.typing(conversation.id, false);

  assert.deepEqual(updates, [
    { conversationId: conversation.id, userIds: ["alice"] },
    { conversationId: conversation.id, userIds: [] }
  ]);
  await client.stop();
});

test("read receipts are emitted as receipt.received", async () => {
  const { client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "read me");
  const receipts = collect(client, "receipt.received");

  await client.messages.markRead(conversation.id, sent.id);

  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].conversationId, conversation.id);
  assert.equal(receipts[0].messageId, sent.id);
  assert.equal(receipts[0].userId, "alice");
  assert.equal(typeof receipts[0].readAt, "number");
  await client.stop();
});

test("presence updates are emitted as presence.changed", async () => {
  const { client } = await startClient();
  const updates = collect(client, "presence.changed");

  await client.presence.set({ presence: "online", statusMessage: "working" });

  assert.deepEqual(updates, [{ userId: "alice", presence: "online", statusMessage: "working" }]);
  await client.stop();
});

test("a message from someone else raises a notification, and one of your own does not", async () => {
  const { adapter, client, conversation } = await startClient();
  const notifications = collect(client, "notification");

  await client.messages.send(conversation.id, "escribo yo");
  adapter.receiveMessage(conversation.id, "bob", "mira esto");

  assert.equal(notifications.length, 1);
  assert.equal(notifications[0].conversationId, conversation.id);
  assert.equal(notifications[0].senderId, "bob");
  assert.equal(notifications[0].body, "mira esto");
  assert.equal(notifications[0].isMention, false);
  await client.stop();
});

test("a message naming you is flagged as a mention", async () => {
  const { adapter, client, conversation } = await startClient();
  const notifications = collect(client, "notification");

  adapter.receiveMessage(conversation.id, "bob", "alice, ¿me lees?");

  assert.equal(notifications.at(-1).isMention, true);
  await client.stop();
});

test("a message reports who has read it", async () => {
  const { adapter, client, conversation } = await startClient();
  const sent = await client.messages.send(conversation.id, "¿lo has visto?");

  assert.deepEqual(await client.messages.readBy(conversation.id, sent.id), []);

  adapter.receiveReadReceipt(conversation.id, sent.id, "bob");

  const readers = await client.messages.readBy(conversation.id, sent.id);
  assert.deepEqual(readers.map(receipt => receipt.userId), ["bob"]);
  assert.equal(readers[0].messageId, sent.id);
  assert.equal(typeof readers[0].readAt, "number");
  await client.stop();
});

test("asking who read a message validates its identifiers", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.messages.readBy(conversation.id, "  "), { code: "INVALID_INPUT" });
  await client.stop();
});
