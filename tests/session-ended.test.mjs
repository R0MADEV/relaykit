import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/**
 * Whoever provisions the accounts can take one away: a suspension, a person leaving, a token revoked from
 * another device. The homeserver then refuses everything, and the application has to send that person back to
 * the sign in screen. Finding out by inspecting the code of a failure that happened to be thrown is not a way
 * to build a screen: it has to be told.
 */
class RevocableAdapter extends InMemoryAdapter {
  async start(currentSession, handlers) {
    this.handlers = handlers;
    return super.start(currentSession, handlers);
  }

  /** What the adapter does when the homeserver says this session is over. */
  revoke() {
    this.handlers.onSessionEnded?.();
  }
}

async function startClient() {
  const adapter = new RevocableAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a session taken away is told, so the application can react", async () => {
  const { adapter, client } = await startClient();
  // The client stops before saying so, which is the right order: whatever the application does when told
  // finds a client that is honestly stopped rather than one that still looks alive.
  const told = new Promise(resolve => client.on("session.ended", resolve));

  adapter.revoke();

  await told;
  assert.equal(client.isStarted?.() ?? false, false);
  await client.stop();
});

test("a session taken away leaves the client stopped, not half running", async () => {
  const { adapter, client } = await startClient();
  client.on("session.ended", () => undefined);

  adapter.revoke();
  await new Promise(resolve => setTimeout(resolve, 10));

  const failure = await client.conversations.list().catch(error => error);
  assert.equal(failure.code, "NOT_STARTED");
  assert.match(failure.message, /session|sesi/i);
});

test("signing in again after being taken away works", async () => {
  const { adapter, client } = await startClient();
  client.on("session.ended", () => undefined);
  adapter.revoke();
  await new Promise(resolve => setTimeout(resolve, 10));

  await client.stop();
  const signedIn = await client.login({ homeserver: "memory://test", username: "alice", password: "otra" });

  assert.equal(typeof signedIn.accessToken, "string");
});
