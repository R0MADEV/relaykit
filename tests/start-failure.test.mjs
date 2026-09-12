import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * Starting without waiting comes back at once and catches up behind. When that catching up fails the client
 * stops itself, which is right. What is not right is what happens next: everything says "start the client",
 * which whoever is looking at it cannot act on. They did start it. It stopped, and they need to know why.
 */
class FailsWhileCatchingUp extends InMemoryAdapter {
  async start(currentSession, handlers) {
    await super.start(currentSession, handlers);
    throw new Error("el homeserver ha rechazado la sesion");
  }
}

async function startAndLetItFail() {
  const client = new MessagingClient({
    adapter: new FailsWhileCatchingUp(),
    storage: new InMemoryStorage(),
    session
  });
  client.on("error", () => undefined);
  await client.start({ waitForSync: false });
  // The failure lands on the next turn, which is what an application sees: it painted, then everything broke.
  await new Promise(resolve => setTimeout(resolve, 10));
  return client;
}

test("a client that stopped because it could not catch up says so, not 'start it'", async () => {
  const client = await startAndLetItFail();

  const failure = await client.conversations.list().catch(error => error);

  assert.equal(failure.code, "NOT_STARTED");
  assert.match(failure.message, /rechazado la sesion/);
});

test("whoever never started it is still told to start it", async () => {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });

  const failure = await client.conversations.list().catch(error => error);

  assert.equal(failure.code, "NOT_STARTED");
  assert.match(failure.message, /Start the client/);
});

test("starting again after a failure forgets what went wrong", async () => {
  const client = await startAndLetItFail();
  const working = new MessagingClient({ adapter: new InMemoryAdapter(), storage: new InMemoryStorage(), session });

  await working.start();
  const conversations = await working.conversations.list();

  assert.ok(Array.isArray(conversations));
  await working.stop();
  await client.stop();
});
