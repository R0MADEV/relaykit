import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryAdapter, InMemoryStorage } from "@relaykit/in-memory";
import { MessagingClient } from "@relaykit/core";

const session = { homeserver: "memory://test", userId: "alice", accessToken: "token" };

async function startClient() {
  const adapter = new InMemoryAdapter();
  const client = new MessagingClient({ adapter, storage: new InMemoryStorage(), session });
  await client.start();
  return { adapter, client };
}

test("each of the three states this person can be in is accepted", async () => {
  const { client } = await startClient();

  for (const presence of ["online", "offline", "unavailable"]) {
    await client.presence.set({ presence });
  }
  await client.stop();
});

test("a state nobody understands is refused before reaching the server", async () => {
  const { adapter, client } = await startClient();
  let reached = 0;
  const original = adapter.setPresence.bind(adapter);
  adapter.setPresence = update => {
    reached += 1;
    return original(update);
  };

  await assert.rejects(client.presence.set({ presence: "away" }), /presence/i);

  assert.equal(reached, 0);
  await client.stop();
});

test("a status message longer than a status message is refused", async () => {
  const { client } = await startClient();

  await assert.rejects(
    client.presence.set({ presence: "online", statusMessage: "x".repeat(2000) }),
    /status/i
  );
  await client.stop();
});
