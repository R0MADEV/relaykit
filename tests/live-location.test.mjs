import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * Sharing where you are while you move is not sending a point: it is saying "I will keep telling you for a
 * while", updating as you go, and being able to stop early. If nobody stops it, it expires on its own, which
 * is what stops a slip leaving somebody sharing their location for ever.
 */
async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "vamos" });
  return { client, conversation };
}

test("sharing where you are can be started for a while", async () => {
  const { client, conversation } = await startClient();

  const sharing = await client.location.start(conversation.id, { durationMs: 600000, description: "voy para alla" });

  assert.equal(typeof sharing.id, "string");
  assert.equal(sharing.isLive, true);
  assert.equal(sharing.description, "voy para alla");
  await client.stop();
});

test("sharing without saying for how long will not do: it would stay for ever", async () => {
  const { client, conversation } = await startClient();

  await assert.rejects(client.location.start(conversation.id, { durationMs: 0 }), { code: "INVALID_INPUT" });
  await assert.rejects(client.location.start(conversation.id, { durationMs: -1 }), { code: "INVALID_INPUT" });
  await client.stop();
});

test("while it lasts, where you are keeps being told", async () => {
  const { client, conversation } = await startClient();
  const sharing = await client.location.start(conversation.id, { durationMs: 600000 });

  await client.location.update(sharing.id, { latitude: 43.26, longitude: -2.93 });

  const [visto] = await client.location.list(conversation.id);
  assert.equal(visto.lastPosition.latitude, 43.26);
  assert.equal(visto.lastPosition.longitude, -2.93);
  await client.stop();
});

test("it can be stopped early, and then it is no longer live", async () => {
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
