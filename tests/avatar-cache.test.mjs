import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };
const picture = { mimeType: "image/png", data: new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4]) };

class CountingAdapter extends InMemoryAdapter {
  downloads = 0;

  async getAvatar(userId, conversationId) {
    this.downloads += 1;
    return super.getAvatar(userId, conversationId);
  }
}

async function startClient() {
  const adapter = new CountingAdapter();
  let now = 0;
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session, now: () => now });
  await client.start();
  return { adapter, client, at: value => { now = value; } };
}

test("painting the same picture twenty times downloads it once", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob", avatar: picture });

  for (let index = 0; index < 20; index += 1) await client.users.avatar("bob");

  assert.equal(adapter.downloads, 1);
  await client.stop();
});

test("what comes back is not the copy the caller can change", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob", avatar: picture });
  const first = await client.users.avatar("bob");

  first.data[0] = 99;

  assert.equal((await client.users.avatar("bob")).data[0], 137);
  await client.stop();
});

test("somebody without a picture is not asked about over and over either", async () => {
  const { adapter, client } = await startClient();

  await client.users.avatar("bob");
  await client.users.avatar("bob");

  assert.equal(adapter.downloads, 1);
  await client.stop();
});

test("each person's picture is its own", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob", avatar: picture });
  adapter.setProfile("carol", { displayName: "Carol", avatar: picture });

  await client.users.avatar("bob");
  await client.users.avatar("carol");

  assert.equal(adapter.downloads, 2);
  await client.stop();
});

test("a picture held long enough is fetched again", async () => {
  const { adapter, client, at } = await startClient();
  adapter.setProfile("bob", { displayName: "Bob", avatar: picture });
  await client.users.avatar("bob");

  at(10 * 60 * 1000);
  await client.users.avatar("bob");

  assert.equal(adapter.downloads, 2);
  await client.stop();
});

test("the pictures held do not grow without limit: the oldest is dropped and fetched again", async () => {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session,
    cache: { avatarBytes: 16 }
  });
  await client.start();
  for (const person of ["bob", "carol", "dave"]) {
    adapter.setProfile(person, { displayName: person, avatar: picture });
  }

  await client.users.avatar("bob");
  await client.users.avatar("carol");
  await client.users.avatar("dave");
  await client.users.avatar("bob");

  assert.equal(adapter.downloads, 4);
  await client.stop();
});

test("a picture bigger than everything held is still shown, just not kept", async () => {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session,
    cache: { avatarBytes: 4 }
  });
  await client.start();
  adapter.setProfile("bob", { displayName: "Bob", avatar: picture });

  const shown = await client.users.avatar("bob");
  await client.users.avatar("bob");

  assert.equal(shown?.data.byteLength, picture.data.byteLength);
  assert.equal(adapter.downloads, 2);
  await client.stop();
});

test("with the pictures turned off nothing is held, not even the empty answers", async () => {
  const adapter = new CountingAdapter();
  const client = new MessagingClient({
    adapter,
    storage: new InMemoryStorage(),
    session,
    cache: { avatarBytes: 0 }
  });
  await client.start();

  await client.users.avatar("bob");
  await client.users.avatar("bob");
  await client.users.avatar("carol");
  await client.users.avatar("carol");

  assert.equal(adapter.downloads, 4);
  await client.stop();
});

test("changing my own picture does not leave the old one being shown", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("alice", { displayName: "Alice", avatar: picture });
  await client.users.avatar("alice");

  await client.users.setAvatar({ mimeType: "image/png", data: new Uint8Array([9, 9, 9, 9]) });

  assert.equal((await client.users.avatar("alice")).data[0], 9);
  await client.stop();
});
