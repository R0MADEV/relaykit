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

test("stopping always ends stopped, even when the machinery below will not shut down", async () => {
  const breaksOnTheWayOut = new (class extends InMemoryAdapter {
    async stop() {
      throw new RelayKitError("ADAPTER_ERROR", "The homeserver refused the request");
    }
  })();
  const client = await signedIn(breaksOnTheWayOut);

  await assert.rejects(client.stop(), RelayKitError);

  // Whoever asked has been told. What must not happen is a client that still believes it is running while
  // half of what was under it has come apart.
  assert.equal(client.getSyncStatus(), "idle");
  assert.equal(client.getConnectionStatus(), "disconnected");
  await client.start();
  assert.notEqual(client.getSyncStatus(), "idle", "it could not be started again");
  await client.stop().catch(() => undefined);
});

test("closing an account lets go of the session even when the copy will not empty", async () => {
  const refuses = new (class extends InMemoryStorage {
    async clear() {
      throw new Error("el navegador no deja borrar");
    }
  })();
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: refuses, session });
  await client.start();

  await assert.rejects(client.account.close("token"), RelayKitError);

  // The account does not exist at the homeserver any more. Holding its session because a browser would not
  // empty a cache is holding something that cannot mean anything.
  assert.equal(client.currentSession(), undefined);
});

test("a homeserver refusing a session is heard even when the client already stopped", async () => {
  // An adapter that can still speak after it was stopped, which is what a real one is: matrix-js-sdk keeps
  // its own listeners and a refusal already in flight lands whenever the network gets round to it.
  const stillSpeaks = new (class extends InMemoryAdapter {
    async stop() {
      const keep = this.handlers;
      await super.stop();
      this.handlers = { onSessionEnded: keep.onSessionEnded };
    }
  })();
  const client = await signedIn(stillSpeaks);
  const adapter = stillSpeaks;
  await client.stop();

  // The signal is not "somebody asked to stop". It is "this session no longer exists", and it can arrive
  // late — after something else already brought the client down.
  adapter.endTheSession();
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(client.currentSession(), undefined);
});
