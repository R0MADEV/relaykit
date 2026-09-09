import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const avatar = new Uint8Array([137, 80, 78, 71]);

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("a profile carries the display name and an opaque avatar identifier", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob Esponja", avatar: { mimeType: "image/png", data: avatar } });

  const profile = await client.users.profile("bob");

  assert.equal(profile.id, "bob");
  assert.equal(profile.displayName, "Bob Esponja");
  assert.equal(typeof profile.avatarId, "string");
  assert.ok(profile.avatarId.length > 0);
  await client.stop();
});

test("an avatar is downloaded with its content type", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob", avatar: { mimeType: "image/png", data: avatar } });

  const image = await client.users.avatar("bob");

  assert.deepEqual(image.data, avatar);
  assert.equal(image.mimeType, "image/png");
  await client.stop();
});

test("a user without a profile still resolves, and without an avatar there is nothing to download", async () => {
  const { client } = await startClient();

  const profile = await client.users.profile("carol");

  assert.deepEqual(profile, { id: "carol" });
  assert.equal(await client.users.avatar("carol"), undefined);
  await client.stop();
});

test("profile lookups validate the user id", async () => {
  const { client } = await startClient();

  await assert.rejects(client.users.profile("   "), { code: "INVALID_INPUT" });
  await assert.rejects(client.users.avatar(""), { code: "INVALID_INPUT" });
  await client.stop();
});

test("a rejected call never throws before returning its promise", async () => {
  const client = new MessagingClient({ adapter: new InMemoryAdapter(), session });

  // Nothing here is started, so every call must reject rather than throw at the call site.
  const calls = [
    () => client.users.profile("bob"),
    () => client.messages.markRead("conversation", "message"),
    () => client.verification.accept("session")
  ];

  for (const call of calls) {
    const result = call();
    assert.ok(result instanceof Promise);
    await assert.rejects(result, { code: "NOT_STARTED" });
  }
});
