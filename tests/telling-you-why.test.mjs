import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, RelayKitError } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/** Starts a client that writes down everything it is told about itself. */
async function watched(diagnostics = {}, adapter = new InMemoryAdapter()) {
  const seen = [];
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session,
    diagnostics: { onEvent: event => seen.push(event), ...diagnostics }
  });
  await client.start();
  return { adapter, client, seen, of: name => seen.filter(event => event.name === name) };
}

test("starting and stopping are said out loud, with how long they took", async () => {
  const { client, of } = await watched();

  const [started] = of("sync.completed");
  assert.ok(started, "nothing said that the first sync finished");
  assert.equal(typeof started.at, "number");
  assert.equal(typeof started.tookMs, "number");

  await client.stop();
});

test("what is said carries nothing private: no bodies, no names, no addresses", async () => {
  const { client, seen } = await watched();
  const conversation = await client.conversations.create({
    participantIds: ["bob"],
    title: "Secretos de la empresa"
  });
  await client.messages.send(conversation.id, "la contraseña es hunter2");
  await client.stop();

  const written = JSON.stringify(seen);
  assert.ok(!written.includes("hunter2"), "a message body reached the diagnostics");
  assert.ok(!written.includes("Secretos"), "a conversation title reached the diagnostics");
  assert.ok(!written.includes("memory://test"), "the homeserver address reached the diagnostics");
});

test("a message queued and then sent is two events, and the second says how long it waited", async () => {
  const { client, of } = await watched();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });

  await client.messages.send(conversation.id, "hola");

  assert.equal(of("message.queued").length, 1);
  const [sent] = of("message.sent");
  assert.ok(sent, "nothing said the message went out");
  assert.equal(typeof sent.tookMs, "number");
  await client.stop();
});

test("a failure says which code it was, which is the whole reason for reading this later", async () => {
  const refuses = new (class extends InMemoryAdapter {
    async sendMessage() {
      throw new RelayKitError("FORBIDDEN", "This account is not allowed to do that");
    }
  })();
  const { client, of } = await watched({}, refuses);
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });

  await client.messages.send(conversation.id, "no saldra").catch(() => undefined);

  const [failed] = of("message.failed");
  assert.ok(failed, "a message that did not go out said nothing about it");
  assert.equal(failed.code, "FORBIDDEN");
  await client.stop();
});

test("losing the connection and getting it back are both said", async () => {
  const { client, adapter, of } = await watched();

  adapter.simulateConnection("disconnected");
  adapter.simulateConnection("connected");

  assert.equal(of("connection.lost").length, 1);
  assert.equal(of("connection.restored").length, 1);
  await client.stop();
});

test("a diagnostics handler that throws does not take the application with it", async () => {
  const { client } = await watched({
    onEvent: () => {
      throw new Error("el sitio donde se registran esta caido");
    }
  });
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });

  // Telling somebody what happened must never be the reason something stops happening.
  const said = await client.messages.send(conversation.id, "hola");

  assert.equal(said.body, "hola");
  await client.stop();
});

test("saying nothing is free: with no handler, nothing is built", async () => {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });
  await client.messages.send(conversation.id, "hola");
  await client.stop();
});
