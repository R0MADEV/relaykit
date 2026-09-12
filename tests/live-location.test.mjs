import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * Compartir donde estas mientras te mueves no es mandar un punto: es decir "voy a ir contando durante un rato",
 * ir actualizando, y poder parar antes de tiempo. Si nadie para, caduca sola, que es lo que evita quedarse
 * compartiendo la ubicacion para siempre por un descuido.
 */
async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "vamos" });
  return { client, conversation };
}

test("se puede empezar a compartir donde estas durante un rato", async () => {
  const { client, conversation } = await startClient();

  const sharing = await client.location.start(conversation.id, { durationMs: 600000, description: "voy para alla" });

  assert.equal(typeof sharing.id, "string");
  assert.equal(sharing.isLive, true);
  assert.equal(sharing.description, "voy para alla");
  await client.stop();
});

test("compartir sin decir cuanto rato no vale: se quedaria para siempre", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.location.start(conversation.id, { durationMs: 0 }), { code: "INVALID_INPUT" });
  await assert.rejects(client.location.start(conversation.id, { durationMs: -1 }), { code: "INVALID_INPUT" });
  await client.stop();
});

test("mientras dura, se va diciendo donde estas", async () => {
  const { client, conversation } = await startClient();
  const sharing = await client.location.start(conversation.id, { durationMs: 600000 });

  await client.location.update(sharing.id, { latitude: 43.26, longitude: -2.93 });

  const [visto] = await client.location.list(conversation.id);
  assert.equal(visto.lastPosition.latitude, 43.26);
  assert.equal(visto.lastPosition.longitude, -2.93);
  await client.stop();
});

test("se puede parar antes de tiempo, y entonces deja de estar en vivo", async () => {
  const { client, conversation } = await startClient();
  const sharing = await client.location.start(conversation.id, { durationMs: 600000 });

  await client.location.stop(sharing.id);

  const [visto] = await client.location.list(conversation.id);
  assert.equal(visto.isLive, false);
  await assert.rejects(
    client.location.update(sharing.id, { latitude: 43.26, longitude: -2.93 }),
    { code: "INVALID_INPUT" }
  );
  await client.stop();
});
