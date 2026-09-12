import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient(adapter = new InMemoryAdapter()) {
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("somebody can be found by the name they go by, not only by their identifier", async () => {
  const { adapter, client } = await startClient();
  adapter.setProfile("@ana:localhost", { displayName: "Ana Ruiz" });
  adapter.setProfile("@bea:localhost", { displayName: "Beatriz Soto" });

  const found = await client.users.search("ana");

  assert.deepEqual(found.map(user => user.id), ["@ana:localhost"]);
  assert.equal(found[0].displayName, "Ana Ruiz");
  await client.stop();
});

test("looking for nothing is not a search", async () => {
  const { client } = await startClient();

  await assert.rejects(client.users.search("   "), { code: "INVALID_INPUT" });
  await client.stop();
});

test("a search asks for no more than it was told to", async () => {
  class WatchfulAdapter extends InMemoryAdapter {
    asked;
    async searchUsers(query, limit) {
      this.asked = { query, limit };
      return super.searchUsers(query, limit);
    }
  }
  const { adapter, client } = await startClient(new WatchfulAdapter());

  await client.users.search("ana", { limit: 5 });

  assert.deepEqual(adapter.asked, { query: "ana", limit: 5 });
  await client.stop();
});

test("two sizes of the same picture do not get mistaken for each other", async () => {
  class SizedAdapter extends InMemoryAdapter {
    async getAvatar(userId, conversationId, size) {
      return { mimeType: "image/png", data: new Uint8Array(size ?? 512) };
    }
  }
  const { client } = await startClient(new SizedAdapter());

  const small = await client.users.avatar("@ana:localhost", { size: 32 });
  const whole = await client.users.avatar("@ana:localhost");

  assert.equal(small.data.byteLength, 32);
  assert.equal(whole.data.byteLength, 512);
  await client.stop();
});
