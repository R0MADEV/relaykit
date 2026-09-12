import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(cache) {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session, ...cache && { cache } });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  return { adapter, client, conversation };
}

test("a message that already arrived is not announced twice", async () => {
  const { adapter, client, conversation } = await startClient();
  const received = [];
  client.on("message.received", message => received.push(message.id));
  const arrived = adapter.receiveMessage(conversation.id, "bob", "hola");

  adapter.receiveMessage(conversation.id, "bob", "hola", { id: arrived.id });
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(received, [arrived.id]);
  await client.stop();
});

test("what has been seen is not remembered for ever", async () => {
  const { adapter, client, conversation } = await startClient({ seenMessages: 10 });
  const received = [];
  client.on("message.received", message => received.push(message.id));
  const first = adapter.receiveMessage(conversation.id, "bob", "el primero");
  for (let index = 0; index < 20; index += 1) {
    adapter.receiveMessage(conversation.id, "bob", `mensaje ${index}`);
  }
  await new Promise(resolve => setTimeout(resolve, 5));
  const seenSoFar = received.length;

  // Long forgotten, so it is treated as new again rather than held on to for ever.
  adapter.receiveMessage(conversation.id, "bob", "el primero", { id: first.id });
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(received.length, seenSoFar + 1);
  await client.stop();
});

test("what arrived recently is still recognised", async () => {
  const { adapter, client, conversation } = await startClient({ seenMessages: 10 });
  const received = [];
  client.on("message.received", message => received.push(message.id));
  const recent = adapter.receiveMessage(conversation.id, "bob", "reciente");
  await new Promise(resolve => setTimeout(resolve, 5));

  adapter.receiveMessage(conversation.id, "bob", "reciente", { id: recent.id });
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.equal(received.filter(id => id === recent.id).length, 1);
  await client.stop();
});

test("a message this account sent is never announced as if somebody else had", async () => {
  const { client, conversation } = await startClient({ seenMessages: 10 });
  const received = [];
  client.on("message.received", message => received.push(message.id));

  for (let index = 0; index < 30; index += 1) {
    await client.messages.send(conversation.id, `enviado ${index}`);
  }
  await new Promise(resolve => setTimeout(resolve, 5));

  assert.deepEqual(received, [], `its own messages came back as arrivals: ${received.length}`);
  await client.stop();
});
