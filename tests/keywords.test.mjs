import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token", deviceId: "ALICE-1" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("nobody starts out watching for any word", async () => {
  const { client } = await startClient();

  assert.deepEqual(await client.push.keywords(), []);
  await client.stop();
});

test("a word can be watched for, so a message saying it interrupts", async () => {
  const { client } = await startClient();

  await client.push.watchFor("despliegue");

  assert.deepEqual(await client.push.keywords(), ["despliegue"]);
  await client.stop();
});

test("watching for the same word twice leaves one", async () => {
  const { client } = await startClient();
  await client.push.watchFor("despliegue");

  await client.push.watchFor("despliegue");

  assert.deepEqual(await client.push.keywords(), ["despliegue"]);
  await client.stop();
});

test("a word can stop being watched for", async () => {
  const { client } = await startClient();
  await client.push.watchFor("despliegue");
  await client.push.watchFor("incidencia");

  await client.push.stopWatchingFor("despliegue");

  assert.deepEqual(await client.push.keywords(), ["incidencia"]);
  await client.stop();
});

test("a word that is only spaces is refused, because it would interrupt on everything", async () => {
  const { client } = await startClient();

  await assert.rejects(client.push.watchFor("   "), /word/i);

  assert.deepEqual(await client.push.keywords(), []);
  await client.stop();
});
