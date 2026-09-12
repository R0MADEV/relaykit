import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const credentials = { homeserver: "memory://test", username: "alice", password: "alice-password" };

/**
 * Reopening with a session already here starts the client. When something after that goes wrong and the
 * application sends somebody back to the sign in form, the client is still running, and signing in is refused.
 * The way out has to be stopping it, and that has to work from any state.
 */
function newClient() {
  return new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });
}

test("signing in while a session is running is refused, and says so plainly", async () => {
  const client = newClient();
  await client.start();

  const failure = await client.login(credentials).catch(error => error);

  assert.equal(failure.code, "ALREADY_STARTED");
  await client.stop();
});

test("stopping is the way back, and signing in afterwards works", async () => {
  const client = newClient();
  await client.start();

  await client.stop();
  const signedIn = await client.login(credentials);

  assert.equal(typeof signedIn.userId, "string");
  await client.start();
  assert.ok(Array.isArray(await client.conversations.list()));
  await client.stop();
});

test("stopping one that never started is not an error, so the way back is always open", async () => {
  const client = newClient();

  await client.stop();
  const signedIn = await client.login(credentials);

  assert.equal(typeof signedIn.userId, "string");
});
