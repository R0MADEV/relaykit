import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * La copia local es una comodidad, no la verdad: la verdad está en el homeserver. Si el navegador se queda sin
 * sitio, o alguien navega en privado, o la cuota se agota, guardar falla. Eso no puede dejar a nadie sin poder
 * leer ni escribir: lo que tiene que pasar es que se pierda la comodidad, no la conversación.
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

test("sin sitio para guardar, todavia se puede leer la lista", async () => {
  const client = await startClient();

  const conversations = await client.conversations.list();

  assert.ok(Array.isArray(conversations));
  await client.stop();
});

test("sin sitio para guardar, todavia se puede hablar", async () => {
  const client = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin sitio" });

  const sent = await client.messages.send(conversation.id, "esto tiene que salir igual");

  assert.equal(sent.body, "esto tiene que salir igual");
  assert.equal(sent.status, "sent");
  await client.stop();
});

test("sin sitio para guardar, todavia se puede leer lo dicho", async () => {
  const client = await startClient();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin sitio" });
  await client.messages.send(conversation.id, "lo dicho");

  const messages = await client.messages.list(conversation.id);

  assert.deepEqual(messages.map(message => message.body), ["lo dicho"]);
  await client.stop();
});

test("quedarse sin sitio se avisa, no se traga en silencio", async () => {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new FullStorage(), session });
  const avisos = [];
  client.on("error", error => avisos.push(error.message));
  await client.start();

  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin sitio" });
  await client.messages.send(conversation.id, "algo");

  assert.ok(avisos.some(aviso => aviso.includes("QuotaExceededError")), `nadie aviso: ${avisos}`);
  await client.stop();
});

test("un almacen que tampoco puede leer manda al homeserver en vez de romper", async () => {
  class UnreadableStorage extends FullStorage {
    async getConversations() { throw new Error("QuotaExceededError: no se puede leer"); }
    async getMessages() { throw new Error("QuotaExceededError: no se puede leer"); }
  }
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new UnreadableStorage(), session });
  client.on("error", () => undefined);
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "ilegible" });
  await client.messages.send(conversation.id, "lo dicho");

  // Lo que el almacen no puede dar lo da el adaptador, que es donde esta la verdad.
  assert.deepEqual((await client.messages.list(conversation.id)).map(m => m.body), ["lo dicho"]);
  assert.ok((await client.conversations.list()).some(item => item.id === conversation.id));
  await client.stop();
});
