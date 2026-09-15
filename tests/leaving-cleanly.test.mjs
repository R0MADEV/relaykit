import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, RelayKitError } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

/** A store that says whether it was ever told to empty itself, and while who was signed in. */
function storeThatRemembersBeingCleared() {
  const store = new InMemoryStorage();
  const cleared = [];
  const original = store.clear.bind(store);
  store.clear = async () => {
    cleared.push(true);
    return original();
  };
  return { store, cleared };
}

async function signedIn(adapter = new InMemoryAdapter(), store = new InMemoryStorage()) {
  const client = new MessagingClient({ adapter, storage: store, session });
  await client.start();
  return client;
}

test("signing out empties the local copy while it still knows whose it was", async () => {
  const { store, cleared } = storeThatRemembersBeingCleared();
  const client = await signedIn(new InMemoryAdapter(), store);
  const whenCleared = [];
  client.on("session.changed", who => whenCleared.push(`session.changed:${who?.userId ?? "nobody"}`));
  const originalClear = store.clear;
  store.clear = async () => {
    whenCleared.push("cleared");
    return originalClear();
  };

  await client.logout();

  // Emptying it after saying there is nobody leaves nothing pointing at the copy that has to go.
  assert.deepEqual(whenCleared, ["cleared", "session.changed:nobody"]);
  assert.equal(cleared.length, 1);
});

test("a device that is told to sign out forgets, even when the homeserver cannot be reached", async () => {
  const refuses = new (class extends InMemoryAdapter {
    async logout() {
      throw new RelayKitError("NETWORK_ERROR", "The homeserver could not be reached");
    }
  })();
  const { store, cleared } = storeThatRemembersBeingCleared();
  const client = await signedIn(refuses, store);

  // The failure is still the caller's to know about, but the device must not be left holding credentials
  // and a local copy because a server was down. In a messenger that is the whole point of signing out.
  await assert.rejects(client.logout(), { code: "NETWORK_ERROR" });

  assert.equal(client.currentSession(), undefined, "the session was kept after being told to go");
  assert.equal(cleared.length, 1, "the local copy was kept after being told to go");
});

test("a refresh token the homeserver threw away is not kept here either", async () => {
  const adapter = new InMemoryAdapter();
  const client = await signedIn(adapter);
  const withRefresh = { ...session, refreshToken: "refresco-1", expiresAt: Date.now() + 60_000 };
  adapter.refreshTheSession(withRefresh);
  assert.equal(client.currentSession()?.refreshToken, "refresco-1");

  // Changing a password revokes it at the homeserver and says nothing. The same person and the same access
  // token, so anything comparing only those two would decide nothing had changed and keep a dead token.
  adapter.refreshTheSession({ ...session });

  assert.equal(client.currentSession()?.refreshToken, undefined);
  await client.stop();
});

test("the same session said twice is not news", async () => {
  const adapter = new InMemoryAdapter();
  const client = await signedIn(adapter);
  const changes = [];
  client.on("session.changed", () => changes.push(true));

  adapter.refreshTheSession({ ...session });
  adapter.refreshTheSession({ ...session });

  assert.deepEqual(changes, [], "nothing changed, so nobody was woken up");
  await client.stop();
});

test("a session the homeserver stopped accepting is let go of here too", async () => {
  const adapter = new InMemoryAdapter();
  const client = await signedIn(adapter);
  const said = [];
  client.on("session.changed", who => said.push(`changed:${who?.userId ?? "nobody"}`));
  client.on("session.ended", () => said.push("ended"));

  adapter.endTheSession();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.ok(said.includes("changed:nobody"), "it was left holding a token the homeserver refuses");
  assert.ok(said.includes("ended"));
  assert.equal(client.currentSession(), undefined);
});
