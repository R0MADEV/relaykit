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
  const unsubscribe = list.subscribe(() => {
    notifications += 1;
  });

  assert.deepEqual(list.get(), []);
  await list.refresh();

  assert.deepEqual(
    list.get().map(item => item.id),
    [conversation.id]
  );
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
  assert.deepEqual(
    timeline.get().map(message => message.body),
    ["hola"]
  );
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
  assert.deepEqual(
    timeline.get().map(message => message.body),
    ["primero", "segundo"]
  );

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

/**
 * A live list reloads itself when a conversation it has never seen turns up. That reload asks the adapter,
 * and an adapter can refuse — so the failure has to reach the application through the error it already
 * listens on, rather than becoming a rejection nobody is holding.
 */
test("a live list that cannot reload says so instead of failing silently", async () => {
  class RefusesToList extends InMemoryAdapter {
    refuse = false;
    async listConversations() {
      if (this.refuse) throw new Error("the homeserver is not answering");
      return super.listConversations();
    }
  }
  // No local copy on purpose: with one, a refusal is answered from what is held and never reaches anybody.
  const adapter = new RefusesToList();
  const client = new MessagingClient({ adapter, session });
  await client.start();
  const errors = [];
  client.on("error", error => errors.push(error));
  const conversations = createConversationList(client);
  await conversations.refresh();

  // One nobody has seen: the list has to go and ask again, and asking is what fails.
  adapter.refuse = true;
  adapter.receiveInvitation("bob");

  assert.ok(await waitUntil(() => errors.length > 0), "the failed reload never reached the error channel");
  assert.match(errors[0].message, /not answering/);
  conversations.stop();
  await client.stop();
});

test("a timeline can be asked to open with enough to read, and says so every time it reloads", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const asked = [];
  const list = client.messages.list.bind(client.messages);
  client.messages.list = (id, options) => {
    asked.push(options);
    return list(id, options);
  };

  const timeline = createMessageTimeline(client, conversation.id, { atLeast: 30 });
  await timeline.refresh();
  await timeline.refresh();

  assert.deepEqual(asked, [{ atLeast: 30 }, { atLeast: 30 }]);
  timeline.stop();
  await client.stop();
});

test("what hangs from a thread stays in the thread, however it arrives", async () => {
  const { client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"] });
  const root = await client.messages.send(conversation.id, "¿lo gestionáis vosotros?");
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  await client.messages.send(conversation.id, "lo gestionamos nosotros", { threadId: root.id });
  await client.messages.send(conversation.id, "y aviso yo a secretaría");
  await waitUntil(() => timeline.get().length === 2);

  assert.deepEqual(
    timeline.get().map(message => message.body),
    ["¿lo gestionáis vosotros?", "y aviso yo a secretaría"],
    "an answer inside a thread must not land in the middle of the conversation"
  );
  timeline.stop();
  await client.stop();
});
