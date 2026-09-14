import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const homeserver = "memory://test";

function build() {
  const adapter = new InMemoryAdapter();
  return { adapter, client: new MessagingClient({ adapter, storage: new InMemoryStorage() }) };
}

test("a homeserver says who you can sign in with besides a password", async () => {
  const { adapter, client } = build();
  adapter.offerSignInWith([{ id: "google", name: "Google", brand: "google" }]);

  assert.deepEqual(await client.sso.waysIn(homeserver), [{ id: "google", name: "Google", brand: "google" }]);
});

test("a homeserver that only takes a password offers no other way in", async () => {
  const { client } = build();
  assert.deepEqual(await client.sso.waysIn(homeserver), []);
});

test("where to send the browser, and where it should come back to", async () => {
  const { adapter, client } = build();
  adapter.offerSignInWith([{ id: "google", name: "Google" }]);

  const address = await client.sso.startAt(homeserver, "https://deitu.example/vuelta", "google");

  // Whoever is sent has to come back to the same application, so where to come back is carried along.
  assert.match(address, /google/);
  assert.match(address, /deitu\.example/);
});

test("the token it comes back with is a session", async () => {
  const { adapter, client } = build();
  adapter.offerSignInWith([{ id: "google", name: "Google" }]);
  const address = await client.sso.startAt(homeserver, "https://deitu.example/vuelta", "google");
  const token = new URL(address).searchParams.get("pretend-token");

  const session = await client.sso.finish(homeserver, token);

  assert.equal(session.homeserver, homeserver);
  assert.equal(typeof session.userId, "string");
  assert.ok(session.accessToken.length > 0);
  // And the client is signed in with it, the same as after a password.
  await client.start();
  assert.deepEqual(await client.conversations.list(), []);
  await client.stop();
});

test("a token nobody issued is refused", async () => {
  const { adapter, client } = build();
  adapter.offerSignInWith([{ id: "google", name: "Google" }]);

  await assert.rejects(client.sso.finish(homeserver, "inventado"), /token/i);
});

test("an empty token is refused before it reaches the homeserver", async () => {
  const { client } = build();
  await assert.rejects(client.sso.finish(homeserver, "  "), /token/i);
});
