import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * The local copy is a convenience, not the truth: the truth is on the homeserver. If the browser runs out of
 * room, or somebody browses privately, or the quota is spent, keeping things fails. That cannot leave anybody
 * unable to read or write: what has to be lost is the convenience, not the conversation.
 */
class FullStorage extends InMemoryStorage {
  async saveMessages() { throw new Error("QuotaExceededError: no queda sitio"); }
  async saveConversation() { throw new Error("QuotaExceededError: no queda sitio"); }
  async saveConversations() { throw new Error("QuotaExceededError: no queda sitio"); }
  async saveOutboxOperation() { throw new Error("QuotaExceededError: no queda sitio"); }
}

async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new FullStorage(), session });
  client.on("error", () => undefined);
  await client.start();
  return client;
}

test("with nowhere to keep things, the list can still be read", async () => {
  const client = await startClient();

  const conversations = await client.conversations.list();

  assert.ok(Array.isArray(conversations));
  await client.stop();
});

test("with nowhere to keep things, it is still possible to talk", async () => {
  const client = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin sitio" });

  const sent = await client.messages.send(conversation.id, "esto tiene que salir igual");

  assert.equal(sent.body, "esto tiene que salir igual");
  assert.equal(sent.status, "sent");
  await client.stop();
});

test("with nowhere to keep things, what was said can still be read", async () => {
  const client = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin sitio" });
  await client.messages.send(conversation.id, "lo dicho");

  const messages = await client.messages.list(conversation.id);

  assert.deepEqual(messages.map(message => message.body), ["lo dicho"]);
  await client.stop();
});

test("running out of room is reported, not swallowed in silence", async () => {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new FullStorage(), session });
  const avisos = [];
  client.on("error", error => avisos.push(error.message));
  await client.start();

  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin sitio" });
  await client.messages.send(conversation.id, "algo");

  assert.ok(avisos.some(aviso => aviso.includes("QuotaExceededError")), `nadie aviso: ${avisos}`);
  await client.stop();
});

test("a store that cannot read either sends you to the homeserver instead of breaking", async () => {
  class UnreadableStorage extends FullStorage {
    async getConversations() { throw new Error("QuotaExceededError: no se puede leer"); }
    async getMessages() { throw new Error("QuotaExceededError: no se puede leer"); }
  }
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new UnreadableStorage(), session });
  client.on("error", () => undefined);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "ilegible" });
  await client.messages.send(conversation.id, "lo dicho");

  // What the store cannot give, the adapter gives: that is where the truth is.
  assert.deepEqual((await client.messages.list(conversation.id)).map(m => m.body), ["lo dicho"]);
  assert.ok((await client.conversations.list()).some(item => item.id === conversation.id));
  await client.stop();
});
