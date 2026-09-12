import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
  await client.start();
  return client;
}

test("somebody can be silenced without being ignored", async () => {
  const client = await startClient();

  await client.push.mute("@pesado:localhost");

  assert.deepEqual(await client.push.muted(), ["@pesado:localhost"]);
  // Silencing is not ignoring: their messages still arrive, they just do not interrupt.
  assert.deepEqual(await client.users.ignored(), []);
  await client.stop();
});

test("silencing the same person twice leaves one rule, not two", async () => {
  const client = await startClient();

  await client.push.mute("@pesado:localhost");
  await client.push.mute("@pesado:localhost");

  assert.deepEqual(await client.push.muted(), ["@pesado:localhost"]);
  await client.stop();
});

test("somebody silenced can be heard again", async () => {
  const client = await startClient();
  await client.push.mute("@pesado:localhost");

  await client.push.unmute("@pesado:localhost");

  assert.deepEqual(await client.push.muted(), []);
  await client.stop();
});

test("silencing nobody is not a thing to ask for", async () => {
  const client = await startClient();

  await assert.rejects(client.push.mute("   "), { code: "INVALID_INPUT" });
  await assert.rejects(client.push.unmute(""), { code: "INVALID_INPUT" });
  await client.stop();
});

test("how much anything is allowed to interrupt, for the whole account", async () => {
  const client = await startClient();

  assert.equal(await client.push.level(), "all");

  await client.push.setLevel("mentions");
  assert.equal(await client.push.level(), "mentions");

  await client.push.setLevel("none");
  assert.equal(await client.push.level(), "none");
  await client.stop();
});

test("a level nobody defined is refused instead of quietly doing nothing", async () => {
  const client = await startClient();

  await assert.rejects(client.push.setLevel("a ratos"), { code: "INVALID_INPUT" });
  await client.stop();
});
