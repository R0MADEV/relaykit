import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient, RelayKitError } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

test("a listener that throws does not take the library with it", async () => {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  const wentWrong = [];
  client.on("error", error => wentWrong.push(error));
  client.on("message.received", () => {
    throw new Error("un fallo en el React de la aplicacion");
  });
  const alsoTold = [];
  client.on("message.received", message => alsoTold.push(message.body));
  await client.start();
  const conversation = await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });

  // A bug in somebody's screen is not a reason for the next listener to miss what happened, and certainly
  // not a reason for the library's own bookkeeping to stop half way.
  adapter.receiveMessage(conversation.id, "bob", "hola");
  // What arrives is written down before it is announced, so it lands a turn later.
  await new Promise(resolve => setTimeout(resolve, 10));

  assert.deepEqual(alsoTold, ["hola"], "the listener after the broken one never heard about it");
  assert.equal(wentWrong.length, 1, "and nobody was told there had been a bug");
  await client.stop();
});

test("a listener that throws while the session changes does not stop the session changing", async () => {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage() });
  client.on("session.changed", () => {
    throw new Error("un fallo en la aplicacion");
  });
  client.on("error", () => undefined);

  await client.login({ homeserver: "memory://test", username: "alice", password: "secreto" });

  assert.equal(client.currentSession()?.userId, "alice");
});

test("emptying the local copy on the way out is not something that can quietly not happen", async () => {
  const refuses = new (class extends InMemoryStorage {
    async clear() {
      throw new Error("el navegador no deja borrar");
    }
  })();
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), storage: refuses, session });
  await client.start();

  // Everything else about the local copy is a convenience and its failures are swallowed on purpose. This
  // one is not a convenience: somebody asked for their conversations to be gone from this device.
  await assert.rejects(client.logout(), RelayKitError);
  assert.equal(client.currentSession(), undefined, "and the credentials go regardless");
});

test("closing an account leaves nothing running and nothing kept", async () => {
  const adapter = new InMemoryAdapter();
  const store = new InMemoryStorage();
  const client = new MessagingClient({ adapter, storage: store, session });
  await client.start();
  await client.conversations.create({ participantIds: ["bob"], title: "Equipo" });

  await client.account.close("token");

  // The account is gone at the homeserver. Waiting for the next request to discover that leaves a client
  // that looks alive, a session that is worth nothing, and a copy of conversations nobody can ever open.
  assert.equal(client.currentSession(), undefined);
  assert.deepEqual(await store.getConversations(), []);
  await assert.rejects(client.conversations.list(), { code: "NOT_STARTED" });
});

// Renewing a token, which is the thing that works perfectly for days and then does not.
const { theSessionAfterRefreshing } = await import("../packages/matrix-js/dist/matrix-tokens.js");

test("a renewal that hands back a new refresh token keeps the new one", () => {
  const before = { ...session, refreshToken: "R1" };

  const after = theSessionAfterRefreshing(before, { access_token: "A2", refresh_token: "R2" }, "R1");

  assert.equal(after.accessToken, "A2");
  assert.equal(after.refreshToken, "R2");
});

test("a renewal that hands back no refresh token keeps the one it was used with", () => {
  // The protocol says so: no new refresh token means the one just used is still good. Carrying forward
  // whatever the session happened to hold instead is how a client ends up presenting a token two renewals
  // out of date — which works right up until it does not, days later, with nothing to point at.
  const afterTheFirst = theSessionAfterRefreshing(
    { ...session, refreshToken: "R1" },
    { access_token: "A2", refresh_token: "R2" },
    "R1"
  );

  const afterTheSecond = theSessionAfterRefreshing(afterTheFirst, { access_token: "A3" }, "R2");

  assert.equal(afterTheSecond.accessToken, "A3");
  assert.equal(afterTheSecond.refreshToken, "R2", "it went back to the token from two renewals ago");
});

test("a renewal that says when it runs out says so, and one that does not says nothing", () => {
  const withEnd = theSessionAfterRefreshing(session, { access_token: "A2", expires_in_ms: 60_000 }, "R1");
  assert.ok(withEnd.expiresAt > Date.now());

  const withoutEnd = theSessionAfterRefreshing({ ...session, expiresAt: 1 }, { access_token: "A3" }, "R1");
  assert.equal(withoutEnd.expiresAt, undefined, "an expiry from the last one is not this one's");
});
