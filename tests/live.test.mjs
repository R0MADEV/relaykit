import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, createConversationList, createMessageTimeline } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

async function waitUntil(check, attempts = 50) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (check()) return true;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  return false;
}

test("a conversation list loads, stays current and keeps the same snapshot while nothing changes", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const list = createConversationList(client);
  let notifications = 0;
  const unsubscribe = list.subscribe(() => { notifications += 1; });

  assert.deepEqual(list.get(), []);
  await list.refresh();

  assert.deepEqual(list.get().map(item => item.id), [conversation.id]);
  assert.equal(list.get(), list.get(), "the snapshot must be stable while nothing changes");
  const snapshot = list.get();
  await list.refresh();
  assert.equal(list.get(), snapshot, "reloading identical data must not replace the snapshot");

  adapter.receiveMessage(conversation.id, "bob", "hola");

  assert.ok(await waitUntil(() => list.get()[0]?.unreadCount === 1), "the list should follow live updates");
  assert.ok(notifications > 0);
  unsubscribe();
  list.stop();
  await client.stop();
});

test("a message timeline replaces the local echo instead of showing it twice", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  const sent = await client.messages.send(conversation.id, "hola");

  assert.ok(await waitUntil(() => timeline.get().length === 1));
  assert.deepEqual(timeline.get().map(message => message.body), ["hola"]);
  assert.equal(timeline.get()[0].id, sent.id);
  assert.equal(timeline.get()[0].status, "sent");
  timeline.stop();
  await client.stop();
});

test("a timeline follows incoming messages in order and drops cancelled ones", async () => {
  const adapter = new (class extends InMemoryAdapter {
    failNext = false;
    async sendMessage(conversationId, body, ...rest) {
      if (this.failNext) {
        this.failNext = false;
        throw new Error("sin red");
      }
      return super.sendMessage(conversationId, body, ...rest);
    }
  })();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  adapter.receiveMessage(conversation.id, "bob", "primero");
  await new Promise(resolve => setTimeout(resolve, 5));
  adapter.receiveMessage(conversation.id, "bob", "segundo");
  assert.ok(await waitUntil(() => timeline.get().length === 2));
  assert.deepEqual(timeline.get().map(message => message.body), ["primero", "segundo"]);

  adapter.failNext = true;
  await assert.rejects(client.messages.send(conversation.id, "fallido"));
  const failed = timeline.get().find(message => message.body === "fallido");
  assert.equal(failed?.status, "failed");

  await client.messages.cancel(failed.id);

  assert.ok(await waitUntil(() => timeline.get().every(message => message.body !== "fallido")));
  timeline.stop();
  await client.stop();
});

test("a stopped collection no longer follows the client", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  timeline.stop();

  adapter.receiveMessage(conversation.id, "bob", "ya no escucho");

  assert.equal(await waitUntil(() => timeline.get().length > 0, 10), false);
  await client.stop();
});
