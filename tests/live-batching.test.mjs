import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, createConversationList, createMessageTimeline } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const settle = () => new Promise(resolve => setTimeout(resolve, 5));

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a burst of conversations catching up repaints once, not once each", async () => {
  const { adapter, client } = await startClient();
  const made = [];
  for (let index = 0; index < 50; index += 1) {
    made.push(await client.conversations.create({ participantIds: ["bob"], title: `Sala ${index}` }));
  }
  const list = createConversationList(client);
  await list.refresh();
  let repaints = 0;
  list.subscribe(() => { repaints += 1; });

  for (const conversation of made) adapter.receiveMessage(conversation.id, "bob", "hola");
  await settle();

  assert.ok(repaints <= 2, `it repainted ${repaints} times for one burst`);
  assert.equal(list.get().length, 50);
  list.stop();
  await client.stop();
});

test("what is on screen after the burst is everything that arrived", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  let repaints = 0;
  timeline.subscribe(() => { repaints += 1; });

  for (let index = 0; index < 30; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `mensaje ${index}`, { createdAt: 1000 + index });
  }
  await settle();

  assert.equal(timeline.get().length, 30);
  assert.ok(repaints <= 2, `it repainted ${repaints} times for thirty messages arriving together`);
  timeline.stop();
  await client.stop();
});

test("one message on its own still repaints", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  let repaints = 0;
  timeline.subscribe(() => { repaints += 1; });

  adapter.receiveMessage(conversation.id, "bob", "solo uno");
  await settle();

  assert.equal(repaints, 1);
  assert.equal(timeline.get().length, 1);
  timeline.stop();
  await client.stop();
});

test("what has arrived can be read straight away, without waiting for the repaint", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  adapter.receiveMessage(conversation.id, "bob", "recien llegado");
  await new Promise(resolve => setTimeout(resolve, 1));

  assert.equal(timeline.get().length, 1);
  timeline.stop();
  await client.stop();
});

test("one broken subscriber does not leave the others without their repaint", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  let told = 0;
  timeline.subscribe(() => { throw new Error("this one is broken"); });
  timeline.subscribe(() => { told += 1; });

  adapter.receiveMessage(conversation.id, "bob", "hola");
  await settle();

  assert.equal(told, 1, "the working subscriber has to be told anyway");
  timeline.stop();
  await client.stop();
});

test("a broken subscriber does not stop the next repaint either", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  let told = 0;
  timeline.subscribe(() => { throw new Error("this one is broken"); });
  timeline.subscribe(() => { told += 1; });

  adapter.receiveMessage(conversation.id, "bob", "uno");
  await settle();
  adapter.receiveMessage(conversation.id, "bob", "dos");
  await settle();

  assert.equal(told, 2);
  timeline.stop();
  await client.stop();
});

test("a stopped list is not repainted by something that was already on its way", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  let repaints = 0;
  timeline.subscribe(() => { repaints += 1; });

  adapter.receiveMessage(conversation.id, "bob", "en camino");
  timeline.stop();
  await settle();

  assert.equal(repaints, 0);
  await client.stop();
});

test("messages stamped at the same moment are shown in the same order the client returns", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();

  // A backfill stamps many messages with the same moment, and both sides have to agree on the order anyway.
  for (let index = 0; index < 12; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `mensaje ${index}`, { createdAt: 1000 });
  }
  await settle();

  const onScreen = timeline.get().map(message => message.id);
  const fromTheClient = (await client.messages.list(conversation.id)).map(message => message.id);
  assert.deepEqual(onScreen, fromTheClient, "the screen and the client must agree on the order");
  timeline.stop();
  await client.stop();
});

test("what is on screen does not reshuffle when one more arrives at the same moment", async () => {
  const { adapter, client } = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  const timeline = createMessageTimeline(client, conversation.id);
  await timeline.refresh();
  for (let index = 0; index < 8; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `mensaje ${index}`, { createdAt: 1000 });
  }
  await settle();
  const before = timeline.get().map(message => message.id);

  adapter.receiveMessage(conversation.id, "bob", "uno mas", { createdAt: 1000 });
  await settle();

  const after = timeline.get().map(message => message.id);
  assert.deepEqual(after.filter(id => before.includes(id)), before, "what was already there must not move about");
  timeline.stop();
  await client.stop();
});
