import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

/**
 * Who is signed in, said once.
 *
 * There are six ways a session comes into being and every one of them has to reach whoever is keeping the
 * local copy. Anything that gets a session without saying so is a browser holding one person's cache while
 * another person is signed in.
 */
async function clientThatWatchesItsSession() {
  const changes = [];
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage() });
  client.on("session.changed", session => changes.push(session?.userId ?? null));
  return { adapter, client, changes };
}

test("signing in with a password says who is signed in", async () => {
  const { client, changes } = await clientThatWatchesItsSession();
  await client.login({ homeserver: "memory://test", username: "alice", password: "secreto" });
  assert.deepEqual(changes, ["alice"]);
});

test("registering says who is signed in", async () => {
  const { client, changes } = await clientThatWatchesItsSession();
  await client.register({ homeserver: "memory://test", username: "carla", password: "secreto-largo" });
  assert.deepEqual(changes, ["carla"]);
});

test("coming in as a guest says who is signed in", async () => {
  const { client, changes } = await clientThatWatchesItsSession();
  await client.signInAsGuest("memory://test");
  assert.equal(changes.length, 1);
  assert.ok(changes[0].startsWith("memory-guest-"));
});

test("coming back from somebody else's sign-in says who is signed in", async () => {
  const { adapter, client, changes } = await clientThatWatchesItsSession();
  adapter.offerSignInWith([{ id: "google", name: "Google" }]);
  const address = await client.sso.startAt("memory://test", "https://deitu.example/vuelta", "google");
  const token = new URL(address).searchParams.get("pretend-token");

  await client.sso.finish("memory://test", token);

  assert.equal(changes.length, 1);
  assert.ok(changes[0]);
});

test("a session refreshed on its own says so too, with the same person", async () => {
  const { adapter, client, changes } = await clientThatWatchesItsSession();
  const session = await client.login({
    homeserver: "memory://test",
    username: "alice",
    password: "secreto"
  });
  await client.start();

  adapter.refreshTheSession({ ...session, accessToken: "token-2" });

  assert.deepEqual(changes, ["alice", "alice"], "the same person, and said again so it can be written down");
  await client.stop();
});

test("signing out says there is nobody", async () => {
  const { client, changes } = await clientThatWatchesItsSession();
  await client.login({ homeserver: "memory://test", username: "alice", password: "secreto" });
  await client.start();

  await client.logout();

  assert.deepEqual(changes, ["alice", null]);
});

test("one person after another is two different people, said in order", async () => {
  const { client, changes } = await clientThatWatchesItsSession();
  await client.login({ homeserver: "memory://test", username: "alice", password: "secreto" });
  await client.start();
  await client.stop();
  await client.login({ homeserver: "memory://test", username: "bob", password: "secreto" });

  assert.deepEqual(changes, ["alice", "bob"]);
});

// The local copy itself: opened for whoever is signed in, and never for the person before them. IndexedDB is
// not here, so what is checked is the deciding — which is the part that was wrong.
const { StoreForWhoeverIsSignedIn } = await import("../packages/web/dist/index.js");

/** A store that writes down who it was opened for, instead of opening anything. */
function storeThatRemembersWhoItOpenedFor() {
  const openedFor = [];
  const store = new StoreForWhoeverIsSignedIn(session => {
    openedFor.push(session?.userId ?? null);
    return session?.userId ? { getConversations: async () => [] } : undefined;
  });
  return { store, openedFor };
}

test("nothing is opened until somebody is signed in", async () => {
  const { store, openedFor } = storeThatRemembersWhoItOpenedFor();
  store.nowSignedInAs(undefined);

  assert.deepEqual(await store.getConversations(), []);
  assert.deepEqual(openedFor, [null], "it tried once, found nobody, and kept nothing");

  store.nowSignedInAs({ homeserver: "memory://test", userId: "alice", accessToken: "t" });
  await store.getConversations();
  assert.deepEqual(openedFor, [null, "alice"]);
});

test("the next person gets their own copy, not the one before them", async () => {
  const { store, openedFor } = storeThatRemembersWhoItOpenedFor();
  store.nowSignedInAs({ homeserver: "memory://test", userId: "alice", accessToken: "t" });
  await store.getConversations();

  store.nowSignedInAs({ homeserver: "memory://test", userId: "bob", accessToken: "t" });
  await store.getConversations();

  assert.deepEqual(openedFor, ["alice", "bob"]);
});

test("a token renewed for the same person does not reopen anything", async () => {
  const { store, openedFor } = storeThatRemembersWhoItOpenedFor();
  store.nowSignedInAs({ homeserver: "memory://test", userId: "alice", accessToken: "uno" });
  await store.getConversations();

  store.nowSignedInAs({ homeserver: "memory://test", userId: "alice", accessToken: "dos" });
  await store.getConversations();

  assert.deepEqual(openedFor, ["alice"], "same person, same copy");
});

test("signing out lets go of the copy, so the next person cannot read it", async () => {
  const { store, openedFor } = storeThatRemembersWhoItOpenedFor();
  store.nowSignedInAs({ homeserver: "memory://test", userId: "alice", accessToken: "t" });
  await store.getConversations();

  store.nowSignedInAs(undefined);
  await store.getConversations();

  assert.deepEqual(openedFor, ["alice", null]);
});
