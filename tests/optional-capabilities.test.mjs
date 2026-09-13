import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * Not every protocol does everything, and not every homeserver does everything its protocol allows. What an
 * adapter cannot do it says by not offering it, and asking anyway has to come back as NOT_SUPPORTED — one
 * code an application can act on, rather than whatever a missing method happens to do.
 *
 * Each of these takes the double and removes one capability, which is exactly the shape an adapter for a
 * smaller protocol would have.
 */
async function clientWithout(capability) {
  const adapter = new InMemoryAdapter();
  adapter[capability] = undefined;
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "sin" });
  return { client, conversation };
}

const unsupported = { code: "NOT_SUPPORTED" };

test("an adapter that holds no polls refuses them as unsupported", async () => {
  const { client, conversation } = await clientWithout("polls");

  await assert.rejects(
    client.polls.start(conversation.id, { question: "¿cuándo?", answers: ["hoy", "mañana"] }),
    unsupported
  );
  await assert.rejects(client.polls.list(conversation.id), unsupported);
  await client.stop();
});

test("an adapter that cannot tell where somebody is refuses it as unsupported", async () => {
  const { client, conversation } = await clientWithout("location");

  await assert.rejects(client.location.start(conversation.id, { durationMs: 60000 }), unsupported);
  await assert.rejects(client.location.list(conversation.id), unsupported);
  await client.stop();
});

test("an adapter without spaces refuses them as unsupported", async () => {
  const { client } = await clientWithout("spaces");

  await assert.rejects(client.spaces.list(), unsupported);
  await assert.rejects(client.spaces.create({ title: "equipo" }), unsupported);
  await client.stop();
});

test("an adapter that carries no files refuses them as unsupported", async () => {
  const { client, conversation } = await clientWithout("media");

  await assert.rejects(client.media.limits(), unsupported);
  await assert.rejects(
    client.messages.sendFile(conversation.id, {
      name: "nota.txt",
      mimeType: "text/plain",
      data: new Uint8Array([1, 2, 3])
    }),
    unsupported
  );
  await client.stop();
});

test("an adapter that cannot be pushed to refuses it as unsupported", async () => {
  const { client } = await clientWithout("push");

  await assert.rejects(client.push.registered(), unsupported);
  await assert.rejects(client.push.keywords(), unsupported);
  await client.stop();
});

test("an adapter that knows of no other devices refuses them as unsupported", async () => {
  const { client } = await clientWithout("devices");

  await assert.rejects(client.devices.list(), unsupported);
  await client.stop();
});

test("an adapter without reactions refuses them as unsupported", async () => {
  const { client, conversation } = await clientWithout("reactions");
  const sent = await client.messages.send(conversation.id, "hola");

  await assert.rejects(client.reactions.add(conversation.id, sent.id, "👍"), unsupported);
  await client.stop();
});

test("an adapter that does no cryptography refuses it as unsupported", async () => {
  const { client } = await clientWithout("crypto");

  await assert.rejects(client.crypto.status(), unsupported);
  await assert.rejects(client.verification.request("@bob:localhost"), unsupported);
  await client.stop();
});
